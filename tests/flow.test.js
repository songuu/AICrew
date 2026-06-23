import test from "node:test";
import assert from "node:assert/strict";
import {
  createFlow,
  linearFlow,
  addNode,
  removeNode,
  toggleAgent,
  reorderNode,
  connect,
  disconnect,
  orderedAgentIds,
  validateFlow,
  isVideoFlow,
  estimateFlowCredits,
  flowToSkill,
  sanitizeFlow,
  hasAgent,
  hasBranching
} from "../lib/flow/model.js";
import { routeIdeaToFlow } from "../lib/flow/router.js";
import { parseDirectorCommand, matchAgentInText } from "../lib/flow/director.js";
import { runFlow } from "../lib/flow/execute.js";
import { runCreativeWorkflow, runCreativeWorkflowWithSkill, findSkill } from "../lib/domain.js";

// —— 模型：构造与不可变 ——

test("createFlow rejects unknown mode", () => {
  assert.throws(() => createFlow("teleport"), /未知编排模式/);
});

test("linearFlow wires nodes into a single chain", () => {
  const flow = linearFlow(["brief", "strategy", "qa"], "semi");
  assert.equal(flow.nodes.length, 3);
  assert.equal(flow.edges.length, 2);
  assert.deepEqual(orderedAgentIds(flow), ["brief", "strategy", "qa"]);
});

test("linearFlow drops unknown agent ids", () => {
  const flow = linearFlow(["brief", "ghost", "qa"]);
  assert.deepEqual(orderedAgentIds(flow), ["brief", "qa"]);
});

test("addNode is immutable", () => {
  const flow = createFlow("manual");
  const next = addNode(flow, "brief");
  assert.equal(flow.nodes.length, 0, "原 flow 不被改动");
  assert.equal(next.nodes.length, 1);
});

test("removeNode also prunes connected edges (no dangling edge)", () => {
  const flow = linearFlow(["brief", "strategy", "qa"]);
  const middle = flow.nodes[1].id;
  const next = removeNode(flow, middle);
  assert.equal(next.nodes.length, 2);
  assert.ok(next.edges.every(edge => edge.from !== middle && edge.to !== middle));
});

// —— 半自动：勾选 + 拖拽微调 ——

test("toggleAgent adds then removes, keeping a linear chain", () => {
  let flow = linearFlow(["brief", "strategy"]);
  const added = toggleAgent(flow, "qa");
  assert.equal(added.added, true);
  assert.equal(added.flow.nodes.length, 3);
  assert.deepEqual(orderedAgentIds(added.flow), ["brief", "strategy", "qa"]);

  const removed = toggleAgent(added.flow, "qa");
  assert.equal(removed.added, false);
  assert.equal(hasAgent(removed.flow, "qa"), false);
});

test("reorderNode moves a node and rebuilds the chain order", () => {
  const flow = linearFlow(["brief", "strategy", "visual", "qa"]);
  const moved = reorderNode(flow, 3, 1); // qa 提到第二位
  assert.deepEqual(orderedAgentIds(moved), ["brief", "qa", "strategy", "visual"]);
});

test("reorderNode out of range is a safe no-op", () => {
  const flow = linearFlow(["brief", "qa"]);
  assert.deepEqual(orderedAgentIds(reorderNode(flow, 5, 0)), ["brief", "qa"]);
});

test("reorderNode refuses to flatten a branching DAG", () => {
  // brief 分叉到 strategy 和 qa（出度 2）。重排会重建线性边、丢分支 → 必须 no-op。
  let flow = createFlow("manual");
  flow = addNode(flow, "brief");
  flow = addNode(flow, "strategy");
  flow = addNode(flow, "qa");
  const [b, s, q] = flow.nodes.map(node => node.id);
  flow = connect(flow, b, s).flow;
  flow = connect(flow, b, q).flow; // 分支
  assert.equal(hasBranching(flow), true);
  const after = reorderNode(flow, 2, 0);
  assert.equal(after, flow, "分支流程下 reorderNode 原样返回");
  assert.equal(after.edges.length, 2, "分支连线未被破坏");
});

// —— 手动：连线 / DAG / 环检测 ——

test("connect rejects a cycle", () => {
  const flow = linearFlow(["brief", "strategy", "qa"]);
  const a = flow.nodes[0].id;
  const c = flow.nodes[2].id;
  const result = connect(flow, c, a); // qa→brief 会成环
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cycle");
  assert.equal(result.flow.edges.length, flow.edges.length, "失败不改图");
});

test("connect rejects self-loop and duplicate", () => {
  const flow = linearFlow(["brief", "strategy"]);
  const a = flow.nodes[0].id;
  const b = flow.nodes[1].id;
  assert.equal(connect(flow, a, a).reason, "self-loop");
  assert.equal(connect(flow, a, b).reason, "duplicate");
});

test("orderedAgentIds topo-sorts a manual DAG", () => {
  let flow = createFlow("manual");
  flow = addNode(flow, "brief");
  flow = addNode(flow, "strategy");
  flow = addNode(flow, "qa");
  const [b, s, q] = flow.nodes.map(node => node.id);
  flow = connect(flow, b, s).flow;
  flow = connect(flow, s, q).flow;
  assert.deepEqual(orderedAgentIds(flow), ["brief", "strategy", "qa"]);
  // 断开后退回节点顺序兜底
  const detached = disconnect(flow, flow.edges[0].id);
  assert.equal(orderedAgentIds(detached).length, 3);
});

// —— 校验 / 成本 / 媒介 ——

test("validateFlow flags empty flow", () => {
  assert.equal(validateFlow(createFlow("auto")).valid, false);
  assert.equal(validateFlow(linearFlow(["brief"])).valid, true);
});

test("isVideoFlow keys off the video agent", () => {
  assert.equal(isVideoFlow(linearFlow(["brief", "video", "qa"])), true);
  assert.equal(isVideoFlow(linearFlow(["brief", "visual", "qa"])), false);
});

test("estimateFlowCredits sums agent cost by platform multiplier", () => {
  const flow = linearFlow(["brief", "qa"]); // 6 + 6 = 12
  const tiktok = estimateFlowCredits(flow, "抖音"); // ×1
  const rednote = estimateFlowCredits(flow, "小红书"); // ×0.9
  assert.equal(tiktok, 12);
  assert.ok(rednote < tiktok);
});

// —— 中枢路由 ——

test("routeIdeaToFlow detects rednote image intent", () => {
  const result = routeIdeaToFlow("给露营灯做一组小红书种草笔记");
  assert.equal(result.brief.platform, "小红书");
  assert.equal(isVideoFlow(result.flow), false);
  assert.ok(result.rationale.length >= 1);
  assert.ok(result.rationale.every(item => item.reason && item.title));
});

test("routeIdeaToFlow picks a video pipeline for 抖音 ad", () => {
  const result = routeIdeaToFlow("帮我给智能水杯做抖音广告短视频");
  assert.equal(result.brief.platform, "抖音");
  assert.equal(isVideoFlow(result.flow), true);
});

test("routeIdeaToFlow always returns a runnable flow even for vague input", () => {
  const result = routeIdeaToFlow("随便做点东西");
  assert.equal(validateFlow(result.flow).valid, true);
});

// —— 执行：与 domain 契约同构 ——

test("flowToSkill yields a domain-shaped skill", () => {
  const skill = flowToSkill(linearFlow(["brief", "visual", "qa"]), { name: "Test Flow" });
  assert.equal(skill.name, "Test Flow");
  assert.deepEqual(skill.agents, ["brief", "visual", "qa"]);
  assert.ok(skill.estimatedCredits > 0);
  assert.ok(Array.isArray(skill.palette));
});

test("runFlow produces the same task contract as a preset skill", () => {
  const preset = findSkill("rednote_seeding_note_v1");
  const flow = linearFlow(preset.agents, "auto");
  const brief = { productName: "露营灯", platform: "小红书", sellingPoints: "柔光便携" };

  const viaFlow = runFlow({ brief, flow, meta: { id: preset.id, name: preset.name } });
  const viaSkill = runCreativeWorkflow({ brief, skillId: preset.id });

  // 结构同构：同样的 agent 数、变体数、QA 形状、导出形状。
  assert.equal(viaFlow.agents.length, viaSkill.agents.length);
  assert.equal(viaFlow.variants.length, viaSkill.variants.length);
  assert.equal(viaFlow.exports.length, viaSkill.exports.length);
  assert.ok(viaFlow.qa.overallScore > 0);
});

test("runFlow refuses an empty flow", () => {
  assert.throws(() => runFlow({ brief: {}, flow: createFlow("manual") }), /不可执行/);
});

// —— domain 重构不回归 ——

test("runCreativeWorkflow still delegates without behavior change", () => {
  const brief = { productName: "Lamp", platform: "TikTok" };
  const direct = runCreativeWorkflow({ brief, skillId: "ecom_tiktok_product_ad_v1" });
  const viaSkill = runCreativeWorkflowWithSkill({ brief, skill: findSkill("ecom_tiktok_product_ad_v1") });
  assert.deepEqual(direct.agents.map(a => a.id), viaSkill.agents.map(a => a.id));
  assert.equal(direct.variants.length, viaSkill.variants.length);
});

// —— 导演台命令解析器 ——

test("matchAgentInText resolves short aliases, not just full titles", () => {
  // 回归：title 是「视觉资产」，简写「视觉」必须命中（曾因全词匹配失败）。
  assert.equal(matchAgentInText("加视觉").id, "visual");
  assert.equal(matchAgentInText("删质检").id, "qa");
  assert.equal(matchAgentInText("来个文案").id, "copy");
  assert.equal(matchAgentInText("加策略").id, "strategy");
});

test("parseDirectorCommand adds an agent immutably", () => {
  const flow = createFlow("manual");
  const result = parseDirectorCommand("加一个视觉", flow);
  assert.equal(flow.nodes.length, 0, "原 flow 不变");
  assert.equal(result.flow.nodes.length, 1);
  assert.equal(hasAgent(result.flow, "visual"), true);
});

test("parseDirectorCommand removes an agent", () => {
  const flow = linearFlow(["brief", "qa"], "manual");
  const result = parseDirectorCommand("删质检", flow);
  assert.equal(hasAgent(result.flow, "qa"), false);
});

test("parseDirectorCommand connects two nodes", () => {
  let flow = createFlow("manual");
  flow = parseDirectorCommand("加视觉", flow).flow;
  flow = parseDirectorCommand("加文案", flow).flow;
  const result = parseDirectorCommand("视觉连文案", flow);
  assert.equal(result.flow.edges.length, 1);
  assert.deepEqual(orderedAgentIds(result.flow), ["visual", "copy"]);
});

test("parseDirectorCommand reorders to last", () => {
  const flow = linearFlow(["brief", "qa", "visual"], "manual");
  const result = parseDirectorCommand("把需求放最后", flow);
  assert.equal(orderedAgentIds(result.flow).at(-1), "brief");
});

test("parseDirectorCommand refuses to reorder a branching flow", () => {
  let flow = createFlow("manual");
  flow = parseDirectorCommand("加需求", flow).flow;
  flow = parseDirectorCommand("加策略", flow).flow;
  flow = parseDirectorCommand("加质检", flow).flow;
  flow = parseDirectorCommand("需求连策略", flow).flow;
  flow = parseDirectorCommand("需求连质检", flow).flow; // 分支
  const result = parseDirectorCommand("把质检放最后", flow);
  assert.equal(result.flow.edges.length, 2, "分支连线保留");
  assert.match(result.reply, /分支/);
});

test("parseDirectorCommand signals run intent", () => {
  const result = parseDirectorCommand("运行", linearFlow(["brief"]));
  assert.equal(result.run, true);
});

test("parseDirectorCommand locks the video node for now", () => {
  const flow = createFlow("manual");
  const result = parseDirectorCommand("加视频", flow);
  assert.equal(result.flow.nodes.length, 0, "视频节点不加入");
  assert.match(result.reply, /未来支持|未开放/);
});

test("parseDirectorCommand guides on unknown input without mutating", () => {
  const flow = linearFlow(["brief"]);
  const result = parseDirectorCommand("你好啊", flow);
  assert.equal(result.flow, flow, "无变更返回原对象");
  assert.ok(result.reply.length > 0);
});

// —— 序列化安全 ——

test("sanitizeFlow drops corrupt nodes and dangling edges", () => {
  const dirty = {
    mode: "manual",
    nodes: [{ id: "n1", agentId: "brief" }, { id: "n2", agentId: "ghost" }, null],
    edges: [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n1", to: "n9" }]
  };
  const clean = sanitizeFlow(dirty);
  assert.equal(clean.nodes.length, 1);
  assert.equal(clean.edges.length, 0, "指向已删节点的 edge 全部清除");
  assert.equal(sanitizeFlow({ mode: "bogus" }), null);
});
