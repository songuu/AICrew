// 把一条 export 记录 + 当前（可能被 AI 增强过的）variant 组装成「可下载内容包」。
// 纯函数：不发网络请求、不写盘，只产出可被前端 Blob 化或后端流式返回的结构。
// 新记录以 ArtifactRef.status 为真相；旧记录缺 status 时按 kind 做兼容归一。
// 可下载判定单一真相：文本/文档直接复用 lib/artifacts.js::isDownloadableArtifact，不在此重写谓词。
// 图片额外需从 live variant.imageUrl 兜底解析（rehydrate 后封面 url 不在 artifact 上），
// 故走「status=ready 闸门 + URL 解析」而非纯 artifact 谓词——纯谓词看不到 variant。
// video 受 invariant 约束恒 deferred，永不进入可下载分支。

import { ARTIFACT_STATUS, isDownloadableArtifact } from "../artifacts.js";

function legacyStatus(file) {
  if (file?.status) return file.status;
  if (file?.kind === "placeholder") return "deferred";
  if (file?.kind === "text" && typeof file.content === "string") return "ready";
  if (file?.kind === "image") return "ready";
  return "deferred";
}

function legacyType(file) {
  if (file?.type) return file.type;
  if (file?.kind === "image") return "image";
  if (file?.name?.endsWith(".mp4")) return "video";
  return "text";
}

function normalizeFile(file) {
  return { ...file, status: legacyStatus(file), type: legacyType(file) };
}

export function assembleExportBundle(exportRecord, variant) {
  const files = (Array.isArray(exportRecord?.files) ? exportRecord.files : []).map(normalizeFile);

  const textFiles = files
    .filter(file => (file.type === "text" || file.type === "document") && isDownloadableArtifact(file))
    .map(file => ({ name: file.name, mimeType: file.mimeType, content: file.content, artifactId: file.artifactId }));

  const imageFiles = files
    .filter(file => file.status === ARTIFACT_STATUS.ready && file.type === "image")
    .map(file => {
      const imageUrl = file.url || variant?.imageUrl;
      if (!imageUrl) return null;
      return typeof imageUrl === "string" && imageUrl.startsWith("data:")
        ? { name: file.name, mimeType: file.mimeType, dataUrl: imageUrl, artifactId: file.artifactId }
        : { name: file.name, mimeType: file.mimeType, url: imageUrl, artifactId: file.artifactId };
    })
    .filter(Boolean);

  const failedFiles = files
    .filter(file => file.status === ARTIFACT_STATUS.failed)
    .map(file => ({ name: file.name, mimeType: file.mimeType, error: file.error || "生成失败", artifactId: file.artifactId }));

  const deferredFiles = files
    .filter(file => file.status === ARTIFACT_STATUS.deferred)
    .map(file => ({ name: file.name, mimeType: file.mimeType, reason: file.reason || "暂未支持", artifactId: file.artifactId }));

  return { textFiles, imageFiles, failedFiles, deferredFiles };
}
