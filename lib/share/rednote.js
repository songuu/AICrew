// 小红书「一键带稿」交接（Tier 0）的纯逻辑层。
//
// 背景：小鸡AI App 的「一键发布」底层是官方分享交接（分享 SDK + URL Scheme 深链）——
// 唤起小红书官方发布器、由用户手动确认发布，并非自动操作账号。Web 有对等能力
// （Web Share / Clipboard / URL Scheme / Blob 下载），本模块只负责可测的纯逻辑：
// 把内容产物拼成发布页可直接粘贴的结构化文案、判定平台适用性、提供发布器深链常量。
// 浏览器副作用（navigator.share / navigator.clipboard / 深链跳转）由组件层处理。
//
// 边界：交接终点永远是「用户在小红书官方发布器手动确认」，不做任何自动发布/评论/点赞。

// 小红书图文笔记发布器深链。移动端已安装小红书时唤起发布器；桌面或未安装时失效，
// 组件层需配合「复制文案 + 下载图片」兜底。
export const REDNOTE_PUBLISH_DEEPLINK = "xhsdiscover://post_note/";

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
