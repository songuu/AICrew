import test from "node:test";
import assert from "node:assert/strict";

import {
  setTaskScheduledAt,
  selectRednoteExportsForTask,
  isTaskScheduleEligible,
  selectDueTasks
} from "../lib/schedule/queue.js";

// 一个带小红书产物的可排期 task。
function rednoteTask(id, scheduledAt = null) {
  return {
    id,
    scheduledAt,
    variants: [{ id: "variant_a", name: "A" }],
    exports: [
      { name: "测评 / A", platform: "小红书", variantId: "variant_a", files: [] }
    ]
  };
}

test("setTaskScheduledAt is immutable: original state.tasks ref is untouched", () => {
  const state = { tasks: [rednoteTask("task_1"), rednoteTask("task_2")] };
  const next = setTaskScheduledAt(state, "task_1", "2026-06-30T14:00:00.000Z");

  // 原 state 与其 tasks 数组引用不变。
  assert.notEqual(next, state);
  assert.notEqual(next.tasks, state.tasks);
  assert.equal(state.tasks[0].scheduledAt, null, "original task must not be mutated");

  // 目标 task 是新对象、带 scheduledAt；未命中的 task 保持同一引用。
  assert.equal(next.tasks[0].scheduledAt, "2026-06-30T14:00:00.000Z");
  assert.notEqual(next.tasks[0], state.tasks[0]);
  assert.equal(next.tasks[1], state.tasks[1]);
});

test("setTaskScheduledAt clears the schedule when passed null or empty string", () => {
  const state = { tasks: [rednoteTask("task_1", "2026-06-30T14:00:00.000Z")] };
  assert.equal(setTaskScheduledAt(state, "task_1", null).tasks[0].scheduledAt, null);
  assert.equal(setTaskScheduledAt(state, "task_1", "").tasks[0].scheduledAt, null);
});

test("setTaskScheduledAt tolerates missing tasks array", () => {
  assert.deepEqual(setTaskScheduledAt({}, "task_x", "2026-06-30T14:00:00.000Z").tasks, []);
});

test("selectRednoteExportsForTask keeps only 小红书 products", () => {
  const task = {
    exports: [
      { platform: "小红书", variantId: "v1" },
      { platform: "抖音", variantId: "v2" },
      { platform: "视频号", variantId: "v3" }
    ]
  };
  const rednote = selectRednoteExportsForTask(task);
  assert.equal(rednote.length, 1);
  assert.equal(rednote[0].platform, "小红书");
});

test("selectRednoteExportsForTask returns [] when task or exports are missing", () => {
  assert.deepEqual(selectRednoteExportsForTask(undefined), []);
  assert.deepEqual(selectRednoteExportsForTask({}), []);
  assert.deepEqual(selectRednoteExportsForTask({ exports: [] }), []);
});

test("isTaskScheduleEligible gates on having at least one 小红书 product", () => {
  assert.equal(isTaskScheduleEligible(rednoteTask("task_1")), true);
  assert.equal(isTaskScheduleEligible({ exports: [{ platform: "抖音" }] }), false);
  assert.equal(isTaskScheduleEligible({ exports: [] }), false);
  // 边界：task 无产物（如 project 缺失/未导出）→ 安全排除，不抛。
  assert.equal(isTaskScheduleEligible({ id: "task_empty" }), false);
});

test("selectDueTasks includes scheduledAt <= now (boundary inclusive)", () => {
  const now = Date.parse("2026-06-30T14:00:00.000Z");
  const exact = rednoteTask("task_exact", "2026-06-30T14:00:00.000Z");
  const past = rednoteTask("task_past", "2026-06-30T13:00:00.000Z");
  const future = rednoteTask("task_future", "2026-06-30T15:00:00.000Z");
  const state = { tasks: [exact, past, future] };

  const due = selectDueTasks(state, now).map(t => t.id);
  assert.deepEqual(due.sort(), ["task_exact", "task_past"]);
});

test("selectDueTasks excludes tasks without a schedule, with bad dates, or non-eligible", () => {
  const now = Date.parse("2026-06-30T14:00:00.000Z");
  const noSchedule = rednoteTask("task_none", null);
  const badDate = rednoteTask("task_bad", "definitely-not-a-date");
  const dueButDouyin = {
    id: "task_douyin",
    scheduledAt: "2026-06-30T13:00:00.000Z",
    exports: [{ platform: "抖音", variantId: "v" }]
  };
  const state = { tasks: [noSchedule, badDate, dueButDouyin] };

  assert.deepEqual(selectDueTasks(state, now), []);
});

test("selectDueTasks tolerates missing tasks array", () => {
  assert.deepEqual(selectDueTasks({}, Date.now()), []);
});

test("selectDueTasks is fail-closed on a non-finite nowMs (never leaks future tasks)", () => {
  // 防御不变量：nowMs 缺值/非数值时返回 []，杜绝 `due > NaN` 恒 false 把未来排期误判到期。
  const future = rednoteTask("task_future", "2099-06-30T15:00:00.000Z");
  const past = rednoteTask("task_past", "2020-06-30T13:00:00.000Z");
  const state = { tasks: [future, past] };
  assert.deepEqual(selectDueTasks(state, NaN), []);
  assert.deepEqual(selectDueTasks(state, undefined), []);
  assert.deepEqual(selectDueTasks(state, "not-a-number"), []);
});
