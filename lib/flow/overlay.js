// Director 流程图 → 画布只读 overlay 的纯几何。
// 与渲染分离（对齐 canvas runtime：lib/canvas/model.js 纯逻辑 / 组件只渲染）。
// 消费方把返回的 nodes/edges 直接画进 CanvasStudio 的世界变换组，随画布 pan/zoom。

// overlay 节点盒尺寸（世界单位）。沿用迁移前 FlowCanvas 的 124×58，保证视觉连续。
export const FLOW_NODE_W = 124;
export const FLOW_NODE_H = 58;

/**
 * 把 Flow 编排图转成画布坐标系下的只读 overlay 几何。
 * 纯函数：不读 DOM、不依赖 React，便于单测拿正确性 ground truth。
 *
 * @param {{nodes?: Array<{id:string,agentId:string,x:number,y:number}>, edges?: Array<{id:string,from:string,to:string}>}} flow
 * @param {{nodeWidth?: number, nodeHeight?: number}} [opts]
 * @returns {{nodes: Array, edges: Array, isEmpty: boolean}}
 */
export function computeFlowOverlay(flow, opts = {}) {
  const w = opts.nodeWidth || FLOW_NODE_W;
  const h = opts.nodeHeight || FLOW_NODE_H;

  const nodes = (flow?.nodes || []).map(node => ({
    id: node.id,
    agentId: node.agentId,
    x: node.x,
    y: node.y,
    w,
    h
  }));

  const byId = new Map(nodes.map(node => [node.id, node]));

  // 连线：从源节点右侧中点 → 目标节点左侧中点，水平把手 bezier（与迁移前 FlowCanvas 同形）。
  // 端点任一缺失（节点被删/非法 edge）则丢弃该边，避免下游渲染 NaN 路径。
  const edges = (flow?.edges || [])
    .map(edge => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return null;
      const x1 = from.x + w;
      const y1 = from.y + h / 2;
      const x2 = to.x;
      const y2 = to.y + h / 2;
      const mid = (x1 + x2) / 2;
      return { id: edge.id, x1, y1, x2, y2, path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` };
    })
    .filter(Boolean);

  return { nodes, edges, isEmpty: nodes.length === 0 };
}
