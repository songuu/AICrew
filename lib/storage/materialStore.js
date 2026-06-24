// 素材上传的纯校验 / 归一层（无 DOM、无 FileReader 依赖，可在 node --test 完整验证）。
//
// 设计纪律：文件读取（FileReader → dataURL）留在组件，纯逻辑（MIME 白名单 / 体量上限 /
// 文件名清洗 / 归一）下沉这里。素材随 brief.materials 流经全链路，故形状必须稳定可测。
//
// 不信任外部输入：上传文件名、MIME、体量一律在边界校验，失败给明确原因，绝不静默吞。

// 仅接受图片素材（本期素材作为视觉参考注入 image prompt）。视频/音频属未来能力域。
export const ALLOWED_MATERIAL_PREFIX = "image/";
export const MAX_MATERIAL_BYTES = 8 * 1024 * 1024; // 8MB，对齐画布导入上限
export const MAX_LIBRARY_ASSET_BYTES = 10 * 1024 * 1024;

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/markdown",
  "text/plain"
]);

const DOCUMENT_EXTENSIONS = new Set(["csv", "doc", "docx", "json", "md", "pdf", "ppt", "pptx", "txt", "xls", "xlsx"]);

// 剔除控制字符：用 codePointAt 逐字过滤，绝不写字面量控制字符正则
// （见记忆 tooling-write-controlchar-regex：Write 落盘会把转义规整成不可见字节而损坏）。
export function sanitizeMaterialName(value) {
  let out = "";
  for (const ch of String(value ?? "").replace(/[\r\n\t]+/g, " ")) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) out += ch;
  }
  const trimmed = out.trim();
  return trimmed || "uploaded-material";
}

/**
 * 校验单个待上传素材的元信息。返回 { ok, reason }。
 * @param {{name?:string, type?:string, size?:number}} file
 */
export function validateMaterial(file = {}) {
  const type = String(file.type || "");
  if (!type.startsWith(ALLOWED_MATERIAL_PREFIX)) {
    return { ok: false, reason: `仅支持图片素材，收到：${type || "未知类型"}` };
  }
  const size = Number(file.size);
  if (Number.isFinite(size) && size > MAX_MATERIAL_BYTES) {
    return { ok: false, reason: `素材超过 ${Math.round(MAX_MATERIAL_BYTES / 1024 / 1024)}MB 上限` };
  }
  return { ok: true, reason: "" };
}

function extensionOf(name) {
  const parts = sanitizeMaterialName(name).split(".");
  return parts.length > 1 ? parts.at(-1).toLowerCase() : "";
}

export function classifyLibraryAsset(input = {}) {
  const type = String(input.type || "");
  if (type.startsWith("image/")) return "image";
  if (DOCUMENT_MIME_TYPES.has(type)) return "document";
  if (!type && DOCUMENT_EXTENSIONS.has(extensionOf(input.name))) return "document";
  return "file";
}

export function validateLibraryAsset(file = {}) {
  const size = Number(file.size);
  if (Number.isFinite(size) && size > MAX_LIBRARY_ASSET_BYTES) {
    return { ok: false, reason: `素材超过 ${Math.round(MAX_LIBRARY_ASSET_BYTES / 1024 / 1024)}MB 上限` };
  }
  const type = String(file.type || "");
  const ext = extensionOf(file.name);
  if (type.startsWith("image/") || DOCUMENT_MIME_TYPES.has(type) || (!type && DOCUMENT_EXTENSIONS.has(ext))) {
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: `暂不支持该文件类型：${type || ext || "未知类型"}` };
}

export function formatAssetSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function normalizeLibraryAsset(input = {}) {
  const type = String(input.type || "application/octet-stream");
  const kind = classifyLibraryAsset({ ...input, type });
  const source = input.source || "upload";
  const tags = Array.isArray(input.tags) && input.tags.length ? input.tags : [source, kind];
  return {
    type: kind,
    name: sanitizeMaterialName(input.name),
    source,
    tags,
    size: input.sizeLabel || formatAssetSize(input.size),
    mimeType: type,
    ref: typeof input.ref === "string" ? input.ref : "",
    createdAt: input.createdAt
  };
}

/**
 * 把一条已读出的素材归一成 brief.materials 元素：{ name, type, ref }。
 * ref 为 dataURL 或 https 远程地址；缺失则置空字符串（仍保留 name 作引用提示）。
 */
export function normalizeMaterial(input = {}) {
  return {
    name: sanitizeMaterialName(input.name),
    type: String(input.type || "image/*"),
    ref: typeof input.ref === "string" ? input.ref : ""
  };
}

/**
 * 归一素材列表：非数组→空数组；逐项归一。用于把组件读出的上传集合收敛成稳定形状。
 */
export function normalizeMaterials(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeMaterial);
}

/**
 * 取素材的引用名列表（供 prompt / 导出引用，去空去重）。
 */
export function materialNames(materials) {
  if (!Array.isArray(materials)) return [];
  const seen = new Set();
  for (const item of materials) {
    const name = sanitizeMaterialName(item?.name);
    if (name) seen.add(name);
  }
  return [...seen];
}
