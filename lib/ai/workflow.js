// AI 增强工作流：在确定性管线之上叠加真实 LLM 文案与系统图像模型封面。
// 设计原则：
//  - 包装而非修改 runCreativeWorkflow —— 评分/结构/导出契约与 domain 测试不受影响。
//  - 无系统 AI 配置 → 原样回退确定性模拟。
//  - 任一 AI 调用失败 → 局部回退该 variant 的模拟文案，整体不抛错（aiMeta 记录降级）。
import { runCreativeWorkflow, runCreativeWorkflowWithSkill, findPlatformPreset, findSkill, defaultBrandKit } from "../domain.js";
import { hasAiMode, isAiConfigured, selectedModelFor } from "./config.js";
import { generateText, generateImage } from "./providers.js";
import { renderBrandClause, renderBrandImageHint } from "../brand/prompt.js";
import { materialNames } from "../storage/materialStore.js";

const COPY_SYSTEM = [
  "你是抖音 / 小红书的爆款文案操盘手，最擅长用开场钩子在 3 秒内抓住注意力。",
  "原则：说人话、口语化中文、具体优先于笼统；拒绝空泛形容词与 AI 腔（如「赋能 / 打造卓越体验 / 不容错过 / 一站式」）；不编造、不夸大、不堆砌功效。",
  "严格只输出 JSON，不要解释、不要 markdown 代码块。"
].join("\n");

// 公认钩子框架库：名称 → 一句话公式。平台 preset.hookPatterns 选用哪几个，
// 在此解释语义并注入 prompt，让模型有"套路"可依而非自由发挥（这是推文从泛词到吸引力的关键）。
const HOOK_FRAMEWORKS = {
  痛点开场: "点破受众痛点 → 放大代价 → 给出解法（PAS）",
  好奇缺口: "抛出反常 / 未说破的信息，逼读者点进来补全",
  具体数字: "用精确数字 / 结果制造可信度（如 3 个细节 / 11 天见效）",
  反共识: "先立常识再反转：多数人都做错了，其实……",
  真实自白: "第一人称真实经历 / 踩坑，建立同温层信任",
  社会证明: "先甩结果 / 口碑数据，再讲方法",
  紧迫: "限时 / 稀缺 / 错过成本，催出即时行动"
};

// 选中预设 skill 时，把该技能的产出承诺 / 适用人群作为风格锚点注入 prompt，
// 使「选了哪个技能」真正改变生成结果（对标 RoboNeo 的技能驱动生成）。
// 纯编排图（无 bestFor）返回空串，prompt 与改动前完全一致（向后兼容）。
function renderSkillClause(skill) {
  if (!skill || !skill.bestFor) return "";
  return `创作技能：${skill.name}（产出：${skill.promise}；适用：${skill.bestFor}）`;
}

// 渲染平台优选钩子框架 + （存在 hook 节点时）Hook Lab 多候选选优指令。
// 无可解析框架时返回空串（prompt 与改动前一致，向后兼容）。绝不含「创作技能」字面量。
function renderHookGuidance(brief, preset, skill) {
  const patterns = Array.isArray(preset?.hookPatterns) ? preset.hookPatterns : [];
  const lines = patterns
    .map(name => (HOOK_FRAMEWORKS[name] ? `- ${name}：${HOOK_FRAMEWORKS[name]}` : null))
    .filter(Boolean);
  if (!lines.length) return "";
  const head = `开场钩子必须套用以下任一框架（${brief.platform}首屏 ${preset.hookSeconds} 秒决定生死）：`;
  // hook 节点存在 → Hook Lab 模式：内部多候选自评，只输出最强（JSON schema 不变）。
  const lab = skill?.agents?.includes("hook")
    ? "先在心里生成 3-5 个候选钩子，按「能否停下滑动」自评打分，只把最强的一个放进 hook 字段。"
    : "";
  return [head, ...lines, lab].filter(Boolean).join("\n");
}

// 渲染平台文案规范（字数 / emoji / 排版 / CTA 风格），来自 preset.copyRules。
function renderCopyRules(preset) {
  const rules = preset?.copyRules;
  if (!rules) return "";
  const lines = ["文案规范（务必遵守）："];
  if (rules.hookMaxChars) lines.push(`- 钩子 ≤ ${rules.hookMaxChars} 字，一句话说完`);
  if (Array.isArray(rules.captionRange)) lines.push(`- 正文 ${rules.captionRange[0]}-${rules.captionRange[1]} 字`);
  if (rules.emoji) lines.push(`- Emoji：${rules.emoji}`);
  if (rules.lineBreaks) lines.push(`- 排版：${rules.lineBreaks}`);
  if (rules.ctaStyle) {
    const examples = Array.isArray(rules.ctaExamples) && rules.ctaExamples.length ? `（参考：${rules.ctaExamples.join(" / ")}）` : "";
    lines.push(`- CTA：${rules.ctaStyle}${examples}`);
  }
  return lines.join("\n");
}

function buildCopyPrompt(brief, variant, brandKit, preset, skill) {
  return [
    `为「${variant.angle}」角度生成一条可直接发布的${brief.platform}文案，必须返回严格 JSON：`,
    `{"hook":"开场钩子","caption":"正文文案","hashtags":["#标签1","#标签2"]}`,
    ``,
    `产品：${brief.productName}`,
    `卖点：${brief.sellingPoints}`,
    `受众：${brief.targetAudience}`,
    `平台：${brief.platform}（调性：${preset.tone}）`,
    `目标：${brief.goal}`,
    ``,
    `痛点推断：先从卖点与受众推断其最戳心的痛点或渴望，钩子与正文都围绕它展开（而非罗列产品功能）。`,
    renderHookGuidance(brief, preset, skill),
    renderCopyRules(preset),
    renderSkillClause(skill),
    renderBrandClause(brandKit),
    ``,
    `只输出 JSON。`
  ]
    .filter(line => line !== "")
    .join("\n");
}

function buildImagePrompt(brief, variant, brandKit, preset, skill) {
  const parts = [
    `${brief.platform} ${preset.ratio} 封面图，产品：${brief.productName}。`,
    `角度：${variant.angle}；卖点：${brief.sellingPoints}；受众：${brief.targetAudience}。`,
    `风格：${brief.style}；${renderBrandImageHint(brandKit)}。`
  ];
  // 选中技能时注入技能风格锚点（与文案 prompt 同源），无技能时跳过。
  const skillClause = renderSkillClause(skill);
  if (skillClause) parts.push(`${skillClause}。`);
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
export async function generateVariantImages({ variants, brief, brandKit, preset, skill, aiConfig, signal, fetchImpl, maxImages } = {}) {
  const list = Array.isArray(variants) ? variants : [];
  const limit = Number.isFinite(maxImages) && maxImages >= 0 ? maxImages : list.length;
  const results = await Promise.all(
    list.map(async (variant, index) => {
      if (index >= limit) return { index, imageUrl: null, skipped: true };
      try {
        const imageUrl = await generateImage(aiConfig, {
          prompt: buildImagePrompt(brief, variant, brandKit, preset, skill),
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
  // 解析当前技能对象：Flow 合成 skill 直接用；预设 skillId 反查 domain；都没有则为空（纯编排图）。
  const activeSkill = skill || (skillId ? findSkill(skillId) : null);
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
              prompt: buildCopyPrompt(base.brief, variant, brandKit, preset, activeSkill),
              maxTokens: 900,
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
        skill: activeSkill,
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
