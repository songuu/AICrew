// 导演台 LLM 意图分类层：自然语言 → 结构化 ops，再由纯函数 applyDirectorOps 落地到编排图。
// 与 director.js 的确定性正则解析互补：LLM 主、正则兜底（见 director.js:resolveDirectorCommand）。
// applyDirectorOps 纯函数、无副作用，可离线测试；classifyDirectorIntent 经 generateText，失败回退 null。

import { generateText } from "../ai/providers.js";
import { agents } from "../domain.js";
import { createFlow, addNode, removeNode, connect, reorderNode, hasAgent, hasBranching } from "./model.js";

// 可编排 Agent 白名单（明确排除 video：本期视频节点不开放）。
const NON_VIDEO_AGENTS = agents.filter(agent => agent.id !== "video").map(agent => agent.id);

const INTENT_SYSTEM = "你是创作编排助手。把用户的自然语言指令翻译为对编排图的结构化操作。严格只输出 JSON，不要解释、不要 markdown 代码块。";

function buildIntentPrompt(text, flow) {
  const present = (flow?.nodes || []).map(node => node.agentId);
  return [
    `可用 Agent（仅这些，绝不含 video）：${NON_VIDEO_AGENTS.join("、")}`,
    `当前编排图节点（顺序）：${present.length ? present.join(" → ") : "（空）"}`,
    `用户指令：${text}`,
    ``,
    `返回严格 JSON：{"ops":[{"op":"add|remove|connect|reorder|clear|run","agent":"<id>","to":"<id>","position":"first|last"}],"reply":"一句中文说明"}`,
    `约定：add/remove/reorder 用 agent；connect 用 agent(起点)+to(终点)；clear/run 无需 agent。只输出 JSON。`
  ].join("\n");
}

function getAgent(id) {
  return agents.find(agent => agent.id === id) || null;
}

// 纯函数：把结构化 ops 顺序落地到 flow。返回 { flow, reply, run? }。video 一律硬拒（守护硬约束）。
export function applyDirectorOps(flow, ops) {
  let current = flow;
  let run = false;
  const notes = [];

  for (const op of Array.isArray(ops) ? ops : []) {
    const action = op?.op;
    if (action === "run") {
      run = true;
      notes.push("开始执行当前编排。");
      continue;
    }
    if (action === "clear") {
      current = createFlow("manual", current.brief);
      notes.push("已清空画布。");
      continue;
    }
    const agent = getAgent(op?.agent);
    if (action === "add") {
      if (!agent) notes.push("没识别出要添加的 Agent。");
      else if (agent.id === "video") notes.push("视频节点暂未开放，未来支持 🎬。");
      else if (hasAgent(current, agent.id)) notes.push(`${agent.title} 已在流程里。`);
      else {
        current = addNode(current, agent.id);
        notes.push(`已加入 ${agent.title}。`);
      }
      continue;
    }
    if (action === "remove") {
      if (agent && hasAgent(current, agent.id)) {
        const node = current.nodes.find(item => item.agentId === agent.id);
        current = removeNode(current, node.id);
        notes.push(`已移除 ${agent.title}。`);
      } else notes.push("没找到要移除的 Agent。");
      continue;
    }
    if (action === "reorder") {
      if (agent && hasAgent(current, agent.id) && !hasBranching(current)) {
        const index = current.nodes.findIndex(item => item.agentId === agent.id);
        const toLast = op.position !== "first";
        current = reorderNode(current, index, toLast ? current.nodes.length - 1 : 0);
        notes.push(`已把 ${agent.title} 移到${toLast ? "最后" : "最前"}。`);
      } else notes.push("无法重排（分支流程或未找到 Agent）。");
      continue;
    }
    if (action === "connect") {
      const to = getAgent(op?.to);
      const fromNode = agent && current.nodes.find(item => item.agentId === agent.id);
      const toNode = to && current.nodes.find(item => item.agentId === to.id);
      if (fromNode && toNode) {
        const result = connect(current, fromNode.id, toNode.id);
        current = result.flow;
        notes.push(result.ok ? `已连线 ${agent.title} → ${to.title}。` : "连不上，换个方向试试。");
      } else notes.push("连线需要两个已存在的 Agent。");
      continue;
    }
  }

  return { flow: current, reply: notes.join(" ") || "未识别到可执行的操作。", run };
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

// LLM 意图分类：自然语言 → { ops, reply }。无 aiConfig / 调用失败 / 解析失败 → null（交由 resolve 兜底）。
export async function classifyDirectorIntent({ text, flow, aiConfig, signal, fetchImpl } = {}) {
  if (!aiConfig) return null;
  try {
    const raw = await generateText(aiConfig, {
      system: INTENT_SYSTEM,
      prompt: buildIntentPrompt(text, flow),
      maxTokens: 400,
      signal,
      fetchImpl
    });
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.ops)) return null;
    return parsed;
  } catch {
    return null;
  }
}
