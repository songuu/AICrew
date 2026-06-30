import { normalizeFeatureFlags } from "../feature-flags.js";

const MODE_ENV = {
  text: ["AICREW_AI_TEXT_MODEL", "OPENAI_MODEL"],
  image: ["AICREW_AI_IMAGE_MODEL"],
  video: ["AICREW_AI_VIDEO_MODEL"]
};

const MODE_NAME_ENV = {
  text: "AICREW_AI_TEXT_MODEL_NAME",
  image: "AICREW_AI_IMAGE_MODEL_NAME",
  video: "AICREW_AI_VIDEO_MODEL_NAME"
};

const MODE_DESC = {
  text: "系统文本模型：脚本、标题、正文、标签与策略文案",
  image: "系统图像模型：封面、场景图、产品图与视觉方向",
  video: "系统视频模型：图生视频、短片段与动态素材"
};

export const SYSTEM_AI_MODES = ["text", "image", "video"];

function firstEnv(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function cleanBaseURL(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function providerDefaultBaseURL(provider) {
  if (provider === "claude") return "https://api.anthropic.com";
  if (provider === "openai") return "https://api.openai.com";
  return "";
}

function normalizeProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "anthropic") return "claude";
  if (provider === "openai" || provider === "claude") return provider;
  return "openai-compatible";
}

function normalizeImageApi(value = "", baseURL = "") {
  const imageApi = String(value || "").trim().toLowerCase();
  if (imageApi === "siliconflow" || imageApi === "openai") return imageApi;
  try {
    if (new URL(baseURL).hostname.endsWith("siliconflow.cn")) return "siliconflow";
  } catch {
    // The base URL may be missing while the setup page is reporting missing env.
  }
  return "openai";
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function parseCatalog(env) {
  const raw = env?.AICREW_AI_MODELS_JSON;
  if (!raw) return { catalog: null, error: "" };
  try {
    return { catalog: JSON.parse(raw), error: "" };
  } catch (error) {
    return { catalog: null, error: `AICREW_AI_MODELS_JSON 解析失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

function normalizeCatalogModel(mode, item, index, provider) {
  const model = String(item?.model || item?.id || "").trim();
  if (!model) return null;
  return {
    id: String(item?.id || model).trim(),
    mode,
    model,
    name: String(item?.name || model).trim(),
    description: String(item?.description || MODE_DESC[mode]).trim(),
    provider: item?.provider ? String(item.provider) : provider,
    latency: item?.latency ? String(item.latency) : undefined,
    cost: item?.cost ? String(item.cost) : undefined,
    health: Number.isFinite(item?.health) ? item.health : 99,
    size: item?.size ? String(item.size) : undefined,
    imageApi: item?.imageApi || item?.image_api ? String(item.imageApi || item.image_api) : undefined,
    batchSize: optionalNumber(item?.batchSize ?? item?.batch_size),
    numInferenceSteps: optionalNumber(item?.numInferenceSteps ?? item?.num_inference_steps),
    guidanceScale: optionalNumber(item?.guidanceScale ?? item?.guidance_scale),
    endpoint: item?.endpoint ? String(item.endpoint) : undefined,
    order: Number.isFinite(item?.order) ? item.order : index
  };
}

function modelsFromCatalog(mode, catalog, provider) {
  const raw = catalog?.models?.[mode] || catalog?.[mode] || [];
  return Array.isArray(raw)
    ? raw.map((item, index) => normalizeCatalogModel(mode, item, index, provider)).filter(Boolean)
    : [];
}

function modelsFromEnv(mode, env, provider) {
  const model = firstEnv(env, MODE_ENV[mode]);
  if (!model) return [];
  return [
    {
      id: mode === "text" ? "text-primary" : `${mode}-primary`,
      mode,
      model,
      name: env?.[MODE_NAME_ENV[mode]] || model,
      description: MODE_DESC[mode],
      provider,
      latency: env?.[`AICREW_AI_${mode.toUpperCase()}_LATENCY`] || undefined,
      cost: env?.[`AICREW_AI_${mode.toUpperCase()}_COST`] || undefined,
      health: 99,
      size: mode === "image" ? env?.AICREW_AI_IMAGE_SIZE || "1024x1024" : undefined,
      imageApi: mode === "image" ? env?.AICREW_AI_IMAGE_API : undefined,
      batchSize: mode === "image" ? optionalNumber(env?.AICREW_AI_IMAGE_BATCH_SIZE) : undefined,
      numInferenceSteps: mode === "image" ? optionalNumber(env?.AICREW_AI_IMAGE_STEPS) : undefined,
      guidanceScale: mode === "image" ? optionalNumber(env?.AICREW_AI_IMAGE_GUIDANCE_SCALE) : undefined
    }
  ];
}

function withAuto(mode, models) {
  if (!models.length) return [];
  return [
    {
      id: "auto",
      mode,
      name: "自动",
      model: "auto",
      description: "智能匹配适合当前任务的系统模型",
      provider: models[0].provider,
      health: Math.round(models.reduce((sum, item) => sum + (item.health || 99), 0) / models.length),
      configured: true
    },
    ...models.map(item => ({ ...item, configured: true }))
  ];
}

export function createSystemAiRuntime(env = process.env) {
  const provider = normalizeProvider(env?.AICREW_AI_PROVIDER || env?.AI_PROVIDER || (env?.ANTHROPIC_API_KEY ? "claude" : "openai-compatible"));
  const providerName = env?.AICREW_AI_PROVIDER_NAME || env?.AI_PROVIDER_NAME || (provider === "claude" ? "Claude" : provider === "openai" ? "OpenAI" : "项目 AI 平台");
  const baseURL = cleanBaseURL(env?.AICREW_AI_BASE_URL || env?.AI_BASE_URL || env?.OPENAI_BASE_URL || providerDefaultBaseURL(provider));
  const imageApi = normalizeImageApi(env?.AICREW_AI_IMAGE_API, baseURL);
  const apiKey = firstEnv(env, ["AICREW_AI_API_KEY", "AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
  const { catalog, error } = parseCatalog(env);
  const catalogProviderName = catalog?.providerName || catalog?.provider_name;
  const models = Object.fromEntries(
    SYSTEM_AI_MODES.map(mode => {
      const catalogModels = modelsFromCatalog(mode, catalog, provider);
      return [mode, catalogModels.length ? catalogModels : modelsFromEnv(mode, env, provider)];
    })
  );
  const missing = [];
  if (!baseURL) missing.push("AICREW_AI_BASE_URL");
  if (!apiKey) missing.push("AICREW_AI_API_KEY");
  if (!models.text.length) missing.push("AICREW_AI_TEXT_MODEL");
  const configured = missing.length === 0;

  return {
    provider,
    providerName: catalogProviderName || providerName,
    baseURL,
    apiKey,
    imageApi,
    configured,
    missing,
    error,
    features: normalizeFeatureFlags({}, env),
    models,
    defaults: Object.fromEntries(SYSTEM_AI_MODES.map(mode => [mode, models[mode].length ? "auto" : ""]))
  };
}

export function publicSystemAiConfig(runtime = createSystemAiRuntime()) {
  return {
    providerName: runtime.providerName,
    configured: runtime.configured,
    missing: runtime.missing,
    error: runtime.error,
    defaults: runtime.defaults,
    features: runtime.features || normalizeFeatureFlags(),
    modes: Object.fromEntries(
      SYSTEM_AI_MODES.map(mode => [
        mode,
        withAuto(mode, runtime.models[mode]).map(
          ({ model, endpoint, size, imageApi, batchSize, numInferenceSteps, guidanceScale, order, ...publicModel }) => publicModel
        )
      ])
    )
  };
}

function firstConfigured(models = []) {
  return models.find(item => item.id !== "auto") || null;
}

export function resolveSystemModel(runtime, mode, modelId = "auto") {
  if (!SYSTEM_AI_MODES.includes(mode)) throw new Error(`不支持的 AI 模式：${mode}`);
  const models = runtime.models[mode] || [];
  const selected = modelId && modelId !== "auto" ? models.find(item => item.id === modelId) : firstConfigured(models);
  if (!selected) throw new Error(`系统未配置 ${mode} 模型`);
  return selected;
}

export function connectionFor(runtime, route) {
  return {
    provider: route.provider || runtime.provider,
    providerName: runtime.providerName,
    baseURL: runtime.baseURL,
    apiKey: runtime.apiKey,
    model: route.model,
    imageModel: route.model,
    videoModel: route.model,
    endpoint: route.endpoint,
    size: route.size,
    imageApi: route.imageApi || runtime.imageApi,
    batchSize: route.batchSize,
    numInferenceSteps: route.numInferenceSteps,
    guidanceScale: route.guidanceScale
  };
}

