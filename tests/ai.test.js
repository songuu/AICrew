import test from "node:test";
import assert from "node:assert/strict";
import {
  hasAiMode,
  isAiConfigured,
  loadAiSelection,
  normalizeSystemAiConfig,
  saveAiSelection,
  selectedModelFor,
  AI_SELECTION_STORAGE_KEY
} from "../src/ai/config.js";
import {
  connectionFor,
  createSystemAiRuntime,
  publicSystemAiConfig,
  resolveSystemModel
} from "../src/ai/server-config.js";
import { generateText, generateImage, generateVideo, testConnection } from "../src/ai/providers.js";
import { runCreativeWorkflowWithAI } from "../src/ai/workflow.js";
import { runCreativeWorkflow, defaultBrandKit, normalizeBrief } from "../src/domain.js";

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

function makeFetch(router) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return router(url, options);
  };
  return { fetchImpl, calls };
}

function systemConfig(overrides = {}) {
  const config = normalizeSystemAiConfig({
    providerName: "Team AI",
    configured: true,
    endpoint: "/api/ai/generate",
    modes: {
      text: [
        { id: "auto", name: "自动", model: "auto" },
        { id: "text-primary", name: "Text Pro", model: "team-text" }
      ],
      image: [
        { id: "auto", name: "自动", model: "auto" },
        { id: "image-primary", name: "Image Pro", model: "team-image" }
      ],
      video: [{ id: "video-primary", name: "Video Pro", model: "team-video" }]
    },
    defaults: { text: "auto", image: "auto", video: "video-primary" },
    ...overrides
  });
  return { ...config, selection: { text: "text-primary", image: "auto", video: "video-primary" } };
}

// ---- system config ----
test("createSystemAiRuntime reads project env for text, image, and video routes", () => {
  const runtime = createSystemAiRuntime({
    AICREW_AI_PROVIDER_NAME: "Acme AI",
    AICREW_AI_BASE_URL: "https://ai.example.com/v1/",
    AICREW_AI_API_KEY: "secret-key",
    AICREW_AI_TEXT_MODEL: "text-xl",
    AICREW_AI_IMAGE_MODEL: "image-xl",
    AICREW_AI_VIDEO_MODEL: "video-xl",
    AICREW_AI_IMAGE_API: "siliconflow",
    AICREW_AI_IMAGE_BATCH_SIZE: "2",
    AICREW_AI_IMAGE_STEPS: "30",
    AICREW_AI_IMAGE_GUIDANCE_SCALE: "8"
  });

  assert.equal(runtime.configured, true);
  assert.equal(runtime.providerName, "Acme AI");
  assert.equal(runtime.baseURL, "https://ai.example.com/v1");
  assert.equal(runtime.models.text[0].model, "text-xl");
  assert.equal(runtime.models.image[0].model, "image-xl");
  assert.equal(runtime.models.image[0].imageApi, "siliconflow");
  assert.equal(runtime.models.image[0].batchSize, 2);
  assert.equal(runtime.models.image[0].numInferenceSteps, 30);
  assert.equal(runtime.models.image[0].guidanceScale, 8);
  assert.equal(runtime.models.video[0].model, "video-xl");
});

test("publicSystemAiConfig exposes model catalog but never the server API key", () => {
  const runtime = createSystemAiRuntime({
    AICREW_AI_BASE_URL: "https://ai.example.com",
    AICREW_AI_API_KEY: "do-not-leak",
    AICREW_AI_TEXT_MODEL: "text-xl",
    AICREW_AI_IMAGE_MODEL: "image-xl"
  });
  const publicConfig = publicSystemAiConfig(runtime);
  const serialized = JSON.stringify(publicConfig);

  assert.equal(publicConfig.configured, true);
  assert.equal(publicConfig.modes.text[0].id, "auto");
  assert.ok(publicConfig.modes.text.some(model => model.name === "text-xl"));
  assert.ok(!serialized.includes("do-not-leak"));
  assert.ok(!serialized.includes("https://ai.example.com"));
});

test("AICREW_AI_MODELS_JSON supports multiple configured system models", () => {
  const runtime = createSystemAiRuntime({
    AICREW_AI_BASE_URL: "https://ai.example.com",
    AICREW_AI_API_KEY: "k",
    AICREW_AI_MODELS_JSON: JSON.stringify({
      providerName: "Catalog AI",
      models: {
        text: [
          { id: "copy-fast", model: "copy-fast-v1", name: "Copy Fast" },
          { id: "copy-deep", model: "copy-deep-v1", name: "Copy Deep" }
        ],
        image: [{ id: "poster", model: "poster-v1", name: "Poster" }],
        video: [{ id: "clip", model: "clip-v1", name: "Clip" }]
      }
    })
  });

  assert.equal(runtime.providerName, "Catalog AI");
  assert.equal(resolveSystemModel(runtime, "text", "copy-deep").model, "copy-deep-v1");
  assert.equal(resolveSystemModel(runtime, "image", "auto").model, "poster-v1");
});

test("selection helpers persist only model ids", () => {
  const config = systemConfig();
  const store = memStorage();
  const selection = saveAiSelection({ text: "text-primary", image: "image-primary", video: "missing" }, config, store);

  assert.deepEqual(selection, { text: "text-primary", image: "image-primary", video: "video-primary" });
  assert.equal(JSON.parse(store.getItem(AI_SELECTION_STORAGE_KEY)).text, "text-primary");
  assert.equal(loadAiSelection(config, store).image, "image-primary");
  assert.equal(selectedModelFor(config, selection, "text").name, "Text Pro");
});

// ---- provider proxy and direct calls ----
test("system generateText calls project API without exposing token or baseURL", async () => {
  const config = systemConfig();
  const { fetchImpl, calls } = makeFetch(() => jsonResponse({ text: "系统文案" }));
  const text = await generateText(config, { system: "sys", prompt: "写文案", fetchImpl });

  assert.equal(text, "系统文案");
  assert.equal(calls[0].url, "/api/ai/generate");
  assert.equal(calls[0].body.mode, "text");
  assert.equal(calls[0].body.modelId, "text-primary");
  assert.ok(!JSON.stringify(calls[0].body).includes("apiKey"));
});

test("system generateImage and generateVideo use image/video modes", async () => {
  const config = systemConfig();
  const image = makeFetch(() => jsonResponse({ imageUrl: "data:image/png;base64,IMG" }));
  const video = makeFetch(() => jsonResponse({ videoUrl: "https://cdn.example.com/video.mp4" }));

  assert.match(await generateImage(config, { prompt: "封面", fetchImpl: image.fetchImpl }), /^data:image/);
  assert.equal(image.calls[0].body.mode, "image");
  assert.equal(image.calls[0].body.modelId, "auto");

  const result = await generateVideo(config, { prompt: "短片", fetchImpl: video.fetchImpl });
  assert.equal(result.videoUrl, "https://cdn.example.com/video.mp4");
  assert.equal(video.calls[0].body.mode, "video");
  assert.equal(video.calls[0].body.modelId, "video-primary");
});

test("generateText calls the Anthropic messages endpoint", async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonResponse({ content: [{ type: "text", text: "你好 hook" }] }));
  const config = { provider: "claude", apiKey: "sk-ant", model: "claude-sonnet", baseURL: "https://api.anthropic.com" };
  const text = await generateText(config, { system: "sys", prompt: "写个 hook", fetchImpl });

  assert.equal(text, "你好 hook");
  assert.match(calls[0].url, /\/v1\/messages$/);
  assert.equal(calls[0].options.headers["x-api-key"], "sk-ant");
  assert.equal(calls[0].body.model, "claude-sonnet");
});

test("generateText calls an OpenAI-compatible chat completions endpoint", async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonResponse({ choices: [{ message: { content: "openai hook" } }] }));
  const config = { provider: "openai-compatible", apiKey: "sk-oai", model: "gpt-4o", baseURL: "https://ai.example.com" };
  const text = await generateText(config, { prompt: "写文案", fetchImpl });

  assert.equal(text, "openai hook");
  assert.match(calls[0].url, /\/v1\/chat\/completions$/);
  assert.equal(calls[0].options.headers.authorization, "Bearer sk-oai");
});

test("generateImage hits OpenAI-compatible images endpoint and returns a data URL", async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonResponse({ data: [{ b64_json: "AAAA" }] }));
  const config = { provider: "openai-compatible", apiKey: "sk-oai", model: "image-xl", baseURL: "https://ai.example.com" };
  const url = await generateImage(config, { prompt: "封面", size: "1024x1024", fetchImpl });

  assert.match(url, /^data:image\/png;base64,AAAA$/);
  assert.match(calls[0].url, /\/v1\/images\/generations$/);
  assert.deepEqual(calls[0].body, { model: "image-xl", prompt: "封面", size: "1024x1024", n: 1 });
});

test("generateImage supports SiliconFlow image generation payload and response shape", async () => {
  const { fetchImpl, calls } = makeFetch(() => jsonResponse({ images: [{ url: "https://sf.example.com/image.png" }] }));
  const config = {
    provider: "openai-compatible",
    apiKey: "sk-sf",
    model: "Kwai-Kolors/Kolors",
    baseURL: "https://api.siliconflow.cn/v1",
    imageApi: "siliconflow",
    size: "1024x1024"
  };
  const url = await generateImage(config, { prompt: "封面", fetchImpl });

  assert.equal(url, "https://sf.example.com/image.png");
  assert.equal(calls[0].url, "https://api.siliconflow.cn/v1/images/generations");
  assert.deepEqual(calls[0].body, {
    model: "Kwai-Kolors/Kolors",
    prompt: "封面",
    image_size: "1024x1024",
    batch_size: 1,
    num_inference_steps: 20,
    guidance_scale: 7.5
  });
});

test("testConnection returns ok on success and captures failure message otherwise", async () => {
  const good = makeFetch(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
  const okResult = await testConnection(
    { provider: "openai-compatible", apiKey: "k", model: "gpt", baseURL: "https://ai.example.com" },
    { fetchImpl: good.fetchImpl }
  );
  assert.equal(okResult.ok, true);

  const bad = makeFetch(() => jsonResponse({ error: { message: "nope" } }, { ok: false, status: 403 }));
  const failResult = await testConnection(
    { provider: "openai-compatible", apiKey: "k", model: "gpt", baseURL: "https://ai.example.com" },
    { fetchImpl: bad.fetchImpl }
  );
  assert.equal(failResult.ok, false);
  assert.match(failResult.message, /403|nope/);
});

// ---- workflow integration ----
test("isAiConfigured and hasAiMode handle system and direct configs", () => {
  const config = systemConfig();
  assert.equal(isAiConfigured(config), true);
  assert.equal(hasAiMode(config, "image"), true);
  assert.equal(hasAiMode(config, "video"), true);
  assert.equal(isAiConfigured({ provider: "openai-compatible", apiKey: "k", model: "gpt" }), true);
});

test("runCreativeWorkflowWithAI falls back to deterministic output when no system config", async () => {
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
  assert.equal(result.variants[0].caption, sim.variants[0].caption);
});

test("runCreativeWorkflowWithAI merges real LLM copy into variants", async () => {
  const { fetchImpl } = makeFetch(() =>
    jsonResponse({ content: [{ type: "text", text: JSON.stringify({ hook: "AI 生成的钩子", caption: "AI 文案", hashtags: ["#真实AI", "#小红书"] }) }] })
  );
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: { provider: "claude", apiKey: "k", model: "claude-sonnet", baseURL: "https://api.anthropic.com" },
    fetchImpl
  });
  assert.equal(result.aiMeta.used, true);
  assert.equal(result.aiMeta.copyApplied, 3);
  assert.equal(result.variants[0].hook, "AI 生成的钩子");
  assert.equal(result.variants[0].caption, "AI 文案");
  assert.ok(result.variants[0].hashtags.includes("#真实AI"));
});

test("runCreativeWorkflowWithAI does not flag aiGenerated for empty-shell model output", async () => {
  const { fetchImpl } = makeFetch(() => jsonResponse({ content: [{ type: "text", text: "{}" }] }));
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "Lamp", platform: "TikTok" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit,
    aiConfig: { provider: "claude", apiKey: "k", model: "claude-sonnet", baseURL: "https://api.anthropic.com" },
    fetchImpl
  });
  assert.equal(result.aiMeta.copyApplied, 0);
  assert.equal(result.aiMeta.used, false);
  assert.ok(!result.variants[0].aiGenerated);
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
    aiConfig: { provider: "openai-compatible", apiKey: "k", model: "gpt", baseURL: "https://ai.example.com" },
    fetchImpl
  });
  assert.equal(result.variants[0].caption, sim.variants[0].caption);
  assert.equal(result.aiMeta.copyApplied, 0);
});

test("runCreativeWorkflowWithAI uses system text and image models through project API", async () => {
  const router = (url, options) => {
    const body = JSON.parse(options.body);
    if (body.mode === "image") return jsonResponse({ imageUrl: "data:image/png;base64,IMG" });
    return jsonResponse({ text: JSON.stringify({ hook: "h", caption: "c", hashtags: ["#a"] }) });
  };
  const { fetchImpl, calls } = makeFetch(router);
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });

  assert.equal(result.aiMeta.copyApplied, 3);
  assert.equal(result.aiMeta.imageApplied, true);
  assert.match(result.variants[0].imageUrl, /^data:image\/png;base64,IMG$/);
  assert.ok(calls.some(call => call.body.mode === "text"));
  assert.ok(calls.some(call => call.body.mode === "image"));
});

test("connectionFor maps a resolved system route to a direct provider config", () => {
  const runtime = createSystemAiRuntime({
    AICREW_AI_PROVIDER: "openai-compatible",
    AICREW_AI_BASE_URL: "https://api.siliconflow.cn/v1",
    AICREW_AI_API_KEY: "k",
    AICREW_AI_TEXT_MODEL: "text-xl",
    AICREW_AI_IMAGE_MODEL: "Kwai-Kolors/Kolors",
    AICREW_AI_IMAGE_SIZE: "1024x1024"
  });
  const route = resolveSystemModel(runtime, "image", "auto");
  const connection = connectionFor(runtime, route);
  assert.equal(connection.provider, "openai-compatible");
  assert.equal(connection.model, "Kwai-Kolors/Kolors");
  assert.equal(connection.apiKey, "k");
  assert.equal(connection.imageApi, "siliconflow");
});
