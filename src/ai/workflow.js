// AI 增强工作流：在确定性管线之上叠加真实 LLM 文案与系统图像模型封面。
// 设计原则：
//  - 包装而非修改 runCreativeWorkflow —— 评分/结构/导出契约与 domain 测试不受影响。
//  - 无系统 AI 配置 → 原样回退确定性模拟。
//  - 任一 AI 调用失败 → 局部回退该 variant 的模拟文案，整体不抛错（aiMeta 记录降级）。
import { runCreativeWorkflow, runCreativeWorkflowWithSkill, findPlatformPreset, defaultBrandKit } from "../domain.js";
import { hasAiMode, isAiConfigured, selectedModelFor } from "./config.js";
import { generateText, generateImage } from "./providers.js";

const COPY_SYSTEM = "你是资深广告与种草内容创作专家。严格只输出 JSON，不要解释、不要 markdown 代码块。";

function buildCopyPrompt(brief, variant, brandKit, preset) {
  return [
    `为「${variant.angle}」角度生成一条可直接发布的${brief.platform}文案，必须返回严格 JSON：`,
    `{"hook":"开场钩子","caption":"正文文案","hashtags":["#标签1","#标签2"]}`,
    ``,
    `产品：${brief.productName}`,
    `卖点：${brief.sellingPoints}`,
    `受众：${brief.targetAudience}`,
    `平台：${brief.platform}（调性：${preset.tone}）`,
    `目标：${brief.goal}`,
    `品牌：${brandKit.name}（品牌声音：${brandKit.voice}）`,
    `禁用词（绝不出现）：${(brandKit.forbiddenWords || []).join("、") || "无"}`,
    ``,
    `只输出 JSON。`
  ].join("\n");
}

function buildImagePrompt(brief, variant, brandKit, preset) {
  return [
    `${brief.platform} ${preset.ratio} 封面图，产品：${brief.productName}。`,
    `角度：${variant.angle}；卖点：${brief.sellingPoints}；受众：${brief.targetAudience}。`,
    `风格：${brief.style}；品牌调性：${brandKit.voice}。`,
    `高级、干净、强吸引力，无文字水印。`
  ].join(" ");
}

function imageSizeFor(preset) {
  const [w, h] = String(preset.ratio).split(":").map(Number);
  if (!w || !h || w === h) return "1024x1024";
  return h > w ? "1024x1536" : "1536x1024";
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  return null;
}

function mergeAiCopy(variant, aiCopy) {
  if (!aiCopy) return { variant, applied: false };
  const hook = typeof aiCopy.hook === "string" && aiCopy.hook.trim() ? aiCopy.hook.trim() : null;
  const caption = typeof aiCopy.caption === "string" && aiCopy.caption.trim() ? aiCopy.caption.trim() : null;
  const hashtags =
    Array.isArray(aiCopy.hashtags) && aiCopy.hashtags.length
      ? aiCopy.hashtags.map(tag => String(tag).trim()).filter(Boolean)
      : null;
  const applied = Boolean(hook || caption || (hashtags && hashtags.length));
  if (!applied) return { variant, applied: false };
  const nextHook = hook || variant.hook;
  return {
    variant: {
      ...variant,
      hook: nextHook,
      caption: caption || variant.caption,
      hashtags: hashtags && hashtags.length ? hashtags : variant.hashtags,
      aiGenerated: true,
      timeline: variant.timeline.map((shot, index) => (index === 0 ? { ...shot, action: nextHook } : shot))
    },
    applied: true
  };
}

export async function runCreativeWorkflowWithAI({ brief, skillId, skill, brandKit = defaultBrandKit, aiConfig, signal, fetchImpl } = {}) {
  // 传 skill 对象（Flow 编排图合成）走自定义编排；传 skillId 走预设 skill。两条路共用同一套 AI 增强。
  const base = skill
    ? runCreativeWorkflowWithSkill({ brief, skill, brandKit })
    : runCreativeWorkflow({ brief, skillId, brandKit });

  if (!isAiConfigured(aiConfig)) {
    return { ...base, aiMeta: { used: false, reason: "no-system-config" } };
  }

  const preset = findPlatformPreset(base.brief.platform);
  const textModel = selectedModelFor(aiConfig, aiConfig?.selection, "text");
  const imageModel = selectedModelFor(aiConfig, aiConfig?.selection, "image");

  try {
    const copies = await Promise.all(
      base.variants.map(async variant => {
        try {
          const text = await generateText(aiConfig, {
            system: COPY_SYSTEM,
            prompt: buildCopyPrompt(base.brief, variant, brandKit, preset),
            maxTokens: 600,
            signal,
            fetchImpl
          });
          return extractJson(text);
        } catch {
          return null;
        }
      })
    );

    const merged = base.variants.map((variant, index) => mergeAiCopy(variant, copies[index]));
    let variants = merged.map(item => item.variant);

    let imageApplied = false;
    if (hasAiMode(aiConfig, "image") && variants[0]) {
      try {
        const imageUrl = await generateImage(aiConfig, {
          prompt: buildImagePrompt(base.brief, variants[0], brandKit, preset),
          size: imageSizeFor(preset),
          signal,
          fetchImpl
        });
        if (imageUrl) {
          variants = variants.map((variant, index) => (index === 0 ? { ...variant, imageUrl } : variant));
          imageApplied = true;
        }
      } catch {
        imageApplied = false;
      }
    }

    const copyApplied = merged.filter(item => item.applied).length;
    return {
      ...base,
      variants,
      aiMeta: {
        used: copyApplied > 0 || imageApplied,
        provider: aiConfig.providerName || aiConfig.provider,
        model: textModel?.name || aiConfig.model,
        imageModel: imageApplied ? imageModel?.name || aiConfig.imageModel : undefined,
        copyApplied,
        imageApplied
      }
    };
  } catch (error) {
    return { ...base, aiMeta: { used: false, error: error instanceof Error ? error.message : String(error) } };
  }
}
