import test from "node:test";
import assert from "node:assert/strict";
import {
  planCreativeTask,
  driveCreativeTask,
  runCreativeWorkflowWithSkill,
  findSkill,
  normalizeBrief
} from "../lib/domain.js";
import { TASK_STATUS } from "../lib/lifecycle.js";

const brief = () => normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" });
const skill = () => findSkill("rednote_seeding_note_v1");

test("planCreativeTask builds a queued task skeleton (no variants/qa/exports yet)", () => {
  const task = planCreativeTask({ brief: brief(), skill: skill() });
  assert.equal(task.status, TASK_STATUS.queued);
  assert.ok(task.agents.length > 0);
  for (const step of task.agents) {
    assert.equal(step.status, TASK_STATUS.queued);
    assert.equal(step.progress, 0);
    assert.equal(step.startedAt, null);
    assert.equal(step.finishedAt, null);
    assert.equal(typeof step.queuedAt, "string");
  }
  assert.deepEqual(task.variants, []);
  assert.equal(task.qa, null);
  assert.deepEqual(task.exports, []);
  assert.deepEqual(task.events, []);
});

test("driveCreativeTask runs the queued plan to a completed task", () => {
  const planned = planCreativeTask({ brief: brief(), skill: skill() });
  const done = driveCreativeTask(planned, { skill: skill() });
  assert.equal(done.status, TASK_STATUS.completed);
  for (const step of done.agents) {
    assert.equal(step.status, TASK_STATUS.completed);
    assert.equal(step.progress, 100);
    assert.equal(typeof step.finishedAt, "string");
  }
  assert.equal(done.variants.length, 3);
  assert.ok(done.qa);
  // 每 agent 一条 agent_completed 事件（与既有 buildAgentEvents 形状一致）
  assert.equal(done.events.length, done.agents.length);
  assert.ok(done.events.every(event => event.event === "agent_completed"));
});

test("driveCreativeTask honors an injected executor seam (for the AI/failure path)", () => {
  const planned = planCreativeTask({ brief: brief(), skill: skill() });
  const seen = [];
  const executor = (step) => {
    seen.push(step.id);
    return { ...step, status: TASK_STATUS.completed, progress: 100, finishedAt: "x", error: null, summary: "via-seam", artifact: "via-seam" };
  };
  const done = driveCreativeTask(planned, { skill: skill(), executor });
  assert.deepEqual(seen, planned.agents.map(step => step.id));
  assert.ok(done.agents.every(step => step.summary === "via-seam"));
});

test("runCreativeWorkflowWithSkill (sync wrapper) stays structurally back-compat", () => {
  const task = runCreativeWorkflowWithSkill({ brief: brief(), skill: skill() });
  assert.equal(task.status, TASK_STATUS.completed);
  assert.equal(task.variants.length, 3);
  assert.equal(task.exports.length, 3); // rednote 含 export agent
  assert.ok(task.agents.every(step => step.status === TASK_STATUS.completed && step.progress === 100));
  assert.ok(task.qa.overallScore >= 80);
  assert.ok(task.credits.actual >= 24);
});
