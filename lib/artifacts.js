const DATA_URL_PREFIX = "data:";
const MAX_ERROR_LENGTH = 240;

export const ARTIFACT_STATUS = Object.freeze({
  ready: "ready",
  failed: "failed",
  deferred: "deferred"
});

export const ARTIFACT_TYPES = Object.freeze(["image", "video", "text", "document"]);

export function variantImageRefKey(variantId) {
  return `variant:${String(variantId || "unknown")}`;
}

function cleanToken(value) {
  return String(value || "artifact")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artifact";
}

export function artifactId({ scopeId, type, source, name } = {}) {
  return [cleanToken(scopeId), cleanToken(type), cleanToken(source || name || "generated")].join(":");
}

export function sanitizeArtifactError(error) {
  const raw = error instanceof Error ? error.message : String(error || "未知错误");
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(Bearer|Token|Api-Key|X-Api-Key)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/([?&](api[_-]?key|token|access_token|secret)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/(sk-[A-Za-z0-9]{12,})/g, "[api-key]")
    .slice(0, MAX_ERROR_LENGTH);
}

function assertKnownType(type) {
  if (!ARTIFACT_TYPES.includes(type)) {
    throw new Error(`不支持的 artifact type: ${type}`);
  }
}

function baseArtifact(input = {}, status) {
  const type = input.type || "document";
  assertKnownType(type);
  const id = input.id || artifactId({ scopeId: input.scopeId || input.variantId || input.taskId, type, source: input.source || input.name });
  return {
    id,
    type,
    status,
    name: input.name || `${type}.${type === "image" ? "png" : type === "video" ? "mp4" : "txt"}`,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.refKey ? { refKey: input.refKey } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.providerJobId ? { providerJobId: input.providerJobId } : {}),
    ...(Number.isFinite(input.bytes) ? { bytes: input.bytes } : {}),
    ...(input.variantId ? { variantId: input.variantId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.content ? { content: input.content } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {})
  };
}

export function createReadyArtifact(input = {}) {
  const artifact = baseArtifact(input, ARTIFACT_STATUS.ready);
  const hasPayload = Boolean(artifact.url || artifact.refKey || artifact.content);
  if (!hasPayload) throw new Error(`ready artifact 缺少可交付载荷: ${artifact.id}`);
  return artifact;
}

export function createFailedArtifact(input = {}) {
  return {
    ...baseArtifact(input, ARTIFACT_STATUS.failed),
    error: sanitizeArtifactError(input.error)
  };
}

export function createDeferredArtifact(input = {}) {
  return {
    ...baseArtifact(input, ARTIFACT_STATUS.deferred),
    reason: sanitizeArtifactError(input.reason || input.error || "暂未生成")
  };
}

export function isDataUrl(value) {
  return typeof value === "string" && value.startsWith(DATA_URL_PREFIX);
}

export function stripArtifactForStorage(artifact) {
  if (!artifact || typeof artifact !== "object") return artifact;
  const next = { ...artifact };
  if (next.type === "image" && isDataUrl(next.url)) delete next.url;
  return next;
}

export function stripArtifactsForStorage(artifacts) {
  return Array.isArray(artifacts) ? artifacts.map(stripArtifactForStorage) : artifacts;
}

export function upsertArtifact(artifacts, artifact) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  return [...list.filter(item => item?.id !== artifact.id), artifact];
}

export function isDownloadableArtifact(artifact) {
  if (!artifact || artifact.status !== ARTIFACT_STATUS.ready) return false;
  if (artifact.type === "text" || artifact.type === "document") return typeof artifact.content === "string";
  if (artifact.type === "image" || artifact.type === "video") return Boolean(artifact.url || artifact.refKey);
  return false;
}