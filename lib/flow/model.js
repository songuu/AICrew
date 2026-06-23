// Flow 编排图模型：纯函数、不可变、无 DOM 依赖，可在 node --test 下完整验证。
//
// 核心抽象：三种编排模式（自动 / 半自动 / 手动）最终都产出同一个 Flow——
// 一张以 domain agent 为节点的有向无环图。区别只在「谁来搭这张图、怎么搭」：
//   - auto:   中枢从创意里推断整条链（router.js）
//   - semi:   用户在中枢建议上勾选增减 + 拖拽微调顺序
//   - manual: 用户用对话逐节点绘制（可带分支连线）
//
// 自动 / 半自动产出线性链（无显式 edges，orderedAgentIds = 节点顺序）；
// 手动模式可显式连线形成 DAG，执行时由 orderedAgentIds 拓扑展平成线性序。
//
// 设计纪律对齐 canvas/model.js：所有变更返回新对象，绝不原地修改。

import { agents, findPlatformPreset, isVideoSkill, findSkill } from "../domain.js";

export const FLOW_MODES = ["auto", "semi", "manual"];

const KNOWN_AGENT_IDS = new Set(agents.map(agent => agent.id));

let idSeq = 0;
function nextId(prefix) {
  idSeq += 1;
  return `${prefix}_${idSeq}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAgent(agentId) {
  return agents.find(agent => agent.id === agentId) || null;
}

export function isKnownAgent(agentId) {
  return KNOWN_AGENT_IDS.has(agentId);
}

// 手动画布的默认落点：沿对角线阶梯排布，避免新节点叠在一起。
function defaultPosition(index) {
  return { x: 80 + index * 200, y: 120 + (index % 2) * 120 };
}

export function createNode(agentId, props = {}) {
  if (!isKnownAgent(agentId)) {
    throw new Error(`未知 Agent：${agentId}`);
  }
  return {
    id: props.id || nextId("node"),
    agentId,
    x: 0,
    y: 0,
    status: "idle", // idle | running | done | error
    ...props
  };
}

/**
 * 创建空 Flow。mode 非法显式抛错（输入边界校验）。
 */
export function createFlow(mode = "auto", brief = null) {
  if (!FLOW_MODES.includes(mode)) {
    throw new Error(`未知编排模式：${mode}`);
  }
  return { id: nextId("flow"), mode, brief, nodes: [], edges: [] };
}

/**
 * 由有序 agentId 列表构造线性链 Flow（A→B→C）。
 * 自动 / 半自动模式的主路径：中枢建议与用户勾选都落在这里。
 */
export function linearFlow(agentIds = [], mode = "auto", brief = null) {
  const valid = agentIds.filter(isKnownAgent);
  const nodes = valid.map((agentId, index) =>
    createNode(agentId, defaultPosition(index))
  );
  const edges = nodes.slice(1).map((node, index) => ({
    id: nextId("edge"),
    from: nodes[index].id,
    to: node.id
  }));
  return { id: nextId("flow"), mode, brief, nodes, edges };
}

/**
 * 由 skill 物化一条线性 Flow：取该 skill 编排的 agents 顺序播种。
 * 「指定 skill」是三模式统一入口——把 skill.agents 交给 linearFlow，产出仍是合法 Flow，
 * 经 onRun → flowToSkill 回到 domain 管线（守单桥不变量与 flow↔preset 等价）。
 * findSkill 找不到时回退首个 skill，故恒返回合法非空 Flow。
 */
export function skillToFlow(skillId, mode = "auto", brief = null) {
  const skill = findSkill(skillId);
  return linearFlow(skill.agents, mode, brief);
}

export function setBrief(flow, brief) {
  return { ...flow, brief };
}

export function addNode(flow, agentId, pos) {
  const node = createNode(agentId, pos || defaultPosition(flow.nodes.length));
  return { ...flow, nodes: [...flow.nodes, node] };
}

/**
 * 删除节点，同时清掉所有挂在它身上的连线（绝不留悬空 edge）。
 */
export function removeNode(flow, nodeId) {
  return {
    ...flow,
    nodes: flow.nodes.filter(node => node.id !== nodeId),
    edges: flow.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId)
  };
}

export function moveNode(flow, nodeId, x, y) {
  return {
    ...flow,
    nodes: flow.nodes.map(node => (node.id === nodeId ? { ...node, x, y } : node))
  };
}

export function setNodeStatus(flow, nodeId, status) {
  return {
    ...flow,
    nodes: flow.nodes.map(node => (node.id === nodeId ? { ...node, status } : node))
  };
}

/**
 * 半自动勾选：agent 已在图中则移除，否则追加。返回 { flow, added }。
 * 移除时同步清理连线；追加时若图当前是线性链，自动把新节点接到尾部保持单链。
 */
export function toggleAgent(flow, agentId) {
  const existing = flow.nodes.find(node => node.agentId === agentId);
  if (existing) {
    return { flow: removeNode(flow, existing.id), added: false };
  }
  const node = createNode(agentId, defaultPosition(flow.nodes.length));
  const tail = flow.nodes[flow.nodes.length - 1];
  const isLinear = flow.edges.length === Math.max(0, flow.nodes.length - 1);
  const edges =
    tail && isLinear
      ? [...flow.edges, { id: nextId("edge"), from: tail.id, to: node.id }]
      : flow.edges;
  return { flow: { ...flow, nodes: [...flow.nodes, node], edges }, added: true };
}

export function hasAgent(flow, agentId) {
  return flow.nodes.some(node => node.agentId === agentId);
}

/**
 * 是否存在分支：任一节点入度或出度 > 1。线性链全程入/出度 ≤ 1。
 * 用于保护手动 DAG——线性重排会重建连线，绝不能把用户画的分支拍平。
 */
export function hasBranching(flow) {
  const indeg = new Map();
  const outdeg = new Map();
  for (const edge of flow.edges) {
    outdeg.set(edge.from, (outdeg.get(edge.from) || 0) + 1);
    indeg.set(edge.to, (indeg.get(edge.to) || 0) + 1);
  }
  return flow.nodes.some(node => (indeg.get(node.id) || 0) > 1 || (outdeg.get(node.id) || 0) > 1);
}

/**
 * 拖拽微调顺序：把第 fromIndex 个节点移到 toIndex，并按新顺序重建线性连线。
 * 仅用于线性链（半自动 / 手动线性流）；越界或存在分支时为安全 no-op，
 * 避免重建线性边时丢失手动 DAG 的分支结构。
 */
export function reorderNode(flow, fromIndex, toIndex) {
  const { length } = flow.nodes;
  if (fromIndex < 0 || fromIndex >= length || toIndex < 0 || toIndex >= length) {
    return flow;
  }
  if (hasBranching(flow)) return flow; // 分支流程不可线性重排
  const nodes = [...flow.nodes];
  const [moved] = nodes.splice(fromIndex, 1);
  nodes.splice(toIndex, 0, moved);
  const edges = nodes.slice(1).map((node, index) => ({
    id: nextId("edge"),
    from: nodes[index].id,
    to: node.id
  }));
  return { ...flow, nodes, edges };
}

/**
 * 某节点能否到达 target（DFS）。用于连线前的环检测。
 */
function canReach(flow, startId, targetId) {
  const stack = [startId];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === targetId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of flow.edges) {
      if (edge.from === current) stack.push(edge.to);
    }
  }
  return false;
}

/**
 * 连线 from→to。手动模式专用。拒绝：自环、重复边、会形成环的边。
 * 返回 { flow, ok, reason }。
 */
export function connect(flow, fromId, toId) {
  if (fromId === toId) return { flow, ok: false, reason: "self-loop" };
  if (!flow.nodes.some(node => node.id === fromId) || !flow.nodes.some(node => node.id === toId)) {
    return { flow, ok: false, reason: "missing-node" };
  }
  if (flow.edges.some(edge => edge.from === fromId && edge.to === toId)) {
    return { flow, ok: false, reason: "duplicate" };
  }
  // to 已能到达 from → 加这条边会成环。
  if (canReach(flow, toId, fromId)) {
    return { flow, ok: false, reason: "cycle" };
  }
  return {
    flow: { ...flow, edges: [...flow.edges, { id: nextId("edge"), from: fromId, to: toId }] },
    ok: true
  };
}

export function disconnect(flow, edgeId) {
  return { ...flow, edges: flow.edges.filter(edge => edge.id !== edgeId) };
}

/**
 * 把 Flow 展平成线性执行序（agentId 列表）。
 * 无 edges → 直接用节点顺序（自动 / 半自动）。
 * 有 edges → Kahn 拓扑排序（手动 DAG）；检测到环则回退节点顺序兜底。
 */
export function orderedAgentIds(flow) {
  if (!flow.edges.length) {
    return flow.nodes.map(node => node.agentId);
  }
  const indegree = new Map(flow.nodes.map(node => [node.id, 0]));
  for (const edge of flow.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  }
  // 保持节点声明顺序作为同层稳定排序，输出可预测。
  const queue = flow.nodes.filter(node => (indegree.get(node.id) || 0) === 0).map(node => node.id);
  const order = [];
  const byId = new Map(flow.nodes.map(node => [node.id, node]));
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const edge of flow.edges) {
      if (edge.from !== id) continue;
      indegree.set(edge.to, indegree.get(edge.to) - 1);
      if (indegree.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  if (order.length !== flow.nodes.length) {
    return flow.nodes.map(node => node.agentId); // 兜底：有环时退回节点顺序
  }
  return order.map(id => byId.get(id).agentId);
}

/**
 * 校验 Flow 可执行性。返回 { valid, errors }。
 */
export function validateFlow(flow) {
  const errors = [];
  if (!flow.nodes.length) errors.push("流程为空：至少需要一个 Agent。");
  for (const node of flow.nodes) {
    if (!isKnownAgent(node.agentId)) errors.push(`未知 Agent：${node.agentId}`);
  }
  if (flow.edges.length && orderedAgentIds(flow).length !== flow.nodes.length) {
    errors.push("流程存在环，无法确定执行顺序。");
  }
  return { valid: errors.length === 0, errors };
}

export function isVideoFlow(flow) {
  return flow.nodes.some(node => node.agentId === "video");
}

/**
 * 估算 Flow 信用：节点 agent 成本之和 × 平台倍率。
 * 与 domain.estimateCreditsForSkill 同口径——成本只跟「跑了哪些 agent」走。
 */
export function estimateFlowCredits(flow, platform) {
  const base = orderedAgentIds(flow).reduce((sum, agentId) => {
    const agent = getAgent(agentId);
    return sum + (agent ? agent.cost : 0);
  }, 0);
  const multiplier = findPlatformPreset(platform).creditMultiplier;
  return Math.max(0, Math.round(base * multiplier));
}

/**
 * 把 Flow 物化成 domain 可执行的「合成 skill」。
 * 这是 Flow → 执行管线的唯一桥：domain 只认 skill 形状，给它一个就行。
 */
export function flowToSkill(flow, meta = {}) {
  const orderedIds = orderedAgentIds(flow);
  const orderedAgents = orderedIds.map(getAgent).filter(Boolean);
  const estimatedCredits = orderedAgents.reduce((sum, agent) => sum + agent.cost, 0);
  const skill = {
    id: meta.id || flow.id,
    name: meta.name || "自定义编排",
    category: meta.category || "Flow",
    stage: meta.stage || flow.mode,
    estimatedCredits: Math.max(1, estimatedCredits),
    formats: meta.formats || [],
    agents: orderedIds,
    palette: orderedAgents.slice(0, 3).map(agent => agent.accent),
    promise: meta.promise || "由编排图实时生成"
  };
  // 复用 domain 的视频判定，保证导出格式 / 成本结构与预设 skill 一致。
  skill.formats = skill.formats.length
    ? skill.formats
    : isVideoSkill(skill)
    ? ["视频", "封面", "文案"]
    : ["封面", "图文", "文案"];
  return skill;
}

// —— 序列化 / 反序列化（localStorage 安全，绝不信任反序列化数据）——

export function isValidNode(node) {
  return (
    !!node &&
    typeof node === "object" &&
    typeof node.id === "string" &&
    isKnownAgent(node.agentId)
  );
}

export function sanitizeFlow(raw) {
  if (!raw || typeof raw !== "object" || !FLOW_MODES.includes(raw.mode)) return null;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(isValidNode) : [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = Array.isArray(raw.edges)
    ? raw.edges.filter(
        edge =>
          edge &&
          typeof edge.id === "string" &&
          nodeIds.has(edge.from) &&
          nodeIds.has(edge.to)
      )
    : [];
  return { id: typeof raw.id === "string" ? raw.id : nextId("flow"), mode: raw.mode, brief: raw.brief || null, nodes, edges };
}
