import test from "node:test";
import assert from "node:assert/strict";
import {
  planCreativeTask,
  driveCreativeTask,
  runCreativeWorkflowWithSkill,
  retryAgentStep,
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

test("driveCreativeTask: a failing executor marks that agent failed, leaves downstream queued, settles task failed, still builds outputs", () => {
  const planned = planCreativeTask({ brief: brief(), skill: skill() });
  const failIndex = 1;
  const failId = planned.agents[failIndex].id;
  const executor = (step) => {
    if (step.id === failId) {
      throw new Error("boom at https://api.x/v1/images?api_key=sk-secret123456789 (Bearer sk-secret123456789)");
    }
    return { ...step, status: TASK_STATUS.completed, progress: 100, finishedAt: "x", error: null, summary: "ok", artifact: "ok" };
  };
  const done = driveCreativeTask(planned, { skill: skill(), executor });

  assert.equal(done.status, TASK_STATUS.failed);

  const failedAgent = done.agents[failIndex];
  assert.equal(failedAgent.status, TASK_STATUS.failed);
  assert.ok(failedAgent.error && failedAgent.error.length > 0);
  assert.ok(!failedAgent.error.includes("sk-secret123456789"), "failed agent error 必须脱敏");

  // 上游 completed，下游(失败之后)保持 queued（sequential 拓扑下「其后皆下游」）
  for (let i = 0; i < failIndex; i++) assert.equal(done.agents[i].status, TASK_STATUS.completed);
  for (let i = failIndex + 1; i < done.agents.length; i++) assert.equal(done.agents[i].status, TASK_STATUS.queued);

  // 失败 task 仍组装产物（exports 只消费 ready；qa-report 仍在）
  assert.equal(done.variants.length, 3);
  assert.ok(done.qa);
  assert.ok(done.exports.length > 0);
  assert.ok(done.exports[0].files.some(file => file.name === "qa-report.json"));

  // 事件含 agent_failed
  assert.ok(done.events.some(event => event.event === "agent_failed" && event.agentId === failId));
});

test("retryAgentStep retries a FAILED agent to completed, unblocks downstream, re-settles task completed (charge once)", () => {
  const planned = planCreativeTask({ brief: brief(), skill: skill() });
  const failId = planned.agents[1].id;
  const failingExecutor = (step) => {
    if (step.id === failId) throw new Error("boom");
    return { ...step, status: TASK_STATUS.completed, progress: 100, finishedAt: "x", error: null, summary: "ok", artifact: "ok" };
  };
  const failed = driveCreativeTask(planned, { skill: skill(), executor: failingExecutor });
  assert.equal(failed.status, TASK_STATUS.failed);
  const creditsBefore = failed.credits.actual;

  const { cost, task } = retryAgentStep(failed, failId); // 默认执行器 → 成功
  assert.equal(task.status, TASK_STATUS.completed);
  const retried = task.agents.find(step => step.id === failId);
  assert.equal(retried.status, TASK_STATUS.completed);
  assert.equal(retried.retryCount, 1);
  assert.ok(!task.agents.some(step => step.status === TASK_STATUS.queued), "下游应被解封");
  assert.equal(task.credits.actual, creditsBefore + cost);
  assert.equal(task.events.filter(event => event.event === "agent_retried").length, 1);
});

test("retryAgentStep keeps the task failed when the retry itself fails (charge once, sanitized)", () => {
  const planned = planCreativeTask({ brief: brief(), skill: skill() });
  const failId = planned.agents[1].id;
  const firstFail = (step) => {
    if (step.id === failId) throw new Error("boom1");
    return { ...step, status: TASK_STATUS.completed, progress: 100, finishedAt: "x", error: null };
  };
  const failed = driveCreativeTask(planned, { skill: skill(), executor: firstFail });
  const creditsBefore = failed.credits.actual;

  const stillFailing = () => {
    throw new Error("boom2 at https://x/v1?api_key=sk-aaaaaaaaaaaa");
  };
  const { cost, task } = retryAgentStep(failed, failId, { executor: stillFailing });
  assert.equal(task.status, TASK_STATUS.failed);
  const retried = task.agents.find(step => step.id === failId);
  assert.equal(retried.status, TASK_STATUS.failed);
  assert.equal(retried.retryCount, 1);
  assert.ok(!retried.error.includes("sk-aaaaaaaaaaaa"), "retry 失败 error 必须脱敏");
  assert.equal(task.credits.actual, creditsBefore + cost); // 失败也只扣一次
  assert.ok(task.agents.slice(2).every(step => step.status === TASK_STATUS.queued), "下游仍 queued");
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
