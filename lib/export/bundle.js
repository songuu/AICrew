// 把一条 export 记录 + 当前（可能被 AI 增强过的）variant 组装成「可下载内容包」。
// 设计依据：docs/plans/2026-06-23-make-it-real-no-video.md（P2-T3）。
// 纯函数：不发网络请求、不写盘，只产出可被前端 Blob 化或后端流式返回的结构。
// 真实图像从 live variant.imageUrl 解析（export 清单只负责命名，封面实拍/生成图绑定到 variant）。

export function assembleExportBundle(exportRecord, variant) {
  const files = Array.isArray(exportRecord?.files) ? exportRecord.files : [];

  // 文本文件：内容已在 buildExportFiles 内联，可即时下载。
  const textFiles = files
    .filter(file => file.kind === "text" && typeof file.content === "string")
    .map(file => ({ name: file.name, mimeType: file.mimeType, content: file.content }));

  // 图像文件：仅当 variant 实际持有 imageUrl 时才可下载；data URL 与 https 引用分治。
  const imageUrl = variant?.imageUrl;
  const imageFiles = imageUrl
    ? files
        .filter(file => file.kind === "image")
        .map(file =>
          typeof imageUrl === "string" && imageUrl.startsWith("data:")
            ? { name: file.name, mimeType: file.mimeType, dataUrl: imageUrl }
            : { name: file.name, mimeType: file.mimeType, url: imageUrl }
        )
    : [];

  // 注意：kind==='placeholder'（如 video.mp4）既非 text 也非 image，自然被排除，不可下载。
  return { textFiles, imageFiles };
}
