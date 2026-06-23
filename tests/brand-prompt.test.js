import test from "node:test";
import assert from "node:assert/strict";
import { renderBrandClause, renderBrandImageHint } from "../lib/brand/prompt.js";
import { runCreativeWorkflowWithAI } from "../lib/ai/workflow.js";
import { normalizeBrief, defaultBrandKit } from "../lib/domain.js";

test("renderBrandClause includes name, voice, aesthetic and forbidden words", () => {
  const clause = renderBrandClause({
    name: "AICrew",
    voice: "专业、轻快",
    forbiddenWords: ["禁词A", "禁词B"],
    aesthetic: "冷色调"
  });
  assert.match(clause, /品牌：AICrew/);
  assert.match(clause, /专业、轻快/);
  assert.match(clause, /审美偏好：冷色调/);
  assert.match(clause, /禁词A、禁词B/);
});

test("renderBrandClause strips injected newlines inside forbidden words", () => {
  const clause = renderBrandClause({ name: "X", forbiddenWords: ["bad\nword", "  "] });
  const lines = clause.split("\n");
  // name 行 + 禁用词行；禁用词内部换行被折叠为空格，不引入额外行
  assert.equal(lines.length, 2);
  assert.match(lines[1], /禁用词（绝不出现）：bad word/);
});

test("renderBrandClause reports 无 when there are no forbidden words", () => {
  assert.match(renderBrandClause({ name: "X", forbiddenWords: [] }), /禁用词（绝不出现）：无/);
});

test("renderBrandImageHint joins voice and aesthetic, omitting empties", () => {
  assert.equal(renderBrandImageHint({ voice: "轻快", aesthetic: "留白" }), "品牌调性：轻快；审美：留白");
  assert.equal(renderBrandImageHint({ voice: "轻快" }), "品牌调性：轻快");
  assert.equal(renderBrandImageHint({}), "");
});

test("brand clause is injected into the copy prompt sent to the model", async () => {
  let captured = "";
  const fetchImpl = async (url, options) => {
    captured += options.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "{}" }] }),
      text: async () => "{}"
    };
  };
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: { ...defaultBrandKit, name: "唯一品牌名XYZ" },
    aiConfig: { provider: "claude", apiKey: "k", model: "claude-sonnet", baseURL: "https://api.anthropic.com" },
    fetchImpl
  });
  assert.match(captured, /唯一品牌名XYZ/);
});
