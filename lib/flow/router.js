// 中枢路由（Orchestrator Router）：自动模式的大脑。
//
// 输入一句创意，输出一张「带理由」的编排图：中枢推断平台与媒介意图，
// 匹配最贴合的预设 skill 作为骨架，并为每个入选 Agent 附一句理由。
// 理由链 rationale 不只是日志——它驱动「中枢思考」动画逐条点亮节点。
//
// 纯函数、可在 node --test 下验证；不做真实 LLM 调用（保持确定性，离线可跑）。
// AI 增强版可在此之上叠加，但默认启发式已能给出可解释的合理编排。

import { skills, parseBriefText, findPlatformPreset, isVideoSkill, findSkill } from "../domain.js";
import { linearFlow, getAgent } from "./model.js";

// 媒介意图关键词：命中视频类 → 走视频管线；命中图文类 → 走图文管线。
const VIDEO_HINTS = ["视频", "短视频", "video", "抖音", "douyin", "tiktok", "短剧", "口播", "vlog"];
const IMAGE_HINTS = ["图文", "种草", "小红书", "海报", "封面", "摄影", "photo", "详情页", "笔记"];

function detectMediaIntent(text = "") {
  const lower = text.toLowerCase();
  const wantsVideo = VIDEO_HINTS.some(hint => text.includes(hint) || lower.includes(hint));
  const wantsImage = IMAGE_HINTS.some(hint => text.includes(hint) || lower.includes(hint));
  if (wantsVideo && !wantsImage) return "video";
  if (wantsImage && !wantsVideo) return "image";
  return null; // 未明示，交给平台/skill 默认
}

// 给一个 skill 对当前创意打分：平台契合 + 媒介意图契合 + 名称/品类关键词命中。
function scoreSkill(skill, text, brief, mediaIntent) {
  let score = 0;
  const haystack = `${skill.name} ${skill.category}`.toLowerCase();
  const lower = text.toLowerCase();
  // 名称 / 品类关键词直接命中
  for (const token of haystack.split(/\s+/)) {
    if (token.length >= 2 && lower.includes(token)) score += 3;
  }
  if (skill.name && text.includes(skill.name)) score += 6;
  // 媒介意图契合
  if (mediaIntent === "video" && isVideoSkill(skill)) score += 5;
  if (mediaIntent === "image" && !isVideoSkill(skill)) score += 5;
  // 平台契合：skill 的视频属性与平台默认媒介一致
  const preset = findPlatformPreset(brief.platform);
  if (preset.id === "rednote" && !isVideoSkill(skill)) score += 4;
  if (preset.id === "tiktok" && isVideoSkill(skill)) score += 4;
  return score;
}

function mediaLabelFor(skill) {
  return isVideoSkill(skill) ? "视频" : "图文";
}

// 每个 Agent 入选的人话理由（中枢解释「为什么要它」）。
function reasonFor(agentId, brief) {
  const preset = findPlatformPreset(brief.platform);
  const reasons = {
    brief: `锁定目标与受众：${brief.targetAudience}`,
    trend: `先定 ${brief.platform} 选题角度，避免泛泛介绍产品`,
    strategy: `定内容角度，强化首 ${preset.hookSeconds}s 钩子`,
    hook: "生成候选开场钩子，选择最能停下滑动的一条",
    script: "把策略拆成可生产的脚本",
    storyboard: "拆镜头 / 段落，保证产品露出",
    visual: `生成 ${preset.ratio} 视觉，套品牌调性`,
    video: `合成 ${preset.ratio} 视频，适配 ${brief.platform}`,
    persona: `统一 ${brief.targetAudience} 能信任的真人口吻`,
    copy: "产出标题 / 正文 / 话题 / CTA",
    seo: `布局 ${brief.platform} 搜索关键词与标签，提升可发现性`,
    qa: "查品牌一致性、平台适配与合规",
    export: `打包 ${brief.platform} 可发布内容`
  };
  return reasons[agentId] || "执行该编排步骤";
}

function confidenceFor(topScore, runnerUpScore, usedFallback) {
  if (usedFallback) {
    return { level: "low", score: 0.3, reason: "输入信息不足，使用默认技能兜底" };
  }
  const margin = Math.max(0, topScore - runnerUpScore);
  const score = Math.max(0.35, Math.min(0.95, 0.45 + topScore / 25 + margin / 30));
  const level = score >= 0.75 ? "high" : score >= 0.55 ? "medium" : "low";
  return { level, score: Number(score.toFixed(2)), reason: `匹配分 ${topScore}，领先候选 ${margin}` };
}

function missingInputsFor(rawText, brief) {
  const text = String(rawText || "");
  const missing = [];
  if (brief.productName === "AICrew Product" && !/(?:产品|商品|product)[:：]?/i.test(text)) {
    missing.push("productName");
  }
  if (!/(?:受众|人群|audience)[:：]?/i.test(text)) missing.push("targetAudience");
  if (!/(?:目标|goal)[:：]?/i.test(text)) missing.push("goal");
  return missing;
}

function assumptionsFor({ brief, mediaIntent, matched, usedFallback, missingInputs }) {
  const assumptions = [
    `平台按「${brief.platform}」处理`,
    mediaIntent ? `媒介意图按「${mediaIntent === "video" ? "视频" : "图文"}」处理` : `媒介意图未明示，沿用技能「${matched.name}」的默认交付形态`
  ];
  if (missingInputs.includes("targetAudience")) assumptions.push(`受众未明示，使用默认受众「${brief.targetAudience}」`);
  if (missingInputs.includes("goal")) assumptions.push(`目标未明示，使用默认目标「${brief.goal}」`);
  if (usedFallback) assumptions.push("没有足够匹配信号，回退默认技能");
  return assumptions;
}

function riskFlagsFor({ matched, mediaIntent, missingInputs, usedFallback }) {
  const flags = [];
  if (usedFallback) flags.push("default-skill-fallback");
  if (missingInputs.length) flags.push("missing-inputs");
  if (mediaIntent === "video" && !isVideoSkill(matched)) flags.push("video-intent-but-image-skill");
  if (mediaIntent === "image" && isVideoSkill(matched)) flags.push("image-intent-but-video-skill");
  return flags;
}

function alternativesFor(ranked, matched) {
  return ranked
    .filter(item => item.skill.id !== matched.id)
    .slice(0, 3)
    .map(item => ({
      id: item.skill.id,
      name: item.skill.name,
      score: item.score,
      media: mediaLabelFor(item.skill)
    }));
}

/**
 * 中枢路由：创意文本 → 编排建议。
 * @returns {{
 *   flow, brief, matchedSkill: {id,name}, selectedSkill: {id,name,score},
 *   mediaIntent: 'video'|'image'|null,
 *   rationale: Array<{agentId, title, reason}>,
 *   rationaleByAgent: Record<string,string>,
 *   confidence: {level:string,score:number,reason:string},
 *   assumptions: string[],
 *   missingInputs: string[],
 *   alternatives: Array<{id,name,score,media}>,
 *   riskFlags: string[],
 *   summary: string
 * }}
 */
export function routeIdeaToFlow(ideaText = "", mode = "auto") {
  const brief = parseBriefText(ideaText);
  const mediaIntent = detectMediaIntent(ideaText);

  const ranked = skills
    .map(skill => ({ skill, score: scoreSkill(skill, ideaText, brief, mediaIntent) }))
    .sort((a, b) => b.score - a.score);
  // 全 0 分（创意太泛）时回退到第一个预设，保证永远给得出方案。
  const usedFallback = ranked[0].score <= 0;
  const matched = usedFallback ? findSkill(skills[0].id) : ranked[0].skill;
  const matchedScore = usedFallback ? 0 : ranked[0].score;

  const flow = linearFlow(matched.agents, mode, brief);
  const rationale = matched.agents
    .map(agentId => {
      const agent = getAgent(agentId);
      return agent ? { agentId, title: agent.title, reason: reasonFor(agentId, brief) } : null;
    })
    .filter(Boolean);
  const rationaleByAgent = Object.fromEntries(rationale.map(item => [item.agentId, item.reason]));
  const missingInputs = missingInputsFor(ideaText, brief);
  const assumptions = assumptionsFor({ brief, mediaIntent, matched, usedFallback, missingInputs });
  const riskFlags = riskFlagsFor({ matched, mediaIntent, missingInputs, usedFallback });

  const mediaLabel = mediaLabelFor(matched);
  return {
    flow,
    brief,
    matchedSkill: { id: matched.id, name: matched.name },
    selectedSkill: { id: matched.id, name: matched.name, score: matchedScore },
    mediaIntent,
    rationale,
    rationaleByAgent,
    confidence: confidenceFor(matchedScore, ranked.find(item => item.skill.id !== matched.id)?.score || 0, usedFallback),
    assumptions,
    missingInputs,
    alternatives: alternativesFor(ranked, matched),
    riskFlags,
    summary: `中枢识别为「${brief.platform} · ${mediaLabel}」，匹配「${matched.name}」，编排 ${matched.agents.length} 个 Agent。`
  };
}
