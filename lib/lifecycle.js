// Task + agent 执行生命周期的单一词汇。
// 与 artifacts.js 的 ARTIFACT_STATUS 正交：那是交付物状态(ready/failed/deferred)，这是执行状态。
// 仿 ARTIFACT_STATUS 的 Object.freeze 风格，作为状态机的唯一真相来源。

export const TASK_STATUS = Object.freeze({
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed"
});

// 执行生命周期态 → flow 节点展示态(model.js: idle|running|done|error)。
// 节点词汇保持不变，canvas/overlay 零改动即可反映真实进度。
const NODE_STATUS_BY_TASK_STATUS = Object.freeze({
  [TASK_STATUS.queued]: "idle",
  [TASK_STATUS.running]: "running",
  [TASK_STATUS.completed]: "done",
  [TASK_STATUS.failed]: "error"
});

// 未知态回退 idle 而非抛错：状态映射用于渲染，容错优先于严格。
export function nodeStatusForTaskStatus(status) {
  return NODE_STATUS_BY_TASK_STATUS[status] || "idle";
}

export function isTerminalStatus(status) {
  return status === TASK_STATUS.completed || status === TASK_STATUS.failed;
}

// 按生命周期态生成时间戳三元组，集中规则避免散落 now() 调用。
// queued：仅入队；running：已开始未结束；completed/failed：终态全填。
export function lifecycleTimestamps(status, timestamp) {
  if (status === TASK_STATUS.queued) {
    return { queuedAt: timestamp, startedAt: null, finishedAt: null };
  }
  if (status === TASK_STATUS.running) {
    return { queuedAt: timestamp, startedAt: timestamp, finishedAt: null };
  }
  return { queuedAt: timestamp, startedAt: timestamp, finishedAt: timestamp };
}
