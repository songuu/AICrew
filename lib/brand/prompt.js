// 把 brandKit 渲染为受控的 prompt 片段。集中注入逻辑（避免散落在 buildCopyPrompt/buildImagePrompt），
// 并对外部可编辑文本（voice / forbiddenWords / aesthetic）做基本清洗，防止换行/控制字符造成的 prompt 注入。
// 设计依据：docs/plans/2026-06-23-make-it-real-no-video.md（P4-T2）。

// 折叠空白并剔除控制字符（用 char code 过滤，避免在正则里写控制字面量）。
function sanitize(value, maxLen) {
  const collapsed = String(value ?? "").replace(/[\r\n\t]+/g, " ");
  let out = "";
  for (const ch of collapsed) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.trim().slice(0, maxLen);
}

function cleanForbidden(brandKit) {
  const list = Array.isArray(brandKit?.forbiddenWords) ? brandKit.forbiddenWords : [];
  return list.map(word => sanitize(word, 40)).filter(Boolean);
}

// 文案 prompt 用：多行品牌片段（品牌 / 声音 / 审美偏好 / 禁用词）。
export function renderBrandClause(brandKit) {
  const kit = brandKit || {};
  const name = sanitize(kit.name, 60) || "品牌";
  const voice = sanitize(kit.voice, 80);
  const aesthetic = sanitize(kit.aesthetic, 120);
  const forbidden = cleanForbidden(kit);
  const lines = [`品牌：${name}${voice ? `（品牌声音：${voice}）` : ""}`];
  if (aesthetic) lines.push(`审美偏好：${aesthetic}`);
  lines.push(`禁用词（绝不出现）：${forbidden.length ? forbidden.join("、") : "无"}`);
  return lines.join("\n");
}

// 图像 prompt 用：单行品牌调性提示（声音 + 审美）。
export function renderBrandImageHint(brandKit) {
  const kit = brandKit || {};
  const voice = sanitize(kit.voice, 60);
  const aesthetic = sanitize(kit.aesthetic, 80);
  const parts = [];
  if (voice) parts.push(`品牌调性：${voice}`);
  if (aesthetic) parts.push(`审美：${aesthetic}`);
  return parts.join("；");
}
