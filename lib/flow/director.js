// 导演台指令解析器：自然语言 → 编排图变更。纯函数、无 React/DOM 依赖，可在 node --test 验证。
//
// 与渲染分离（对齐 canvas：model 与 CanvasStudio 分层）。MVP 用确定性命令式解析，
// 离线可跑、可测、可解释；未来可在 fallback 分支叠加 LLM 意图识别。

import { agents } from "../domain.js";
import { createFlow, addNode, removeNode, connect, reorderNode, hasAgent, hasBranching } from "./model.js";
import { classifyDirectorIntent, applyDirectorOps } from "./intent.js";

// 别名表是匹配的关键：agent 的 title 是「视觉资产」，但用户会简写「视觉」。
// 只靠 title 全词匹配会让「加视觉」失败，所以为每个 agent 维护口语关键词。
export const AGENT_ALIASES = {
  brief: ["需求", "理解", "brief"],
  trend: ["趋势", "选题", "热点", "trend"],
  strategy: ["策略", "策划", "strategy"],
  hook: ["钩子", "开场", "标题钩子", "hook"],
  script: ["脚本", "script"],
  storyboard: ["分镜", "storyboard"],
  visual: ["视觉", "封面", "配图", "visual"],
  video: ["视频", "video"],
  persona: ["人设", "口吻", "语气", "persona"],
  copy: ["文案", "标题", "copy"],
  seo: ["搜索", "关键词", "标签", "seo", "SEO"],
  qa: ["质检", "质量", "检查", "审核", "qa"],
  export: ["导出", "打包", "export"]
};

export function matchAgentInText(text) {
  const lower = text.toLowerCase();
  return (
    agents.find(agent => (AGENT_ALIASES[agent.id] || []).some(alias => text.includes(alias) || lower.includes(alias))) ||
    agents.find(agent => text.includes(agent.title) || text.includes(agent.name) || lower.includes(agent.id)) ||
    null
  );
}

/**
 * 解析一条导演指令，返回 { flow, reply, run? }。
 * flow 永远是新对象（成功变更）或原对象（无变更 / 失败），绝不原地修改。
 */
export function parseDirectorCommand(text, flow) {
  const t = String(text || "").trim();
  if (!t) return { flow, reply: "说点什么吧，比如「加一个视觉 Agent」。" };

  if (/^(清空|重置|reset)/i.test(t)) {
    return { flow: createFlow("manual", flow.brief), reply: "已清空画布，从零开始编排。" };
  }
  if (/(运行|执行|生成|开跑|run)/i.test(t)) {
    return { flow, reply: "收到，开始执行当前编排。", run: true };
  }

  // 重排：「把 X 放最后 / 放最前」。分支流程会丢结构，明确拒绝。
  if (/(放|移|挪).*(最后|末尾|最前|开头|最前面)/.test(t)) {
    const agent = matchAgentInText(t);
    if (agent && hasAgent(flow, agent.id)) {
      if (hasBranching(flow)) {
        return { flow, reply: "当前是分支流程，重排会打乱连线。请用「X 连 Y」直接调整连线。" };
      }
      const index = flow.nodes.findIndex(node => node.agentId === agent.id);
      const toLast = /(最后|末尾)/.test(t);
      const next = reorderNode(flow, index, toLast ? flow.nodes.length - 1 : 0);
      return { flow: next, reply: `已把 ${agent.title} 移到${toLast ? "最后" : "最前"}。` };
    }
    return { flow, reply: "没找到要移动的 Agent。" };
  }

  // 连线：「X 连 Y」「X 到 Y」「X→Y」
  const linkMatch = t.match(/(.+?)\s*(?:连到?|到|->|→|连接)\s*(.+)/);
  if (linkMatch && /(连|到|->|→|连接)/.test(t)) {
    const from = matchAgentInText(linkMatch[1]);
    const to = matchAgentInText(linkMatch[2]);
    if (from && to) {
      const fromNode = flow.nodes.find(node => node.agentId === from.id);
      const toNode = flow.nodes.find(node => node.agentId === to.id);
      if (fromNode && toNode) {
        const result = connect(flow, fromNode.id, toNode.id);
        return {
          flow: result.flow,
          reply: result.ok
            ? `已连线 ${from.title} → ${to.title}。`
            : `连不上（${result.reason === "cycle" ? "会形成环" : result.reason}），换个方向试试。`
        };
      }
    }
  }

  const agent = matchAgentInText(t);
  if (/(删|去掉|移除|删除|remove)/.test(t)) {
    if (agent && hasAgent(flow, agent.id)) {
      const node = flow.nodes.find(item => item.agentId === agent.id);
      return { flow: removeNode(flow, node.id), reply: `已移除 ${agent.title}。` };
    }
    return { flow, reply: "没找到要移除的 Agent。" };
  }
  if (/(加|添加|增加|放|来个|来一个|add)/.test(t) || agent) {
    if (!agent) return { flow, reply: "没识别出是哪个 Agent，可用：需求/策略/脚本/分镜/视觉/视频/文案/质检/导出。" };
    if (agent.id === "video") {
      return { flow, reply: "视频节点暂未开放，未来支持 🎬。先用视觉 + 文案搭图文流程吧。" };
    }
    if (hasAgent(flow, agent.id)) return { flow, reply: `${agent.title} 已经在流程里了。` };
    return { flow: addNode(flow, agent.id), reply: `已加入 ${agent.title}（${agent.responsibility}）。` };
  }
  return { flow, reply: "可以说：加视觉 / 删质检 / 视觉连文案 / 运行。" };
}

/**
 * 真对话入口：LLM 意图优先，失败 / 无配置 / 无可执行 ops 时回退确定性正则解析。
 * 产出形状与 parseDirectorCommand 兼容（{flow, reply, run?}），额外带 source 标记来源。
 * reply 仍为 string（不破坏 OrchestratorConsole 渲染契约），LLM 给的自然语言 reply 优先。
 */
export async function resolveDirectorCommand({ text, flow, aiConfig, signal, fetchImpl } = {}) {
  const intent = await classifyDirectorIntent({ text, flow, aiConfig, signal, fetchImpl });
  if (intent && Array.isArray(intent.ops) && intent.ops.length) {
    const applied = applyDirectorOps(flow, intent.ops);
    return { ...applied, reply: intent.reply || applied.reply, source: "llm" };
  }
  return { ...parseDirectorCommand(text, flow), source: "regex" };
}
