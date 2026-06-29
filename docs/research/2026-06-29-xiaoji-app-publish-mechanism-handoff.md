---
title: "小鸡AI App 端发布机制底层原理 × AICrew Web 可直接运用的合规交接"
type: research
status: done
created: "2026-06-29"
updated: "2026-06-29"
tags: [research, 小鸡AI, App, 小红书, 发布, URL-scheme, 分享SDK, WebShare, 深链, 合规交接]
related:
  - "2026-06-29-xiaoji-rednote-full-ecosystem-integration"
sources:
  - "https://zichuanwenhua.top/ （小鸡AI App，iOS/Android/HarmonyOS）"
  - "https://agora.xiaohongshu.com/ （小红书分享开放平台，Android/iOS/HarmonyOS/JS）"
  - "https://pages.xiaohongshu.com/activity/deeplink （小红书 DeepLink 官方）"
  - "https://blog.csdn.net/weixin_48141487/article/details/148844320 （小红书 URL Scheme 最全指南）"
  - "https://blog.csdn.net/qq_53226045/article/details/144554833 （vue 接入小红书分享 JS SDK + node 生成 signature）"
  - "https://www.imgeek.net/article/825369475 （小红书一键发布系统：后端签名 + 前端跳转）"
---

# 小鸡AI App 端发布机制底层原理 × AICrew Web 合规交接

> 任务：小鸡AI 只有 App 端，研究它「如何运行和操作」小红书发布生态的底层原理，把可用的直接运用进 AICrew。

## 0. 一句话结论

小鸡AI App「一键发布到小红书」的底层 **不是 App 自动替你操作小红书**，而是 **调用小红书官方分享交接 + 系统能力**：① 官方分享开放平台 SDK（含 **JS 版**）一键分享 → 小红书发布器**内容预填** → **用户手动确认发布**；② URL Scheme 深链 `xhsdiscover://post_note/` 唤起发布器。真正的「机器批量发布/自动评论点赞」是另一条产品线（桌面矩阵系统 + 指纹浏览器 + 无障碍 RPA），App 端不走这条。**前两条 Web 都有对等能力，AICrew 静态站可直接运用——且天然合规（用户手动确认）。**

## 1. 厘清两条产品线（别把 App 和桌面矩阵混为一谈）

| 产品线 | 形态 | 「发布」机制 | 性质 |
|--------|------|--------------|------|
| **小鸡AI App** | iOS/Android/HarmonyOS 移动应用 | 官方分享 SDK + URL Scheme 深链，唤起小红书发布器、用户确认 | 🟢 合规交接 |
| **小鸡AI 桌面矩阵系统** | 桌面客户端 + 指纹浏览器 | 模拟操作/无障碍/自动化脚本，批量定时发布、自动评论点赞 | 🔴 RPA（红线） |

> 用户看到 App「一键发布」很丝滑，误以为是自动化；底层其实是 **官方分享开放平台**。这正是可安全借鉴的部分。

## 2. App 端发布的三条底层路径

### 路径 A：小红书官方分享开放平台 SDK（小鸡AI App 主用）
- 地址 `agora.xiaohongshu.com`，提供 **Android / iOS / HarmonyOS / JS** 四端 SDK。
- 能力：第三方 App/网页一键把**图文/视频**分享到小红书，**跳转到发布页时内容已预填**，免手动复制粘贴。
- 机制：**后端用 app secret 生成 signature → 前端发起跳转**（`xhs.share`）。需在小红书开放平台注册应用拿 app key/secret。
- 边界：分享=交接到发布器，**最终由用户在小红书内点发布**（非自动）。

### 路径 B：URL Scheme 深链（零 SDK，轻量）
- 基础 scheme：`xhsdiscover://`。发布相关：
  - `xhsdiscover://post` / `xhsdiscover://post_note/` → 图文笔记创作页（相册选图 + 文字编辑）
  - `xhsdiscover://post_video/` / `post_video_album/` → 视频发布页
- 唤起方式：Android `Intent ACTION_VIEW`；iOS `UIApplication.open`；**Web 直接 `location.href = "xhsdiscover://..."` 或 `<a href>`**（小红书已安装时唤起）。
- 边界：scheme 预填能力有限（主要唤起发布器/选图），文字常需配合**剪贴板**交接。

### 路径 C：无障碍/RPA 自动化（❌ App 端不用，桌面矩阵才用）
- 模拟点击、自动批量发布、自动评论点赞、机器养号——指纹浏览器对抗风控。
- 踩小红书 2025 红线，AICrew **不做**。

## 3. 关键洞察：Web 有 App 同款「系统能力」对等物

App 之所以能丝滑交接，靠的是三类系统能力——浏览器全有对等 API：

| App 能力 | Web 对等 API | 在 AICrew 的用法 |
|----------|--------------|------------------|
| 系统分享面板 | **Web Share API** `navigator.share({files,text,title})` | 移动端把图片包 + 文案一键分享到小红书发布器 |
| 剪贴板 | **Clipboard API** `navigator.clipboard.writeText` | 一键复制结构化「标题/正文/话题」，发布页粘贴 |
| 深链唤起 App | **URL Scheme** `xhsdiscover://post_note/` | 按钮唤起小红书发布器（移动端，已装小红书） |
| 本地文件 | Blob 下载（**AICrew 已有** `downloadImageFile`/`downloadTextFile`） | 下载封面/图片包供发布页选图 |

> AICrew 已有导出中心（Exports）+ Blob 下载基建；补齐「分享/复制/深链」即得 App 同款交接，零自动化。

## 4. AICrew 可直接运用方案（分层）

### Tier 0 — 一键带稿到小红书（零外部依赖，可立即建）
在导出中心/任务产物上加「带到小红书发布」交接：
1. **复制文案**：一键复制结构化 标题+正文+话题标签（`navigator.clipboard`）。
2. **Web Share**：移动端 `navigator.share({files: 图片blob[], text, title})` → 系统面板选小红书。
3. **深链唤起**：按钮 `xhsdiscover://post_note/`（移动端已装小红书时打开发布器）。
4. **图片包下载**：复用既有 `downloadImageFile`（封面/多图）。
5. **桌面兜底**：复制 + 下载 + 一步步引导文案（桌面无 App 深链/Web Share 时）。
- **合规**：全程用户手动确认发布，无任何自动操作。零新增凭证、零后端。
- **接入缝**：`components/AICrewStudio.jsx` 已有 Blob 下载工具 + Exports 视图；纯前端增量。

### Tier 1 — 官方分享 JS SDK 真预填（需凭证 + 服务端签名）
- 接小红书官方 **分享 JS SDK（`xhs.share`）**，跳转发布页**内容自动预填**（体验最接近小鸡AI App）。
- 依赖：① 小红书开放平台注册应用拿 **app key/secret**；② 服务端签名端点（AICrew 已有 `/api/*` 服务端路由，可加 `/api/xhs-share-sign`，secret 走 server env 不入客户端）；③ 域名/回调白名单审核。
- 阻塞点：需用户去小红书开放平台**申请并提供凭证**——非我能自助完成。

## 5. 边界（红线不变）

仍**不做**：自动批量/定时发布、自动评论/点赞/关注、机器养号、爬虫采集、自动私信。AICrew 的「发布」永远是**把稿子交接到官方发布器、由人确认**，不是替人操作账号。

## 6. 决策（见会话 gate）

- Tier 0 可立即建（推荐，零依赖、合规、补齐内容→发布最后一公里）。
- Tier 1 需用户提供小红书开放平台凭证后再排期。
