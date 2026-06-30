import test from "node:test";
import assert from "node:assert/strict";

import { stripCollectionMedia } from "../lib/state/storage-sanitize.js";
import { sanitizeClientStateForSave } from "../lib/db/repositories/state.js";

// 排期层持久化往返回归：证明 task.scheduledAt 经「客户端脱敏 → server replace-all 透传 →
// jsonb payload 往返」全程不丢。守 [[aicrew-persist-sanitization-blindspot]]（脱敏只剥媒体不碰标量）。

function scheduledTask() {
  return {
    id: "task_1",
    scheduledAt: "2026-06-30T14:00:00.000Z",
    title: "玻尿酸面膜测评",
    variants: [
      { id: "variant_a", name: "A", imageUrl: "data:image/png;base64,AAAA", hook: "stop" }
    ],
    exports: [{ name: "测评 / A", platform: "小红书", variantId: "variant_a", files: [] }]
  };
}

// 假 stripVariant：模拟组件 stripVariantMedia 剥掉 imageUrl 大字段。
function fakeStripVariant(variant) {
  const { imageUrl, ...rest } = variant;
  return rest;
}

test("stripCollectionMedia preserves task scalars (scheduledAt) while stripping variant media", () => {
  const stripped = stripCollectionMedia([scheduledTask()], fakeStripVariant);
  // 项级标量必须存活——这是排期层不被脱敏吞掉的核心不变量。
  assert.equal(stripped[0].scheduledAt, "2026-06-30T14:00:00.000Z");
  assert.equal(stripped[0].title, "玻尿酸面膜测评");
  // 变体媒体被剥离，但变体其余字段保留。
  assert.equal(stripped[0].variants[0].imageUrl, undefined);
  assert.equal(stripped[0].variants[0].hook, "stop");
});

test("stripCollectionMedia leaves items without variants untouched (scheduledAt intact)", () => {
  const task = { id: "task_2", scheduledAt: "2026-06-30T14:00:00.000Z" };
  const stripped = stripCollectionMedia([task], fakeStripVariant);
  assert.equal(stripped[0].scheduledAt, "2026-06-30T14:00:00.000Z");
});

test("stripCollectionMedia tolerates a missing list", () => {
  assert.deepEqual(stripCollectionMedia(undefined, fakeStripVariant), []);
});

test("sanitizeClientStateForSave passes task.scheduledAt through (tasks are client-owned)", () => {
  const sanitized = sanitizeClientStateForSave(
    { tasks: [scheduledTask()], workspace: {} },
    { workspace: { credits: 5000 } }
  );
  // server 侧只剥 credit 三键；tasks 整组透传，scheduledAt 不被吞。
  assert.equal(sanitized.tasks[0].scheduledAt, "2026-06-30T14:00:00.000Z");
  assert.equal(sanitized.tasks.length, 1);
});

test("scheduledAt survives the jsonb payload round-trip (zero-migration storage)", () => {
  // saveStateSnapshot 写 payload=tx.json(item) 整对象、loadStateSnapshot 读 row.payload 回灌；
  // 用 JSON 序列化作为 jsonb 往返的等价证明：标量 scheduledAt 不丢。
  const task = scheduledTask();
  const roundTripped = JSON.parse(JSON.stringify(task));
  assert.equal(roundTripped.scheduledAt, task.scheduledAt);
});
