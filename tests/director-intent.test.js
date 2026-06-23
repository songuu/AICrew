import test from "node:test";
import assert from "node:assert/strict";
import { applyDirectorOps, classifyDirectorIntent } from "../lib/flow/intent.js";
import { resolveDirectorCommand } from "../lib/flow/director.js";
import { createFlow, linearFlow, hasAgent, orderedAgentIds } from "../lib/flow/model.js";

function jsonReply(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

const claudeConfig = { provider: "claude", apiKey: "k", model: "claude-sonnet", baseURL: "https://api.anthropic.com" };

// ---- applyDirectorOps (pure) ----
test("applyDirectorOps adds, connects and reorders immutably", () => {
  const flow = createFlow("manual");
  const added = applyDirectorOps(flow, [{ op: "add", agent: "strategy" }, { op: "add", agent: "visual" }]);
  assert.ok(hasAgent(added.flow, "strategy"));
  assert.ok(hasAgent(added.flow, "visual"));
  assert.equal(flow.nodes.length, 0, "原 flow 不被改动");

  const reordered = applyDirectorOps(added.flow, [{ op: "reorder", agent: "strategy", position: "last" }]);
  assert.equal(orderedAgentIds(reordered.flow).at(-1), "strategy");
});

test("applyDirectorOps hard-rejects the video node and leaves the flow unchanged", () => {
  const flow = linearFlow(["strategy", "visual"], "manual");
  const result = applyDirectorOps(flow, [{ op: "add", agent: "video" }]);
  assert.ok(!hasAgent(result.flow, "video"));
  assert.match(result.reply, /视频节点暂未开放/);
});

test("applyDirectorOps signals run", () => {
  const result = applyDirectorOps(linearFlow(["copy"], "manual"), [{ op: "run" }]);
  assert.equal(result.run, true);
});

// ---- classifyDirectorIntent (LLM) ----
test("classifyDirectorIntent parses a model JSON op envelope", async () => {
  const { fetchImpl } = { fetchImpl: async () => jsonReply({ content: [{ type: "text", text: JSON.stringify({ ops: [{ op: "add", agent: "strategy" }], reply: "好的" }) }] }) };
  const intent = await classifyDirectorIntent({ text: "先做策略", flow: createFlow("manual"), aiConfig: claudeConfig, fetchImpl });
  assert.deepEqual(intent.ops, [{ op: "add", agent: "strategy" }]);
});

test("classifyDirectorIntent returns null without an aiConfig", async () => {
  assert.equal(await classifyDirectorIntent({ text: "加策略", flow: createFlow("manual"), aiConfig: null }), null);
});

// ---- resolveDirectorCommand (LLM-first, regex fallback) ----
test("resolveDirectorCommand applies LLM ops when available", async () => {
  const fetchImpl = async () =>
    jsonReply({ content: [{ type: "text", text: JSON.stringify({ ops: [{ op: "add", agent: "strategy" }, { op: "add", agent: "copy" }], reply: "已编排策略与文案" }) }] });
  const result = await resolveDirectorCommand({ text: "把策略和文案都加上", flow: createFlow("manual"), aiConfig: claudeConfig, fetchImpl });
  assert.equal(result.source, "llm");
  assert.ok(hasAgent(result.flow, "strategy"));
  assert.ok(hasAgent(result.flow, "copy"));
  assert.equal(result.reply, "已编排策略与文案");
});

test("resolveDirectorCommand falls back to regex when the LLM call fails", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "err" });
  const result = await resolveDirectorCommand({ text: "加视觉", flow: createFlow("manual"), aiConfig: claudeConfig, fetchImpl });
  assert.equal(result.source, "regex");
  assert.ok(hasAgent(result.flow, "visual"));
});

test("resolveDirectorCommand falls back to regex with no aiConfig and still locks video", async () => {
  const result = await resolveDirectorCommand({ text: "加视频", flow: createFlow("manual"), aiConfig: null });
  assert.equal(result.source, "regex");
  assert.ok(!hasAgent(result.flow, "video"));
  assert.match(result.reply, /视频节点暂未开放/);
});
