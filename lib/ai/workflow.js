// AI 增强工作流：在确定性管线之上叠加真实 LLM 文案与系统图像模型封面。
// 设计原则：
//  - 包装而非修改 runCreativeWorkflow —— 评分/结构/导出契约与 domain 测试不受影响。
//  - 无系统 AI 配置 → 原样回退确定性模拟。
//  - 任一 AI 调用失败 → 局部回退该 variant 的模拟文案，整体不抛错（aiMeta 记录降级）。
import { runCreativeWorkflow, runCreativeWorkflowWithSkill, findPlatformPreset, defaultBrandKit } from "../domain.js";
import { hasAiMode, isAiConfigured, selectedModelFor } from "./config.js";
import { generateText, generateImage } from "./providers.js";
import { renderBrandClause, renderBrandImageHint } from "../brand/prompt.js";
import { materialNames } from "../storage/materialStore.js";

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
    renderBrandClause(brandKit),
    ``,
    `只输出 JSON。`
  ].join("\n");
}

function buildImagePrompt(brief, variant, brandKit, preset) {
  const parts = [
    `${brief.platform} ${preset.ratio} 封面图，产品：${brief.productName}。`,
    `角度：${variant.angle}；卖点：${brief.sellingPoints}；受众：${brief.targetAudience}。`,
    `风格：${brief.style}；${renderBrandImageHint(brandKit)}。`
  ];
  // 用户上传素材作为视觉参考提示注入（best-effort，无素材时 prompt 与改动前完全一致）。
  const refs = materialNames(brief.materials);
  if (refs.length) parts.push(`参考用户上传素材：${refs.join("、")}。`);
  parts.push(`高级、干净、强吸引力，无文字水印。`);
  return parts.join(" ");
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

// 软上限：默认全 variant 出图；aiConfig.maxImagesPerRun 提供防 provider 限流的逃生阀。
function resolveMaxImages(aiConfig, count) {
  const raw = Number(aiConfig?.maxImagesPerRun);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, count);
  return count;
}

// 纯协调：为每个 variant 并发出图，逐项隔离失败（单图失败仅该 variant 回退无图，不影响其余）。
// 返回新 variants 数组（不可变）、成功计数与错误明细。copy 文案另在主流程处理，此处只管图像。
export async function generateVariantImages({ variants, brief, brandKit, preset, aiConfig, signal, fetchImpl, maxImages } = {}) {
  const list = Array.isArray(variants) ? variants : [];
  const limit = Number.isFinite(maxImages) && maxImages >= 0 ? maxImages : list.length;
  const results = await Promise.all(
    list.map(async (variant, index) => {
      if (index >= limit) return { index, imageUrl: null, skipped: true };
      try {
        const imageUrl = await generateImage(aiConfig, {
          prompt: buildImagePrompt(brief, variant, brandKit, preset),
          size: imageSizeFor(preset),
          signal,
          fetchImpl
        });
        return { index, imageUrl: imageUrl || null };
      } catch (error) {
        return { index, imageUrl: null, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );
  const nextVariants = list.map((variant, index) =>
    results[index]?.imageUrl ? { ...variant, imageUrl: results[index].imageUrl } : variant
  );
  return {
    variants: nextVariants,
    imageAppliedCount: results.filter(result => result.imageUrl).length,
    imageErrors: results.filter(result => result.error).map(result => ({ index: result.index, error: result.error }))
  };
}

export async function runCreativeWorkflowWithAI({ brief, skillId, skill, brandKit = defaultBrandKit, aiConfig, enabledModes, signal, fetchImpl } = {}) {
  // 传 skill 对象（Flow 编排图合成）走自定义编排；传 skillId 走预设 skill。两条路共用同一套 AI 增强。
  const base = skill
    ? runCreativeWorkflowWithSkill({ brief, skill, brandKit })
    : runCreativeWorkflow({ brief, skillId, brandKit });

  if (!isAiConfigured(aiConfig)) {
    return { ...base, aiMeta: { used: false, reason: "no-system-config" } };
  }

  // enabledModes 由 Flow 节点存在性派生（无 copy 节点→不出文案，无 visual 节点→不出图）；缺省全开，保持向后兼容。
  const textEnabled = enabledModes ? enabledModes.text !== false : true;
  const imageEnabled = enabledModes ? enabledModes.image !== false : true;

  const preset = findPlatformPreset(base.brief.platform);
  const textModel = selectedModelFor(aiConfig, aiConfig?.selection, "text");
  const imageModel = selectedModelFor(aiConfig, aiConfig?.selection, "image");

  try {
    let variants = base.variants;
    let copyApplied = 0;

    if (textEnabled) {
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
      variants = merged.map(item => item.variant);
      copyApplied = merged.filter(item => item.applied).length;
    }

    let imageAppliedCount = 0;
    let imageErrors = [];
    if (imageEnabled && hasAiMode(aiConfig, "image")) {
      const imaged = await generateVariantImages({
        variants,
        brief: base.brief,
        brandKit,
        preset,
        aiConfig,
        signal,
        fetchImpl,
        maxImages: resolveMaxImages(aiConfig, variants.length)
      });
      variants = imaged.variants;
      imageAppliedCount = imaged.imageAppliedCount;
      imageErrors = imaged.imageErrors;
    }

    const imageApplied = imageAppliedCount > 0;
    return {
      ...base,
      variants,
      aiMeta: {
        used: copyApplied > 0 || imageApplied,
        provider: aiConfig.providerName || aiConfig.provider,
        model: textModel?.name || aiConfig.model,
        imageModel: imageApplied ? imageModel?.name || aiConfig.imageModel : undefined,
        copyApplied,
        imageApplied,
        imageAppliedCount,
        ...(imageErrors.length ? { imageErrors } : {})
      }
    };
  } catch (error) {
    return { ...base, aiMeta: { used: false, error: error instanceof Error ? error.message : String(error) } };
  }
}
