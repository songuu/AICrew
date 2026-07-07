// 小红书「一键带稿」交接（Tier 0）的纯逻辑层。
//
// 背景：小鸡AI App 的「一键发布」底层是官方分享交接（分享 SDK + URL Scheme 深链）——
// 唤起小红书官方发布器、由用户手动确认发布，并非自动操作账号。Web 有对等能力
// （Web Share / Clipboard / URL Scheme / Blob 下载），本模块只负责可测的纯逻辑：
// 把内容产物拼成发布页可直接粘贴的结构化文案、判定平台适用性、提供发布器深链常量。
// 浏览器副作用（navigator.share / navigator.clipboard / 深链跳转）由组件层处理。
//
// 边界：交接终点永远是「用户在小红书官方发布器手动确认」，不做任何自动发布/评论/点赞。

// 小红书官方 Deeplink 文档中，发布页归在 Capa/发布：xhsdiscover://post。
// source.type 支持 personal（个人页面来源），这比旧的 post_note 更贴近「个人中心发布入口」。
export const REDNOTE_PUBLISH_BASE_DEEPLINK = "xhsdiscover://post";
export const REDNOTE_PROFILE_DEEPLINK = "xhsdiscover://me/profile";
export const REDNOTE_HOME_DEEPLINK = "xhsdiscover://home";

const REDNOTE_PUBLISH_SOURCE_TYPES = new Set(["pages", "order", "activity", "home", "personal"]);
const DEFAULT_PUBLISH_SOURCE_TYPE = "personal";

function normalizePublishSourceType(sourceType) {
  return REDNOTE_PUBLISH_SOURCE_TYPES.has(sourceType) ? sourceType : DEFAULT_PUBLISH_SOURCE_TYPE;
}

// 构造官方发布器深链。深链本身不承载正文；正文仍通过 Web Share 或 Clipboard 交接。
// 这里携带 source.type=personal，让小红书从个人入口语义进入发布器。
export function buildRednotePublishDeeplink(options = {}) {
  const sourceType = normalizePublishSourceType(options.sourceType);
  const params = new URLSearchParams();
  const source = {
    type: sourceType,
    ids: String(options.sourceIds || ""),
    extraInfo: {
      from: "aicrew",
      handoff: "clipboard",
      ...(options.extraInfo && typeof options.extraInfo === "object" ? options.extraInfo : {})
    }
  };
  params.set("source", JSON.stringify(source));
  if (typeof options.ignoreDraft === "boolean") {
    params.set("ignore_draft", options.ignoreDraft ? "true" : "false");
  }
  return `${REDNOTE_PUBLISH_BASE_DEEPLINK}?${params.toString()}`;
}

// 默认路径：个人入口发布器。移动端已安装小红书时唤起；桌面/未安装时由组件兜底。
export const REDNOTE_PUBLISH_DEEPLINK = buildRednotePublishDeeplink();

// 桌面 Chrome/Edge 没有注册 xhsdiscover 协议时会在 Console 报
// "scheme does not have a registered handler"。只在移动端/触屏 iPadOS 尝试 App scheme。
export function canLaunchRednoteDeeplink(env = {}) {
  const userAgent = String(env.userAgent || "");
  const platform = String(env.platform || "");
  const maxTouchPoints = Number(env.maxTouchPoints || 0);
  if (/Android|iPhone|iPod|iPad|HarmonyOS|OpenHarmony|Mobile/i.test(userAgent)) return true;
  if (platform === "MacIntel" && maxTouchPoints > 1) return true;
  return false;
}

// 发布三步引导。无 app key/secret（官方分享 SDK 不可用）时的替代路径：
// 「一键带稿」把文案放进剪贴板/系统分享并唤起官方发布器，落地后由用户按此三步手动完成。
// 这是凭证受限下最接近「预填」的合规做法（不自动操作账号）。
export const REDNOTE_PUBLISH_STEPS = [
  "文案已复制（或已带图唤起系统分享）",
  "在小红书选择图片（或使用下载的图片包）",
  "长按粘贴文案，确认发布"
];

// 仅小红书平台的产物提供小红书交接，避免在抖音/视频号等产物上误显示。
export function supportsRednoteHandoff(platform) {
  return platform === "小红书";
}

// 规范化话题标签：去空白、过滤空值、缺失 # 前缀时补上（小红书话题需 #）；已带 # 的不双重前缀。
function normalizeHashtags(hashtags) {
  return (Array.isArray(hashtags) ? hashtags : [])
    .map(tag => String(tag == null ? "" : tag).trim())
    .filter(Boolean)
    .map(tag => (tag.startsWith("#") ? tag : `#${tag}`));
}

// 把一个变体拼成发布页可直接粘贴的结构化文案。
// 入参 variant: { caption, hashtags } ；返回 { caption, hashtags, text }。
// text = 正文 + 空行 + 话题标签（任一缺失则自动省略，不留空行）。
export function buildRednoteShareText(variant = {}) {
  const caption = String(variant && variant.caption != null ? variant.caption : "").trim();
  const hashtags = normalizeHashtags(variant && variant.hashtags);
  const text = [caption, hashtags.join(" ")].filter(Boolean).join("\n\n");
  return { caption, hashtags, text };
}

function safeString(value, fallback = "") {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

function nullableString(value) {
  const text = safeString(value);
  return text || null;
}

function imageFileNames(imageFiles) {
  return (Array.isArray(imageFiles) ? imageFiles : [])
    .map(file => safeString(file?.name || file?.fileName || file?.id))
    .filter(Boolean);
}

// 小红书交接事件只保存可追踪的轻量元数据：文案、标签、文件名、上下文 id。
// 图片 dataUrl / Blob 不进事件表，避免主状态与 Supabase 行被大二进制撑爆。
export function buildRednoteHandoffRecord(options = {}) {
  const task = options.task && typeof options.task === "object" ? options.task : {};
  const exportItem = options.exportItem && typeof options.exportItem === "object" ? options.exportItem : {};
  const variant = options.variant && typeof options.variant === "object" ? options.variant : {};
  const share = options.share && typeof options.share === "object" ? options.share : buildRednoteShareText(variant);
  const names = imageFileNames(options.imageFiles);
  const taskBrief = task.brief && typeof task.brief === "object" ? task.brief : {};

  return {
    id: safeString(options.id, `rednote_handoff_${Date.now().toString(36)}`),
    platform: "小红书",
    action: safeString(options.action, "unknown"),
    status: safeString(options.status, "unknown"),
    message: safeString(options.message),
    createdAt: safeString(options.createdAt, new Date().toISOString()),
    taskId: nullableString(options.taskId || task.id),
    projectId: nullableString(options.projectId || exportItem.projectId || task.projectId),
    exportId: nullableString(options.exportId || exportItem.id),
    exportName: safeString(options.exportName || exportItem.name),
    variantId: nullableString(options.variantId || exportItem.variantId || variant.id),
    productName: safeString(options.productName || taskBrief.productName),
    scheduledAt: nullableString(options.scheduledAt || task.scheduledAt),
    caption: safeString(share.caption),
    hashtags: Array.isArray(share.hashtags) ? share.hashtags : [],
    shareText: safeString(share.text),
    imageFileNames: names,
    imageCount: names.length
  };
}

export function appendRednoteHandoffRecord(state, record, limit = 120) {
  if (!state || typeof state !== "object" || !record) return state;
  const existing = Array.isArray(state.rednoteHandoffs) ? state.rednoteHandoffs : [];
  const next = [record, ...existing.filter(item => item?.id !== record.id)].slice(0, limit);
  return { ...state, rednoteHandoffs: next };
}
