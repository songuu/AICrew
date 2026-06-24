// AI 增强工作流：在确定性管线之上叠加真实 LLM 文案与系统图像模型封面。
// 设计原则：
//  - 包装而非修改 runCreativeWorkflow —— 评分/结构/导出契约与 domain 测试不受影响。
//  - 无系统 AI 配置 → 原样回退确定性模拟。
//  - 任一 AI 调用失败 → 局部回退该 variant 的模拟文案，整体不抛错（aiMeta 记录降级）。
import { runCreativeWorkflow, runCreativeWorkflowWithSkill, findPlatformPreset, findSkill, defaultBrandKit, refreshVariantArtifacts } from "../domain.js";
import { hasAiMode, isAiConfigured, selectedModelFor } from "./config.js";
import { generateText, generateImage } from "./providers.js";
import { renderBrandClause, renderBrandImageHint } from "../brand/prompt.js";
import { materialNames } from "../storage/materialStore.js";
import { createDeferredArtifact, createFailedArtifact, createReadyArtifact, sanitizeArtifactError, upsertArtifact, variantImageRefKey } from "../artifacts.js";

// 文案 system prompt 分语言：zh（抖音/小红书）与 en（Western 平台 reels/shorts/shopify）。
// 语言由 preset.lang 决定（单源），copySystemFor 缺省回退 zh（向后兼容旧数据 / 无 lang 的 Flow 合成 brief）。
const COPY_SYSTEM_ZH = [
  "你是抖音 / 小红书的爆款文案操盘手，最擅长用开场钩子在 3 秒内抓住注意力。",
  "原则：说人话、口语化中文、具体优先于笼统；拒绝空泛形容词与 AI 腔（如「赋能 / 打造卓越体验 / 不容错过 / 一站式」）；不编造、不夸大、不堆砌功效。",
  "严格只输出 JSON，不要解释、不要 markdown 代码块。"
].join("\n");

const COPY_SYSTEM_EN = [
  "You are a world-class viral copywriter for Instagram Reels / YouTube Shorts / Shopify product pages, an expert at stopping the scroll within the first seconds with a strong hook.",
  "Principles: write like a real person in conversational, native English; specific over generic; reject empty adjectives and AI-slop (e.g. 'empower / unlock / elevate / seamless / game-changer'); never fabricate, exaggerate, or stack claims.",
  "Output strictly JSON only — no explanation, no markdown code fences."
].join("\n");

function copySystemFor(preset) {
  return preset?.lang === "en" ? COPY_SYSTEM_EN : COPY_SYSTEM_ZH;
}

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

// variant.angle（确定性管线的 3 个角度）→ 对应钩子框架名。
// 平台 hookPatterns 是"可选框架池"（全 variant 共享）；这里把每条 variant 锁定到一个**专属**框架，
// 让 3 条文案真正差异化（而非都用同一套平台框架）。促销冲刺没有同名框架，映射到「紧迫」。
const ANGLE_FRAMEWORK = {
  痛点开场: "痛点开场",
  好奇缺口: "好奇缺口",
  促销冲刺: "紧迫"
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

// 以下三段对应本轮新增的 trend / persona / seo 节点：仅当 skill 编排了该节点时注入，
// 否则返回 ""（与改动前 prompt 完全一致，flowToSkill 合成 skill 向后兼容）。绝不含「创作技能」字面量。

// trend 节点 → 选题角度：让"选题"自带流量，而非泛泛介绍产品。
// 有 pre-pass concrete 输出（enrichment.trend.angles）→ 注入具体角度；否则回退泛指令。保留「选题角度」label。
function renderTrendGuidance(brief, skill, enrichment) {
  if (!skill?.agents?.includes("trend")) return "";
  const angles = enrichment?.trend?.angles;
  if (Array.isArray(angles) && angles.length) {
    return `选题角度（已生成候选，择最强切入）：${angles.join("；")}`;
  }
  return `选题角度：结合 ${brief.platform} 当下热点 / 季节场景切入，而非泛泛介绍产品——让选题本身自带流量。`;
}

// persona 节点 → 人设口吻：第一人称真人腔，去官方腔与硬广。
function renderPersonaGuidance(brief, skill, enrichment) {
  if (!skill?.agents?.includes("persona")) return "";
  const persona = enrichment?.persona;
  if (persona && (persona.voice || Array.isArray(persona.phrases))) {
    const phrases = Array.isArray(persona.phrases) && persona.phrases.length ? `；常用措辞：${persona.phrases.join(" / ")}` : "";
    return `人设口吻（已定调，请贴合）：${persona.voice || ""}${phrases}`;
  }
  return `人设口吻：以真实创作者第一人称、像朋友向${brief.targetAudience}安利的口吻写，带个人体验细节，口语化、有情绪，杜绝官方腔与硬广。`;
}

// seo 节点 → 搜索优化：关键词 + 标签策略，提升被搜索命中率。
function renderSeoGuidance(brief, skill, enrichment) {
  if (!skill?.agents?.includes("seo")) return "";
  const seo = enrichment?.seo;
  if (seo && (Array.isArray(seo.keywords) || Array.isArray(seo.hashtags))) {
    const kw = Array.isArray(seo.keywords) && seo.keywords.length ? `核心词 ${seo.keywords.join("、")}` : "";
    const tags = Array.isArray(seo.hashtags) && seo.hashtags.length ? `标签 ${seo.hashtags.join(" ")}` : "";
    return `搜索优化（已生成，请采用）：${[kw, tags].filter(Boolean).join("；")}；正文前 20 字自然嵌入核心关键词。`;
  }
  return `搜索优化：hashtags 至少含 1-2 个${brief.platform}高搜索量核心词 + 1 个长尾词；正文前 20 字自然嵌入核心关键词，提升被搜索命中率。`;
}

// —— trend/persona/seo 独立结构化生成 pass ——
// 把原本 prompt 指令级的三节点升级为「先产结构化输出，再喂文案」：每个节点级 gated、
// 跨 3 个 variant 共享一次调用；任一失败 → null → renderXGuidance 回退泛指令（优雅降级）。
// 输出语言随 preset.lang（复用 copySystemFor 的语言 / JSON-only 约束）。
function enrichLangNote(preset) {
  return preset?.lang === "en" ? "Output all string values in natural English." : "用中文输出所有字段值。";
}

function buildTrendPrompt(brief, preset) {
  return [
    `为${brief.platform}的「${brief.productName}」生成 3 个高流量选题角度（结合平台热点 / 季节场景 / 受众痛点切入，而非泛泛介绍产品）。`,
    `受众：${brief.targetAudience}；卖点：${brief.sellingPoints}。`,
    enrichLangNote(preset),
    `只输出 JSON：{"angles":["角度1","角度2","角度3"]}`
  ].join("\n");
}

function buildPersonaPrompt(brief, preset) {
  return [
    `为面向「${brief.targetAudience}」的带货内容定义一个真实创作者的人设口吻（第一人称、口语、有情绪，杜绝官方腔与硬广）。`,
    enrichLangNote(preset),
    `只输出 JSON：{"voice":"一句话口吻定调","phrases":["标志性措辞1","标志性措辞2"]}`
  ].join("\n");
}

function buildSeoPrompt(brief, preset) {
  return [
    `为${brief.platform}的「${brief.productName}」做搜索流量优化，产出核心关键词与标签策略。`,
    `卖点：${brief.sellingPoints}；受众：${brief.targetAudience}。`,
    enrichLangNote(preset),
    `只输出 JSON：{"keywords":["核心词1","核心词2","长尾词"],"hashtags":["#标签1","#标签2"]}`
  ].join("\n");
}

const ENRICHMENT_NODES = [
  { id: "trend", build: buildTrendPrompt },
  { id: "persona", build: buildPersonaPrompt },
  { id: "seo", build: buildSeoPrompt }
];

// 对 skill 编排了的 trend/persona/seo 节点各跑一次结构化 pre-pass（并发，每节点一次、跨 variant 共享）。
// 返回 {trend, persona, seo}：成功为解析后对象，缺省/失败为 null（下游 renderXGuidance 回退泛指令）。
async function runEnrichmentPasses({ brief, preset, skill, aiConfig, signal, fetchImpl }) {
  const result = { trend: null, persona: null, seo: null };
  const active = ENRICHMENT_NODES.filter(node => skill?.agents?.includes(node.id));
  if (!active.length) return result;
  await Promise.all(
    active.map(async node => {
      try {
        const text = await generateText(aiConfig, {
          system: copySystemFor(preset),
          prompt: node.build(brief, preset),
          maxTokens: 300,
          signal,
          fetchImpl
        });
        const parsed = extractJson(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result[node.id] = parsed;
      } catch {
        /* 局部失败 → 保持 null，下游回退泛指令 */
      }
    })
  );
  return result;
}

// 把 pre-pass 结构化产物格式化成人类可读的 agent artifact 字符串（surface 给前端）。
// 字段缺失/空 → 返回 null（调用方回退 domain 静态 artifact）。
function formatEnrichmentArtifact(nodeId, data) {
  if (!data || typeof data !== "object") return null;
  if (nodeId === "trend") {
    const angles = Array.isArray(data.angles) ? data.angles.filter(Boolean) : [];
    return angles.length ? `选题角度（AI 生成）：${angles.join("；")}` : null;
  }
  if (nodeId === "persona") {
    const voice = typeof data.voice === "string" ? data.voice.trim() : "";
    const phrases = Array.isArray(data.phrases) ? data.phrases.filter(Boolean) : [];
    if (!voice && !phrases.length) return null;
    return `人设口吻（AI 生成）：${voice}${phrases.length ? `｜措辞：${phrases.join("/")}` : ""}`;
  }
  if (nodeId === "seo") {
    const keywords = Array.isArray(data.keywords) ? data.keywords.filter(Boolean) : [];
    const hashtags = Array.isArray(data.hashtags) ? data.hashtags.filter(Boolean) : [];
    if (!keywords.length && !hashtags.length) return null;
    const kw = keywords.length ? `关键词 ${keywords.join("、")}` : "";
    const tags = hashtags.length ? `标签 ${hashtags.join(" ")}` : "";
    return `搜索优化（AI 生成）：${[kw, tags].filter(Boolean).join("｜")}`;
  }
  return null;
}

// 把当前 variant 锁定到其专属钩子框架（让 3 条文案差异化）。无匹配角度则返回 ""（向后兼容）。
function renderAngleFramework(variant) {
  const name = ANGLE_FRAMEWORK[variant?.angle] || (HOOK_FRAMEWORKS[variant?.angle] ? variant.angle : null);
  if (!name) return "";
  return `本条主打「${name}」框架：${HOOK_FRAMEWORKS[name]}。钩子必须明确体现该框架的套路，与其他角度形成差异。`;
}

function buildCopyPrompt(brief, variant, brandKit, preset, skill, enrichment) {
  return [
    `为「${variant.angle}」角度生成一条可直接发布的${brief.platform}文案，必须返回严格 JSON：`,
    `{"hook":"开场钩子","caption":"正文文案","hashtags":["#标签1","#标签2"]}`,
    // 输出语言由 preset.lang 决定（单源）：en 平台写英文，zh（含缺省）保持中文。
    // lang!=="en" 返回 ""（经 .filter 剔除）→ 中文 prompt 与改动前逐字一致，向后兼容。
    preset?.lang === "en"
      ? `Output language: write hook, caption, and hashtags ALL in natural, native English. Any Chinese guidance below is meta-instruction — still write the copy itself in English.`
      : "",
    ``,
    `产品：${brief.productName}`,
    `卖点：${brief.sellingPoints}`,
    `受众：${brief.targetAudience}`,
    `平台：${brief.platform}（调性：${preset.tone}）`,
    `目标：${brief.goal}`,
    ``,
    `痛点推断：先从卖点与受众推断其最戳心的痛点或渴望，钩子与正文都围绕它展开（而非罗列产品功能）。`,
    renderTrendGuidance(brief, skill, enrichment),
    renderHookGuidance(brief, preset, skill),
    renderAngleFramework(variant),
    renderPersonaGuidance(brief, skill, enrichment),
    renderCopyRules(preset),
    renderSeoGuidance(brief, skill, enrichment),
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

// 去除模型常见噪声：```json 代码围栏 + 对象/数组尾随逗号（二者都会让 JSON.parse 抛错，
// 导致更强的 AI 文案被静默丢弃、回退到弱兜底）。
function stripJsonNoise(text) {
  return String(text)
    .replace(/```(?:json)?/gi, "")
    .replace(/,(\s*[}\]])/g, "$1");
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = stripJsonNoise(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  // 依次尝试：原文 → 去噪全文 → 去噪后的 {…} 切片，取首个可解析者。
  for (const candidate of [text, cleaned, match ? match[0] : null]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next candidate */
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
      if (index >= limit) return { index, variantId: variant?.id, imageUrl: null, skipped: true };
      try {
        const imageUrl = await generateImage(aiConfig, {
          prompt: buildImagePrompt(brief, variant, brandKit, preset, skill),
          size: imageSizeFor(preset),
          signal,
          fetchImpl
        });
        return { index, variantId: variant?.id, imageUrl: imageUrl || null };
      } catch (error) {
        // provider 原始报错可能含 ?api_key=/Bearer/sk- token；此处即脱敏，避免经 imageErrors→aiMeta 持久化到 localStorage/Supabase 时泄漏。
        return { index, variantId: variant?.id, imageUrl: null, error: sanitizeArtifactError(error) };
      }
    })
  );
  const nextVariants = list.map((variant, index) => {
    const result = results[index];
    if (result?.imageUrl) {
      const artifact = createReadyArtifact({
        scopeId: variant.id,
        type: "image",
        name: "cover.png",
        mimeType: "image/png",
        url: result.imageUrl,
        refKey: variantImageRefKey(variant.id),
        source: "generated",
        variantId: variant.id,
        agentId: "visual"
      });
      return { ...variant, imageUrl: result.imageUrl, artifacts: upsertArtifact(variant.artifacts, artifact) };
    }
    if (result?.error) {
      const artifact = createFailedArtifact({
        scopeId: variant.id,
        type: "image",
        name: "cover.png",
        mimeType: "image/png",
        refKey: variantImageRefKey(variant.id),
        source: "generated",
        variantId: variant.id,
        agentId: "visual",
        error: result.error
      });
      return { ...variant, artifacts: upsertArtifact(variant.artifacts, artifact) };
    }
    if (result?.skipped) {
      const artifact = createDeferredArtifact({
        scopeId: variant.id,
        type: "image",
        name: "cover.png",
        mimeType: "image/png",
        refKey: variantImageRefKey(variant.id),
        source: "generated",
        variantId: variant.id,
        agentId: "visual",
        reason: "已达到本次出图上限"
      });
      return { ...variant, artifacts: upsertArtifact(variant.artifacts, artifact) };
    }
    return variant;
  });
  return {
    variants: nextVariants,
    imageAppliedCount: results.filter(result => result.imageUrl).length,
    imageErrors: results.filter(result => result.error).map(result => ({ index: result.index, variantId: result.variantId, error: result.error }))
  };
}

export async function runCreativeWorkflowWithAI({ brief, skillId, skill, brandKit = defaultBrandKit, aiConfig, enabledModes, signal, fetchImpl, variantCount } = {}) {
  // 传 skill 对象（Flow 编排图合成）走自定义编排；传 skillId 走预设 skill。两条路共用同一套 AI 增强。
  const base = skill
    ? runCreativeWorkflowWithSkill({ brief, skill, brandKit, variantCount })
    : runCreativeWorkflow({ brief, skillId, brandKit, variantCount });

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
    let enrichment = { trend: null, persona: null, seo: null };

    if (textEnabled) {
      // 先跑 trend/persona/seo 独立结构化 pre-pass（每节点一次，跨 3 variant 共享），
      // 再把 concrete 输出注入每条 copy prompt。pre-pass 失败 → renderXGuidance 回退泛指令。
      enrichment = await runEnrichmentPasses({
        brief: base.brief,
        preset,
        skill: activeSkill,
        aiConfig,
        signal,
        fetchImpl
      });
      const copies = await Promise.all(
        base.variants.map(async variant => {
          try {
            const text = await generateText(aiConfig, {
              system: copySystemFor(preset),
              prompt: buildCopyPrompt(base.brief, variant, brandKit, preset, activeSkill, enrichment),
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
      variants = merged.map(item => refreshVariantArtifacts(base.brief, item.variant, activeSkill));
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
    // surface pre-pass 产物到 agent 步骤 artifact：immutable map —— 成功节点换 concrete artifact，
    // 其余原样返回（base.agents 元素不被 mutate，守「AI 包装不改 domain」）。
    const enrichedAgents = base.agents.map(agent => {
      const art = formatEnrichmentArtifact(agent.id, enrichment[agent.id]);
      return art ? { ...agent, artifact: art } : agent;
    });
    return {
      ...base,
      variants,
      agents: enrichedAgents,
      aiMeta: {
        used: copyApplied > 0 || imageApplied,
        provider: aiConfig.providerName || aiConfig.provider,
        model: textModel?.name || aiConfig.model,
        imageModel: imageApplied ? imageModel?.name || aiConfig.imageModel : undefined,
        copyApplied,
        imageApplied,
        imageAppliedCount,
        // trend/persona/seo 独立 pre-pass 的实际结构化产物（成功为内容对象，失败/缺省为 null）。
        prePasses: {
          trend: enrichment.trend,
          persona: enrichment.persona,
          seo: enrichment.seo
        },
        ...(imageErrors.length ? { imageErrors } : {})
      }
    };
  } catch (error) {
    // 灾难性失败的报错同样脱敏后才进 aiMeta（持久化面），不泄漏 token/url。
    return { ...base, aiMeta: { used: false, error: sanitizeArtifactError(error) } };
  }
}
