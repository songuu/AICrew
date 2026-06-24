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
} from "../lib/ai/config.js";
import {
  connectionFor,
  createSystemAiRuntime,
  publicSystemAiConfig,
  resolveSystemModel
} from "../lib/ai/server-config.js";
import { generateText, generateImage, generateVideo, testConnection } from "../lib/ai/providers.js";
import { runCreativeWorkflowWithAI } from "../lib/ai/workflow.js";
import { runCreativeWorkflow, defaultBrandKit, normalizeBrief } from "../lib/domain.js";

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

test("runCreativeWorkflowWithAI injects uploaded material names into image prompts", async () => {
  const imagePrompts = [];
  const router = (url, options) => {
    const body = JSON.parse(options.body);
    if (body.mode === "image") {
      imagePrompts.push(body.prompt);
      return jsonResponse({ imageUrl: "data:image/png;base64,IMG" });
    }
    return jsonResponse({ text: JSON.stringify({ hook: "h", caption: "c", hashtags: ["#a"] }) });
  };
  const { fetchImpl } = makeFetch(router);
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({
      productName: "NovaGlow Lamp",
      platform: "小红书",
      materials: [{ name: "product-front.png", type: "image/png", ref: "data:image/png;base64,AAA" }]
    }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.equal(result.aiMeta.imageApplied, true);
  assert.ok(imagePrompts.length > 0, "expected image generation calls");
  assert.ok(
    imagePrompts.every(prompt => prompt.includes("product-front.png")),
    "every image prompt should reference the uploaded material"
  );
});

test("image prompts omit the material clause when no material is uploaded", async () => {
  const imagePrompts = [];
  const router = (url, options) => {
    const body = JSON.parse(options.body);
    if (body.mode === "image") {
      imagePrompts.push(body.prompt);
      return jsonResponse({ imageUrl: "data:image/png;base64,IMG" });
    }
    return jsonResponse({ text: JSON.stringify({ hook: "h", caption: "c", hashtags: ["#a"] }) });
  };
  const { fetchImpl } = makeFetch(router);
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "NovaGlow Lamp", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.ok(imagePrompts.length > 0);
  assert.ok(imagePrompts.every(prompt => !prompt.includes("参考用户上传素材")));
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

// ---- multi-variant image generation (P1) ----
function studioRouter({ failImageAt } = {}) {
  let imageCall = 0;
  return (url, options) => {
    const body = JSON.parse(options.body);
    if (body.mode === "image") {
      imageCall += 1;
      if (failImageAt && imageCall === failImageAt) {
        return jsonResponse({ error: { message: "img fail" } }, { ok: false, status: 500 });
      }
      return jsonResponse({ imageUrl: `data:image/png;base64,IMG${imageCall}` });
    }
    return jsonResponse({ text: JSON.stringify({ hook: "h", caption: "c", hashtags: ["#a"] }) });
  };
}

test("runCreativeWorkflowWithAI generates a distinct image for every variant", async () => {
  const { fetchImpl } = makeFetch(studioRouter());
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });

  assert.equal(result.aiMeta.imageAppliedCount, 3);
  assert.equal(result.aiMeta.imageApplied, true);
  const urls = result.variants.map(variant => variant.imageUrl);
  assert.ok(urls.every(Boolean));
  assert.equal(new Set(urls).size, 3);
});

test("a single variant image failure is isolated and recorded in aiMeta", async () => {
  const { fetchImpl } = makeFetch(studioRouter({ failImageAt: 2 }));
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });

  assert.equal(result.aiMeta.imageAppliedCount, 2);
  assert.equal(result.aiMeta.copyApplied, 3);
  assert.equal(result.aiMeta.imageErrors.length, 1);
  assert.equal(result.variants.filter(variant => variant.imageUrl).length, 2);
});

test("enabledModes.image=false skips image generation entirely", async () => {
  const { fetchImpl, calls } = makeFetch(studioRouter());
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    enabledModes: { text: true, image: false },
    fetchImpl
  });

  assert.equal(result.aiMeta.imageAppliedCount, 0);
  assert.equal(result.aiMeta.imageApplied, false);
  assert.equal(result.aiMeta.copyApplied, 3);
  assert.ok(!calls.some(call => call.body.mode === "image"));
});

test("maxImagesPerRun caps how many variants get images while keeping copy", async () => {
  const { fetchImpl } = makeFetch(studioRouter());
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: { ...systemConfig(), maxImagesPerRun: 2 },
    fetchImpl
  });

  assert.equal(result.aiMeta.imageAppliedCount, 2);
  assert.ok(result.variants[0].imageUrl);
  assert.ok(result.variants[1].imageUrl);
  assert.ok(!result.variants[2].imageUrl);
  assert.ok(result.variants[2].caption);
});

// ---- skill-driven generation: 选中技能的意图注入文案/出图 prompt ----
function promptCaptureRouter(textPrompts, imagePrompts) {
  return (url, options) => {
    const body = JSON.parse(options.body);
    if (body.mode === "image") {
      imagePrompts.push(body.prompt);
      return jsonResponse({ imageUrl: "data:image/png;base64,IMG" });
    }
    textPrompts.push(body.prompt);
    return jsonResponse({ text: JSON.stringify({ hook: "h", caption: "c", hashtags: ["#a"] }) });
  };
}

test("selecting a preset skill injects its intent into copy and image prompts", async () => {
  const textPrompts = [];
  const imagePrompts = [];
  const { fetchImpl } = makeFetch(promptCaptureRouter(textPrompts, imagePrompts));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "ugc_review_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.ok(textPrompts.length > 0 && imagePrompts.length > 0);
  // 文案与出图 prompt 都应携带技能名 + 风格锚点关键词「创作技能」。
  assert.ok(textPrompts.every(prompt => prompt.includes("UGC 种草测评") && prompt.includes("创作技能")));
  assert.ok(imagePrompts.every(prompt => prompt.includes("UGC 种草测评") && prompt.includes("创作技能")));
});

test("a flow-composed skill without bestFor does not inject a skill clause", async () => {
  const textPrompts = [];
  const imagePrompts = [];
  const { fetchImpl } = makeFetch(promptCaptureRouter(textPrompts, imagePrompts));
  // 模拟 flowToSkill 的合成 skill：bestFor 为空串 → prompt 注入应跳过（向后兼容）。
  const synthetic = {
    id: "flow_synthetic",
    name: "自定义编排",
    category: "Flow",
    stage: "manual",
    estimatedCredits: 12,
    formats: ["封面", "图文", "文案"],
    agents: ["visual", "copy", "qa"],
    palette: ["#8bd3ff", "#ff7a90", "#f9c74f"],
    promise: "由编排图实时生成",
    bestFor: ""
  };
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "露营灯", platform: "小红书" }),
    skill: synthetic,
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.ok(textPrompts.length > 0 && imagePrompts.length > 0);
  assert.ok(textPrompts.every(prompt => !prompt.includes("创作技能")));
  assert.ok(imagePrompts.every(prompt => !prompt.includes("创作技能")));
});

// ---- copy engine upgrade: prompt carries hook frameworks + platform rules + pain inference ----
test("copy prompt injects platform hook frameworks, copy rules, and pain inference", async () => {
  const textPrompts = [];
  const { fetchImpl } = makeFetch(promptCaptureRouter(textPrompts, []));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.ok(textPrompts.length > 0);
  assert.ok(textPrompts.every(prompt => prompt.includes("框架")), "every copy prompt should carry hook frameworks");
  assert.ok(textPrompts.every(prompt => prompt.includes("文案规范")), "every copy prompt should carry platform copy rules");
  assert.ok(textPrompts.every(prompt => prompt.includes("痛点推断")), "every copy prompt should request pain inference");
});

test("Hook Lab (hook node) adds a multi-candidate hook instruction; non-hook skills don't", async () => {
  const hookPrompts = [];
  const plainPrompts = [];
  const { fetchImpl: hookFetch } = makeFetch(promptCaptureRouter(hookPrompts, []));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "hook_lab_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl: hookFetch
  });
  const { fetchImpl: plainFetch } = makeFetch(promptCaptureRouter(plainPrompts, []));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl: plainFetch
  });
  assert.ok(hookPrompts.length > 0 && plainPrompts.length > 0);
  assert.ok(hookPrompts.every(prompt => prompt.includes("候选钩子")), "Hook Lab prompt should request candidate hooks");
  assert.ok(plainPrompts.every(prompt => !prompt.includes("候选钩子")), "non-hook skill must not get the Hook Lab instruction");
});

// ---- agent expansion: trend / persona / seo prompt injection (gated on node presence) ----
test("trend/persona/seo nodes inject their guidance into copy prompt; absent when not orchestrated", async () => {
  const fullPrompts = [];
  const { fetchImpl: fullFetch } = makeFetch(promptCaptureRouter(fullPrompts, []));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "viral_content_engine_v1", // 含 trend + persona + seo
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl: fullFetch
  });
  assert.ok(fullPrompts.length > 0);
  assert.ok(fullPrompts.every(p => p.includes("选题角度")), "trend guidance missing");
  assert.ok(fullPrompts.every(p => p.includes("人设口吻")), "persona guidance missing");
  assert.ok(fullPrompts.every(p => p.includes("搜索优化")), "seo guidance missing");

  // 合成 copy-only skill（无 trend/persona/seo 节点）→ 三段指引都不应出现（向后兼容 / 节点门控）
  const barePrompts = [];
  const { fetchImpl: bareFetch } = makeFetch(promptCaptureRouter(barePrompts, []));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "露营灯", platform: "小红书" }),
    skill: {
      id: "syn_copy_only",
      name: "syn",
      category: "Flow",
      stage: "manual",
      estimatedCredits: 12,
      formats: ["文案"],
      agents: ["copy", "qa"],
      palette: ["#8bd3ff"],
      promise: "x",
      bestFor: ""
    },
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl: bareFetch
  });
  assert.ok(barePrompts.length > 0);
  assert.ok(
    barePrompts.every(p => !p.includes("选题角度") && !p.includes("人设口吻") && !p.includes("搜索优化")),
    "copy-only skill must not get trend/persona/seo guidance"
  );
});

// ---- AI 文案层加固：每条 variant 锁定专属框架 + JSON 提取容错 ----
test("each variant's copy prompt locks a distinct hook framework", async () => {
  const prompts = [];
  const { fetchImpl } = makeFetch(promptCaptureRouter(prompts, []));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.equal(prompts.length, 3); // 3 个 variant 各一条 prompt
  // 每条都带专属框架锁
  assert.ok(prompts.every(p => p.includes("本条主打")), "every prompt should lock a per-angle framework");
  // 3 条锁定的框架名各不相同（痛点开场 / 好奇缺口 / 紧迫）→ 真差异化
  const locked = prompts.map(p => (p.match(/本条主打「([^」]+)」/) || [])[1]).filter(Boolean);
  assert.equal(locked.length, 3);
  assert.equal(new Set(locked).size, 3, `frameworks should be distinct, got ${locked.join("/")}`);
});

test("extractJson tolerates code fences and trailing commas (copy still applies)", async () => {
  // 模型返回 ```json 围栏 + 尾随逗号的脏 JSON——加固后仍应解析成功并应用文案。
  const dirty = "```json\n{\n  \"hook\": \"被加固解析的钩子\",\n  \"caption\": \"正文\",\n  \"hashtags\": [\"#a\", \"#b\",]\n}\n```";
  const { fetchImpl } = makeFetch((url, options) => {
    const body = JSON.parse(options.body);
    if (body.mode === "image") return jsonResponse({ imageUrl: "data:image/png;base64,IMG" });
    return jsonResponse({ text: dirty });
  });
  const result = await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "玻尿酸面膜", platform: "小红书" }),
    skillId: "rednote_seeding_note_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.equal(result.aiMeta.copyApplied, result.variants.length, "dirty-but-recoverable JSON should still apply");
  assert.ok(result.variants.every(v => v.hook === "被加固解析的钩子"));
});

// ---- 跨境平台扩容：新平台 DNA 经 copyRules/hookGuidance 真实流入 copy prompt ----
test("a new platform (YouTube Shorts) injects its own DNA into the copy prompt", async () => {
  const prompts = [];
  const { fetchImpl } = makeFetch(promptCaptureRouter(prompts, []));
  await runCreativeWorkflowWithAI({
    brief: normalizeBrief({ productName: "便携补光灯", platform: "YouTube Shorts", targetAudience: "跨境内容团队" }),
    skillId: "ecom_tiktok_product_ad_v1",
    brandKit: defaultBrandKit,
    aiConfig: systemConfig(),
    fetchImpl
  });
  assert.ok(prompts.length > 0);
  // hook 指引头部携带平台名 + 该平台 hookSeconds（5s），证明 preset 真实驱动而非硬编码
  assert.ok(prompts.every(p => p.includes("YouTube Shorts")), "prompt should carry the platform name");
  assert.ok(prompts.every(p => p.includes("5 秒")), "prompt should carry YouTube Shorts hookSeconds");
  // 该平台专属 CTA 范例进入文案规范
  assert.ok(prompts.every(p => p.includes("关注看完整教程")), "prompt should carry the platform-native CTA example");
});
