// AI 接入配置：仅存浏览器本地、独立 localStorage key，
// 永不混入主 state blob、永不写日志、永不硬编码。token 由用户自带、风险自负。

export const AI_CONFIG_STORAGE_KEY = "aicrew-ai-config-v1";

// 各 provider 的能力与默认值。新增 provider 只在此登记，调用层一律从这里取数。
export const AI_PROVIDERS = {
  claude: {
    id: "claude",
    name: "Claude (Anthropic)",
    defaultModel: "claude-opus-4-8",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    defaultBaseURL: "https://api.anthropic.com",
    // baseURL 仅允许官方 host，避免 token 被误配/注入到未知主机外发。
    hosts: ["api.anthropic.com"],
    supportsImage: false
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
    defaultBaseURL: "https://api.openai.com",
    hosts: ["api.openai.com"],
    supportsImage: true,
    imageModel: "gpt-image-1"
  }
};

export function listProviders() {
  return Object.values(AI_PROVIDERS);
}

export function defaultAiConfig(provider = "claude") {
  const meta = AI_PROVIDERS[provider] || AI_PROVIDERS.claude;
  return {
    provider: meta.id,
    apiKey: "",
    model: meta.defaultModel,
    baseURL: meta.defaultBaseURL,
    imageEnabled: false
  };
}

// 边界校验：不抛，返回 {valid, errors, config(已归一)}，供 UI 友好提示。
export function validateAiConfig(input = {}) {
  const errors = [];
  const meta = AI_PROVIDERS[input.provider];
  if (!meta) errors.push("未知的 provider（仅支持 claude / openai）");

  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (!apiKey) errors.push("API token 不能为空");

  const model = (typeof input.model === "string" && input.model.trim()) || meta?.defaultModel || "";
  if (!model) errors.push("model 不能为空");

  const baseURL = (typeof input.baseURL === "string" && input.baseURL.trim()) || meta?.defaultBaseURL || "";
  let baseOk = false;
  try {
    baseOk = new URL(baseURL).protocol === "https:";
  } catch {
    baseOk = false;
  }
  if (!baseOk) errors.push("baseURL 必须是合法的 https URL");

  // 图像开关受 provider 能力约束：Claude 无图像能力，强制为 false。
  const imageEnabled = Boolean(input.imageEnabled) && Boolean(meta?.supportsImage);

  return {
    valid: errors.length === 0,
    errors,
    config: { provider: meta?.id ?? input.provider, apiKey, model, baseURL, imageEnabled }
  };
}

export function isAiConfigured(config) {
  return Boolean(config && AI_PROVIDERS[config.provider] && config.apiKey && config.model);
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

// 读取并归一；SSR / 无 window / 损坏数据时安全返回 null。
export function loadAiConfig(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const { config } = validateAiConfig(JSON.parse(raw));
    return config;
  } catch {
    return null;
  }
}

export function saveAiConfig(config, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  const { valid, config: normalized, errors } = validateAiConfig(config);
  if (!valid) throw new Error(`AI 配置无效：${errors.join("；")}`);
  store.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  return true;
}

export function clearAiConfig(storage) {
  const store = resolveStorage(storage);
  if (!store) return;
  store.removeItem(AI_CONFIG_STORAGE_KEY);
}
