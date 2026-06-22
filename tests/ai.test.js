import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_PROVIDERS,
  defaultAiConfig,
  validateAiConfig,
  isAiConfigured,
  loadAiConfig,
  saveAiConfig,
  clearAiConfig,
  AI_CONFIG_STORAGE_KEY
} from "../src/ai/config.js";
import { generateText, generateImage, testConnection } from "../src/ai/providers.js";
import { runCreativeWorkflowWithAI } from "../src/ai/workflow.js";
import { runCreativeWorkflow, defaultBrandKit, normalizeBrief } from "../src/domain.js";

// ---- helpers ----
function memStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

// 记录请求并按 URL 路由返回的假 fetch
function makeFetch(router) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options?.body ? JSON.parse(options.body) : null });
    return router(url, options);
  };
  return { fetchImpl, calls };
}

// ---- config ----
test("validateAiConfig rejects empty key and unknown provider, normalizes defaults", () => {
  const bad = validateAiConfig({ provider: "gemini", apiKey: "" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 1);

  const ok = validateAiConfig({ provider: "claude", apiKey: "sk-test" });
  assert.equal(ok.valid, true);
  assert.equal(ok.config.model, AI_PROVIDERS.claude.defaultModel);
  assert.equal(ok.config.baseURL, AI_PROVIDERS.claude.defaultBaseURL);
});

test("validateAiConfig gates imageEnabled by provider support", () => {
  const claude = validateAiConfig({ provider: "claude", apiKey: "k", imageEnabled: true });
  assert.equal(claude.config.imageEnabled, false); // Claude 无图像能力
  const openai = validateAiConfig({ provider: "openai", apiKey: "k", imageEnabled: true });
  assert.equal(openai.config.imageEnabled, true);
});

test("isAiConfigured reflects presence of a usable key", () => {
  assert.equal(isAiConfigured(null), false);
  assert.equal(isAiConfigured(defaultAiConfig("claude")), false); // 无 key
  assert.equal(isAiConfigured({ ...defaultAiConfig("openai"), apiKey: "k" }), true);
});

test("save/load/clear Ai config round-trips through storage (isolated key)", () => {
  const store = memStorage();
  saveAiConfig({ provider: "openai", apiKey: "sk-xyz", imageEnabled: true }, store);
  assert.ok(store.getItem(AI_CONFIG_STORAGE_KEY));
  const loaded = loadAiConfig(store);
  assert.equal(loaded.provider, "openai");
  assert.equal(loaded.apiKey, "sk-xyz");
  assert.equal(loaded.imageEnabled, true);
  clearAiConfig(store);
  assert.equal(loadAiConfig(store), null);
});

test("saveAiConfig throws on invalid config (boundary validation)", () => {
  const store = memStorage();
  assert.throws(() => saveAiConfig({ provider: "claude", apiKey: "" }, store), /无效|invalid/i);
});

// ---- providers: text ----
test("generateText calls the Anthropic messages endpoint with browser-direct header", async () => {
  const { fetchImpl, calls } = makeFetch(() =>
    jsonResponse({ content: [{ type: "text", text: "你好 hook" }] })
  );
  const config = { provider: "claude", apiKey: "sk-ant", model: "claude-opus-4-8", baseURL: "https://api.anthropic.com" };
  const text = await generateText(config, { system: "sys", prompt: "写个 hook", fetchImpl });
  assert.equal(text, "你好 hook");
  const call = calls[0];
  assert.match(call.url, /\/v1\/messages$/);
  assert.equal(call.options.headers["x-api-key"], "sk-ant");
  assert.equal(call.options.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(call.body.model, "claude-opus-4-8");
  assert.equal(call.body.system, "sys");
  assert.equal(call.body.messages[0].content, "写个 hook");
});

test("generateText calls the OpenAI chat completions endpoint with bearer auth", async () => {
  const { fetchImpl, calls } = makeFetch(() =>
    jsonResponse({ choices: [{ message: { content: "openai hook" } }] })
  );
  const config = { provider: "openai", apiKey: "sk-oai", model: "gpt-4o", baseURL: "https://api.openai.com" };
  const text = await generateText(config, { prompt: "写文案", fetchImpl });
  assert.equal(text, "openai hook");
  const call = calls[0];
  assert.match(call.url, /\/v1\/chat\/completions$/);
  assert.equal(call.options.headers.authorization, "Bearer sk-oai");
  assert.equal(call.body.model, "gpt-4o");
});

test("generateText throws a meaningful error on non-ok response", async () => {
  const { fetchImpl } = makeFetch(() => jsonResponse({ error: { message: "bad key" } }, { ok: false, status: 401 }));
  const config = { provider: "openai", apiKey: "x", model: "gpt-4o", baseURL: "https://api.openai.com" };
  await assert.rejects(() => generateText(config, { prompt: "hi", fetchImpl }), /401|bad key/);
});

test("generateText rejects empty prompt and unknown provider", async () => {
  await assert.rejects(() => generateText({ provider: "openai", apiKey: "k" }, { prompt: "" }), /prompt/);
  await assert.rejects(
    () => generateText({ provider: "nope", apiKey: "k" }, { prompt: "hi", fetchImpl: async () => jsonResponse({}) }),
    /provider/i
  );
});

// ---- providers: image ----
test("generateImage hits OpenAI images endpoint and returns a data URL", async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonResponse({ data: [{ b64_json: "AAAA" }] }));
  const config = { provider: "openai", apiKey: "sk-oai", model: "gpt-4o", baseURL: "https://api.openai.com" };
  const url = await generateImage(config, { prompt: "封面", size: "1024x1024", fetchImpl });
  assert.match(url, /^data:image\/png;base64,AAAA$/);
  assert.match(calls[0].url, /\/v1\/images\/generations$/);
});

test("generateImage refuses providers without image support (Claude)", async () => {
  const config = { provider: "claude", apiKey: "k", model: "claude-opus-4-8" };
  await assert.rejects(() => generateImage(config, { prompt: "x" }), /不支持|support/i);
});

// ---- testConnection ----
test("testConnection returns ok on success and captures the failure message otherwise", async () => {
  const good = makeFetch(() => jsonResponse({ content: [{ type: "text", text: "ok" }] }));
  const okResult = await testConnection(
    { provider: "claude", apiKey: "k", model: "claude-opus-4-8", baseURL: "https://api.anthropic.com" },
    { fetchImpl: good.fetchImpl }
  );
  assert.equal(okResult.ok, true);

  const bad = makeFetch(() => jsonResponse({ error: { message: "nope" } }, { ok: false, status: 403 }));
  const failResult = await testConnection(
    { provider: "openai", apiKey: "k", model: "gpt-4o", baseURL: "https://api.openai.com" },
    { fetchImpl: bad.fetchImpl }
  );
  assert.equal(failResult.ok, false);
  assert.match(failResult.message, /403|nope/);
});

// ---- workflow integration ----
test("runCreativeWorkflowWithAI falls back to deterministic output when no config", async () => {
  const brief = normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" });
  const sim = runCreativeWorkflow({ brief, skillId: "rednote_seeding_note_v1", brandKit: defaultBrandKit });
  const result = await runCreativeWorkflowWithAI({
    brief,
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: null
  });
  assert.equal(result.aiMeta.used, false);
  assert.equal(result.variants.length, sim.variants.length);
  assert.equal(result.variants[0].caption, sim.variants[0].caption); // 内容与模拟一致
});

test("runCreativeWorkflowWithAI merges real LLM copy into variants", async () => {
  const { fetchImpl } = makeFetch(() =>
    jsonResponse({
      content: [{ type: "text", text: JSON.stringify({ hook: "AI 生成的钩子", caption: "AI 文案", hashtags: ["#真实AI", "#小红书"] }) }]
    })
  );
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: { provider: "claude", apiKey: "k", model: "claude-opus-4-8", baseURL: "https://api.anthropic.com" },
    fetchImpl
  });
  assert.equal(result.aiMeta.used, true);
  assert.equal(result.aiMeta.copyApplied, 3);
  assert.equal(result.variants[0].hook, "AI 生成的钩子");
  assert.equal(result.variants[0].caption, "AI 文案");
  assert.ok(result.variants[0].hashtags.includes("#真实AI"));
  // 评分/结构契约不被 AI 改动
  assert.equal(typeof result.variants[0].score, "number");
});

test("runCreativeWorkflowWithAI degrades gracefully when the AI call fails", async () => {
  const { fetchImpl } = makeFetch(() => jsonResponse({ error: { message: "rate limited" } }, { ok: false, status: 429 }));
  const sim = runCreativeWorkflow({
    brief: normalizeBrief({ productName: "Lamp", platform: "TikTok" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit
  });
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "Lamp", platform: "TikTok" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit,
    aiConfig: { provider: "openai", apiKey: "k", model: "gpt-4o", baseURL: "https://api.openai.com" },
    fetchImpl
  });
  // AI 失败 → 回退模拟文案，不抛错
  assert.equal(result.variants[0].caption, sim.variants[0].caption);
  assert.equal(result.aiMeta.copyApplied, 0);
});

test("runCreativeWorkflowWithAI generates an OpenAI cover image when enabled", async () => {
  const router = url => {
    if (/images\/generations/.test(url)) return jsonResponse({ data: [{ b64_json: "IMG" }] });
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ hook: "h", caption: "c", hashtags: ["#a"] }) } }] });
  };
  const { fetchImpl } = makeFetch(router);
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: { provider: "openai", apiKey: "k", model: "gpt-4o", baseURL: "https://api.openai.com", imageEnabled: true },
    fetchImpl
  });
  assert.equal(result.aiMeta.imageApplied, true);
  assert.match(result.variants[0].imageUrl, /^data:image\/png;base64,IMG$/);
});
