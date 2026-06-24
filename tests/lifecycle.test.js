import test from "node:test";
import assert from "node:assert/strict";
import { TASK_STATUS, nodeStatusForTaskStatus, isTerminalStatus } from "../lib/lifecycle.js";
import { runCreativeWorkflow, normalizeBrief } from "../lib/domain.js";

test("TASK_STATUS is a frozen four-state execution vocabulary", () => {
  assert.deepEqual(Object.keys(TASK_STATUS).sort(), ["completed", "failed", "queued", "running"]);
  assert.ok(Object.isFrozen(TASK_STATUS));
  assert.equal(TASK_STATUS.queued, "queued");
  assert.equal(TASK_STATUS.running, "running");
  assert.equal(TASK_STATUS.completed, "completed");
  assert.equal(TASK_STATUS.failed, "failed");
});

test("nodeStatusForTaskStatus maps all four states to flow node vocab + safe default", () => {
  assert.equal(nodeStatusForTaskStatus(TASK_STATUS.queued), "idle");
  assert.equal(nodeStatusForTaskStatus(TASK_STATUS.running), "running");
  assert.equal(nodeStatusForTaskStatus(TASK_STATUS.completed), "done");
  assert.equal(nodeStatusForTaskStatus(TASK_STATUS.failed), "error");
  // 未知态容错回退 idle（UI 不抛）
  assert.equal(nodeStatusForTaskStatus("nonsense"), "idle");
  assert.equal(nodeStatusForTaskStatus(undefined), "idle");
});

test("isTerminalStatus only true for completed/failed", () => {
  assert.ok(isTerminalStatus(TASK_STATUS.completed));
  assert.ok(isTerminalStatus(TASK_STATUS.failed));
  assert.ok(!isTerminalStatus(TASK_STATUS.queued));
  assert.ok(!isTerminalStatus(TASK_STATUS.running));
});

test("agent steps carry additive lifecycle fields (completed path stays back-compat)", () => {
  const task = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1"
  });
  assert.ok(task.agents.length > 0);
  for (const step of task.agents) {
    // 向后兼容：同步管线仍产出 completed / progress 100
    assert.equal(step.status, TASK_STATUS.completed);
    assert.equal(step.progress, 100);
    // 新增生命周期字段（加法）
    assert.equal(step.error, null);
    assert.equal(typeof step.queuedAt, "string");
    assert.equal(typeof step.startedAt, "string");
    assert.equal(typeof step.finishedAt, "string");
  }
});
