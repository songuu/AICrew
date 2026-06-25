export const AI_ROUTE_PUBLIC_ERROR = "AI 生成失败，请稍后重试。";

const VALID_MODES = new Set(["text", "image", "video"]);
const MAX_PROMPT_CHARS = 12000;
const MAX_SYSTEM_CHARS = 4000;
const MAX_MODEL_ID_CHARS = 120;
const MAX_IMAGE_URL_CHARS = 4096;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_RATE_KEYS = 512;
const rateBuckets = new Map();

export class AiRouteInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AiRouteInputError";
    this.status = status;
  }
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiRouteInputError("请求 JSON 必须是对象");
  return value;
}

function boundedString(value, field, limit, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new AiRouteInputError(field + " 不能为空");
  if (text.length > limit) throw new AiRouteInputError(field + " 超出长度限制");
  return text;
}

function clampMaxTokens(value) {
  const numberValue = Number(value ?? 1024);
  if (!Number.isFinite(numberValue)) return 1024;
  return Math.min(4096, Math.max(1, Math.trunc(numberValue)));
}

export function sanitizeImageSize(value = "1024x1024") {
  const text = boundedString(value || "1024x1024", "size", 40) || "1024x1024";
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(text);
  if (!match) throw new AiRouteInputError("size 格式无效");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 256 || height < 256 || width > 2048 || height > 2048) throw new AiRouteInputError("size 超出范围");
  return text;
}

export function normalizeAiRouteBody(input) {
  const body = asObject(input);
  const mode = boundedString(body.mode || "text", "mode", 20) || "text";
  if (!VALID_MODES.has(mode)) throw new AiRouteInputError("不支持的 AI 模式：" + mode);
  return {
    mode,
    modelId: boundedString(body.modelId || "auto", "modelId", MAX_MODEL_ID_CHARS) || "auto",
    system: boundedString(body.system, "system", MAX_SYSTEM_CHARS),
    prompt: boundedString(body.prompt, "prompt", MAX_PROMPT_CHARS, { required: true }),
    maxTokens: clampMaxTokens(body.maxTokens),
    size: sanitizeImageSize(body.size || "1024x1024"),
    imageUrl: boundedString(body.imageUrl, "imageUrl", MAX_IMAGE_URL_CHARS)
  };
}

function normalizeRateKey(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 80 || /[^a-zA-Z0-9:._-]/.test(text)) return "global";
  return text;
}

export function rateLimitKeyFromRequest(_request) {
  // No auth/session boundary yet. A global bucket is stricter than trusting spoofable IP headers.
  return "global";
}

function pruneRateBuckets(windowStart) {
  for (const [key, entries] of rateBuckets.entries()) {
    const active = entries.filter(item => item > windowStart);
    if (active.length) rateBuckets.set(key, active);
    else rateBuckets.delete(key);
  }
  if (rateBuckets.size <= MAX_RATE_KEYS) return;
  for (const key of rateBuckets.keys()) {
    if (rateBuckets.size <= MAX_RATE_KEYS) break;
    rateBuckets.delete(key);
  }
}

export function assertAiRouteRateLimit(key, now = Date.now()) {
  const windowStart = now - 60_000;
  pruneRateBuckets(windowStart);
  const safeKey = normalizeRateKey(key);
  const current = (rateBuckets.get(safeKey) || []).filter(item => item > windowStart);
  if (current.length >= MAX_REQUESTS_PER_MINUTE) {
    rateBuckets.set(safeKey, current);
    throw new AiRouteInputError("AI 请求过于频繁，请稍后再试。", 429);
  }
  current.push(now);
  rateBuckets.set(safeKey, current);
}

export async function readBoundedJsonBody(request, maxBytes = MAX_REQUEST_BYTES) {
  const declaredLength = Number(request?.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new AiRouteInputError("请求体超出大小限制", 413);
  if (!request?.body?.getReader) {
    try {
      return JSON.parse(await request.text());
    } catch {
      throw new AiRouteInputError("请求 JSON 无效");
    }
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new AiRouteInputError("请求体超出大小限制", 413);
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new AiRouteInputError("请求 JSON 无效");
  }
}

export function publicAiRouteError(error) {
  if (error instanceof AiRouteInputError) return error.message;
  if (error?.name === "AbortError") return "AI 请求已取消。";
  return AI_ROUTE_PUBLIC_ERROR;
}
