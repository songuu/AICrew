export const AI_SELECTION_STORAGE_KEY = "aicrew-ai-selection-v1";

export const AI_MODEL_MODES = ["text", "image", "video"];

export const AI_MODE_LABELS = {
  text: "文本",
  image: "图像",
  video: "视频"
};

export const AI_MODE_DESCRIPTIONS = {
  text: "脚本、标题、正文、标签与策略文案",
  image: "封面、场景图、产品图与视觉方向",
  video: "图生视频、短片段与动态素材"
};

const EMPTY_MODES = Object.freeze({ text: [], image: [], video: [] });

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeModelOption(mode, option, index) {
  const modelId = String(option?.id || option?.model || `${mode}_${index + 1}`).trim();
  const modelName = String(option?.name || option?.model || modelId).trim();
  return {
    id: modelId,
    mode,
    name: modelName,
    model: String(option?.model || modelId).trim(),
    description: String(option?.description || AI_MODE_DESCRIPTIONS[mode] || "系统模型").trim(),
    provider: option?.provider ? String(option.provider) : undefined,
    latency: option?.latency ? String(option.latency) : undefined,
    cost: option?.cost ? String(option.cost) : undefined,
    health: Number.isFinite(option?.health) ? option.health : undefined,
    configured: option?.configured !== false
  };
}

function normalizeModeOptions(mode, options = []) {
  return safeArray(options).map((option, index) => normalizeModelOption(mode, option, index)).filter(option => option.id);
}

function firstConfiguredOption(options = []) {
  return options.find(option => option.configured !== false && option.id !== "auto") || options.find(option => option.configured !== false) || null;
}

export function normalizeSystemAiConfig(input = {}) {
  input = input || {};
  const rawModes = input.modes || input.models || EMPTY_MODES;
  const modes = Object.fromEntries(AI_MODEL_MODES.map(mode => [mode, normalizeModeOptions(mode, rawModes[mode])]));
  const defaults = Object.fromEntries(
    AI_MODEL_MODES.map(mode => {
      const configured = firstConfiguredOption(modes[mode]);
      return [mode, input.defaults?.[mode] || (configured ? "auto" : "")];
    })
  );
  const configured = Boolean(input.configured) && AI_MODEL_MODES.some(mode => Boolean(firstConfiguredOption(modes[mode])));

  return {
    provider: "system",
    providerName: input.providerName || "AI Platform",
    endpoint: input.endpoint || "/api/ai/generate",
    configured,
    modes,
    defaults,
    error: input.error || ""
  };
}

export function defaultAiSelection(config) {
  const normalized = normalizeSystemAiConfig(config);
  return Object.fromEntries(
    AI_MODEL_MODES.map(mode => [mode, normalized.defaults[mode] || firstConfiguredOption(normalized.modes[mode])?.id || ""])
  );
}

export function normalizeAiSelection(selection = {}, config) {
  const normalized = normalizeSystemAiConfig(config);
  const fallback = defaultAiSelection(normalized);
  return Object.fromEntries(
    AI_MODEL_MODES.map(mode => {
      const wanted = selection?.[mode] || fallback[mode];
      const exists = normalized.modes[mode].some(option => option.id === wanted);
      return [mode, exists ? wanted : fallback[mode]];
    })
  );
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

export function loadAiSelection(config, storage) {
  const store = resolveStorage(storage);
  if (!store) return defaultAiSelection(config);
  try {
    const raw = store.getItem(AI_SELECTION_STORAGE_KEY);
    return normalizeAiSelection(raw ? JSON.parse(raw) : {}, config);
  } catch {
    return defaultAiSelection(config);
  }
}

export function saveAiSelection(selection, config, storage) {
  const store = resolveStorage(storage);
  const normalized = normalizeAiSelection(selection, config);
  if (store) store.setItem(AI_SELECTION_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function isAiConfigured(config) {
  if (config?.provider && config.provider !== "system") {
    return Boolean(config.apiKey && config.model);
  }
  const normalized = normalizeSystemAiConfig(config);
  return Boolean(normalized.configured && firstConfiguredOption(normalized.modes.text));
}

export function hasAiMode(config, mode) {
  if (config?.provider && config.provider !== "system") {
    if (mode === "text") return isAiConfigured(config);
    if (mode === "image") return Boolean(isAiConfigured(config) && (config.imageEnabled || config.imageModel));
    if (mode === "video") return Boolean(isAiConfigured(config) && config.videoModel);
  }
  const normalized = normalizeSystemAiConfig(config);
  return Boolean(normalized.configured && firstConfiguredOption(normalized.modes[mode]));
}

export function selectedModelFor(config, selection, mode) {
  if (config?.provider && config.provider !== "system") {
    const model = mode === "image" ? config.imageModel || config.model : mode === "video" ? config.videoModel || config.model : config.model;
    return model ? { id: model, mode, name: model, model, provider: config.provider } : null;
  }
  const normalized = normalizeSystemAiConfig(config);
  const normalizedSelection = normalizeAiSelection(selection || config?.selection || {}, normalized);
  const options = normalized.modes[mode] || [];
  const selectedId = normalizedSelection[mode] || normalized.defaults[mode];
  if (selectedId === "auto") return firstConfiguredOption(options);
  return options.find(option => option.id === selectedId) || firstConfiguredOption(options);
}

export function describeSelectedModel(config, selection, mode = "text") {
  const model = selectedModelFor(config, selection, mode);
  return model ? `${AI_MODE_LABELS[mode]} · ${model.name}` : `${AI_MODE_LABELS[mode]} · 未配置`;
}