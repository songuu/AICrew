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

// 每个 Agent 入选的人话理由（中枢解释「为什么要它」）。
function reasonFor(agentId, brief) {
  const preset = findPlatformPreset(brief.platform);
  const reasons = {
    brief: `锁定目标与受众：${brief.targetAudience}`,
    strategy: `定内容角度，强化首 ${preset.hookSeconds}s 钩子`,
    script: "把策略拆成可生产的脚本",
    storyboard: "拆镜头 / 段落，保证产品露出",
    visual: `生成 ${preset.ratio} 视觉，套品牌调性`,
    video: `合成 ${preset.ratio} 视频，适配 ${brief.platform}`,
    copy: "产出标题 / 正文 / 话题 / CTA",
    qa: "查品牌一致性、平台适配与合规",
    export: `打包 ${brief.platform} 可发布内容`
  };
  return reasons[agentId] || "执行该编排步骤";
}

/**
 * 中枢路由：创意文本 → 编排建议。
 * @returns {{
 *   flow, brief, matchedSkill: {id,name},
 *   mediaIntent: 'video'|'image'|null,
 *   rationale: Array<{agentId, title, reason}>,
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
  const matched = ranked[0].score > 0 ? ranked[0].skill : findSkill(skills[0].id);

  const flow = linearFlow(matched.agents, mode, brief);
  const rationale = matched.agents
    .map(agentId => {
      const agent = getAgent(agentId);
      return agent ? { agentId, title: agent.title, reason: reasonFor(agentId, brief) } : null;
    })
    .filter(Boolean);

  const mediaLabel = isVideoSkill(matched) ? "视频" : "图文";
  return {
    flow,
    brief,
    matchedSkill: { id: matched.id, name: matched.name },
    mediaIntent,
    rationale,
    summary: `中枢识别为「${brief.platform} · ${mediaLabel}」，匹配「${matched.name}」，编排 ${matched.agents.length} 个 Agent。`
  };
}
