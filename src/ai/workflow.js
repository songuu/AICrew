// AI 增强工作流：在确定性管线之上叠加真实 LLM 文案与（OpenAI）封面图。
// 设计原则：
//  - 包装而非修改 runCreativeWorkflow —— 评分/结构/导出契约与 13 个 domain 测试不受影响。
//  - 无 token → 原样回退确定性模拟。
//  - 任一 AI 调用失败 → 局部回退该 variant 的模拟文案，整体不抛错（aiMeta 记录降级）。
import { runCreativeWorkflow, findSkill, findPlatformPreset, defaultBrandKit } from "../domain.js";
import { isAiConfigured, AI_PROVIDERS } from "./config.js";
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

// 画幅 → OpenAI 图像尺寸（gpt-image-1 支持 1024x1024 / 1024x1536 / 1536x1024）。
function imageSizeFor(preset) {
  const [w, h] = String(preset.ratio).split(":").map(Number);
  if (!w || !h || w === h) return "1024x1024";
  return h > w ? "1024x1536" : "1536x1024";
}

// 从模型输出中容错提取 JSON（兼容包裹文字 / 代码块）。
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

// 把 AI 文案不可变地合并进 variant；AI 只增强可见文案，不动评分/结构/导出契约。
function applyAiCopy(variant, aiCopy) {
  if (!aiCopy) return variant;
  const hook = typeof aiCopy.hook === "string" && aiCopy.hook.trim() ? aiCopy.hook.trim() : variant.hook;
  const caption = typeof aiCopy.caption === "string" && aiCopy.caption.trim() ? aiCopy.caption.trim() : variant.caption;
  const hashtags =
    Array.isArray(aiCopy.hashtags) && aiCopy.hashtags.length
      ? aiCopy.hashtags.map(tag => String(tag).trim()).filter(Boolean)
      : variant.hashtags;
  return {
    ...variant,
    hook,
    caption,
    hashtags,
    aiGenerated: true,
    timeline: variant.timeline.map((shot, index) => (index === 0 ? { ...shot, action: hook } : shot))
  };
}

export async function runCreativeWorkflowWithAI({ brief, skillId, brandKit = defaultBrandKit, aiConfig, signal, fetchImpl } = {}) {
  const base = runCreativeWorkflow({ brief, skillId, brandKit });

  if (!isAiConfigured(aiConfig)) {
    return { ...base, aiMeta: { used: false, reason: "no-config" } };
  }

  const skill = findSkill(skillId);
  const preset = findPlatformPreset(base.brief.platform);
  const meta = AI_PROVIDERS[aiConfig.provider];

  try {
    // 各 variant 并发生成文案；单个失败只回退该条，不影响其余。
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

    let variants = base.variants.map((variant, index) => applyAiCopy(variant, copies[index]));

    // 封面图：仅 OpenAI + 已启用 + 首个 variant（控成本）。
    let imageApplied = false;
    if (aiConfig.imageEnabled && meta?.supportsImage && variants[0]) {
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

    const copyApplied = copies.filter(Boolean).length;
    return {
      ...base,
      variants,
      aiMeta: {
        used: copyApplied > 0 || imageApplied,
        provider: aiConfig.provider,
        model: aiConfig.model,
        copyApplied,
        imageApplied
      }
    };
  } catch (error) {
    // 兜底：任何未预期错误都回退到确定性结果，绝不让 UI 拿到异常。
    return { ...base, aiMeta: { used: false, error: error instanceof Error ? error.message : String(error) } };
  }
}
