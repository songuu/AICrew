// Flow 执行器：把编排图跑成 task。
//
// 唯一职责是「校验 + 物化 skill + 委托 domain/ai 管线」——不重新发明评分 / 导出 / 事件，
// 因此三种编排模式的产出与预设 skill 完全同构，前端所有 task 视图无需改动即可复用。

import { runCreativeWorkflowWithSkill, defaultBrandKit } from "../domain.js";
import { runCreativeWorkflowWithAI } from "../ai/workflow.js";
import { flowToSkill, validateFlow } from "./model.js";

function ensureRunnable(flow) {
  const check = validateFlow(flow);
  if (!check.valid) {
    throw new Error("编排图不可执行：" + check.errors.join("；"));
  }
}

// 由编排图节点的存在性派生 AI 启用模式：copy 节点→出文案，visual 节点→出图。
// 纯函数。仅在 execute.js 算还不足以门控（hasAiMode 只读 provider 配置），
// 故需把结果作为 enabledModes 透传给 runCreativeWorkflowWithAI 的 image/text 分支。
export function flowToAiModes(flow) {
  const agentIds = new Set((flow?.nodes || []).map(node => node.agentId));
  return {
    text: agentIds.has("copy"),
    image: agentIds.has("visual")
  };
}

/**
 * 确定性执行：编排图 → task（无 AI，离线可跑）。
 */
export function runFlow({ brief, flow, brandKit = defaultBrandKit, meta } = {}) {
  ensureRunnable(flow);
  return runCreativeWorkflowWithSkill({ brief, skill: flowToSkill(flow, meta), brandKit });
}

/**
 * AI 增强执行：在确定性管线上叠加真实 LLM 文案 / 图像。
 * 无系统 AI 配置时自动回退确定性结果（与预设 skill 行为一致）。
 */
export async function runFlowWithAI({ brief, flow, brandKit = defaultBrandKit, meta, aiConfig, signal, fetchImpl } = {}) {
  ensureRunnable(flow);
  return runCreativeWorkflowWithAI({
    brief,
    skill: flowToSkill(flow, meta),
    brandKit,
    aiConfig,
    enabledModes: flowToAiModes(flow),
    signal,
    fetchImpl
  });
}
