---
title: "小红书一键带稿交接 Tier 0（Web Share / Clipboard / 深链，对标小鸡AI App 发布原理）"
type: plan
status: completed
created: "2026-06-29"
updated: "2026-07-07"
tags: [plan, rednote, 发布, 交接, WebShare, clipboard, 深链, tier0, 合规]
related: ["2026-06-29-xiaoji-app-publish-mechanism-handoff"]
invariants:
  - "交接=唤起官方发布器/分享面板，用户手动确认发布；零自动操作账号（不踩 RPA 红线）"
  - "纯前端增量：domain 零改动；逻辑层 lib/share/rednote.js 纯函数可测，副作用留组件"
  - "渐进增强：Web Share/Clipboard/深链不支持时逐级兜底到复制+下载，不报错阻断"
invariant_tests:
  - tests/share-rednote.test.js
---

# 小红书一键带稿交接 Tier 0

> 研究（`2026-06-29-xiaoji-app-publish-mechanism-handoff.md`）：小鸡AI App「一键发布」底层 = 官方分享交接（分享 SDK + `xhsdiscover://` 深链），用户手动确认。2026-07-07 复核小红书官方 Deeplink：默认发布路径改用 `xhsdiscover://post`，并带 `source.type=personal` 贴近个人入口；`post_note` 只作旧兼容信息，不再默认。Web 有对等 API（Web Share / Clipboard / URL Scheme / Blob 下载）。本 sprint 把这套合规交接运用进导出中心。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承
| 子系统 | invariant | 本 sprint 如何保持 |
|--------|-----------|--------------------|
| domain 纯逻辑 | 不被 UI 改动污染 | 新逻辑放独立 `lib/share/rednote.js`，domain 零改动 |
| Exports 渲染 | 既有下载按钮行为不变 | 仅在小红书产物卡片**追加**交接行，不改既有下载 |
| 合规红线 | 不自动操作账号 | 交接只唤起官方发布器/分享面板，用户手动确认 |

### 入场扫描 - 集成路径
| 改动点 | 触发动作 | 中间层 | 结果 |
|--------|----------|--------|------|
| 复制文案 | 点「复制文案」 | `navigator.clipboard.writeText(buildRednoteShareText)` | 发布页粘贴 |
| 分享带图 | 点「分享/带图」 | `navigator.share({files,text})`，失败逐级兜底 | 系统面板选小红书 |
| 个人入口发布 | 点「个人入口发布」 | `<a href="xhsdiscover://post?source=...">`，`source.type=personal` | 移动端唤起个人入口发布器 |
| 图片包 | 既有下载按钮 | `downloadImageFile`（复用） | 本地图片供发布页选图 |

全链路无「❌」——终点是用户在小红书官方发布器手动确认。

### 入场扫描 - 债务清单
无前序遗留。

### 改动清单
1. `lib/share/rednote.js`（新，纯函数）：`REDNOTE_PUBLISH_DEEPLINK` 常量、`buildRednotePublishDeeplink()`、`supportsRednoteHandoff(platform)`、`buildRednoteShareText(variant)→{caption,hashtags,text}`。
2. `tests/share-rednote.test.js`（新）：纯函数单测（文案拼装/话题去空/不双重 #、平台门控、深链常量）。
3. `components/AICrewStudio.jsx`：import 纯helpers；加副作用 helper（`copyShareText`/`shareToRednote`/`fileFromImage`）+ `RednoteHandoff` 子组件；在 Exports 卡片 `supportsRednoteHandoff(item.platform)` 时渲染交接行。
4. `styles/globals.css`：`.export-handoff` 系列样式。

## 任务拆解
| # | Task | 风险 | 测试 |
|---|------|------|------|
| 1 | lib/share/rednote.js 纯函数 | L2 | tests/share-rednote.test.js |
| 2 | tests/share-rednote.test.js | L2 | node --test 全绿 |
| 3 | AICrewStudio.jsx 交接 UI + 副作用 helper | L2 | build 编译 + 手动逻辑核验 |
| 4 | globals.css 样式 | L0 | 构建通过 |

## 验证策略
- `node --test`：全绿（新增纯函数单测）。
- `npm run build`：编译通过。
- 渐进增强核验：无 navigator.share/clipboard 时逐级兜底到复制+下载，不抛错。

## Tier 0.5 无凭证替代（追加：用户确认无 app key/secret，Tier 1 放弃）

官方分享 JS SDK 需 app key/secret，用户根本没有 → Tier 1 放弃，改用无凭证替代：
- `lib/share/rednote.js`：`REDNOTE_PUBLISH_STEPS` 三步引导（纯，已测）。
- `AICrewStudio.jsx`：`oneClickRednotePublish(text,imageFiles)`「一键带稿去发布」——移动端优先 Web Share 带图（文案随附）→否则复制+唤起官方 `post?source.type=personal` 发布器，落地后粘贴；`RednoteHandoff` 加主按钮 + 三步引导。
- 经验：第三方「真预填」几乎都要官方 SDK+凭证；拿不到凭证时 copy+深链/WebShare 编排+引导 即天花板。

验证：`node --test` 292 pass/0 fail（+7 share 单测）；`npm run build` 编译通过。
