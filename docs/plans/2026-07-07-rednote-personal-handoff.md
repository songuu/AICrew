---
title: "小红书个人入口带稿交接复核"
type: sprint
status: completed
created: "2026-07-07"
updated: "2026-07-07"
tags: [sprint, rednote, 小红书, 小鸡AI, deeplink, WebShare, clipboard, personal-entry, handoff]
related:
  - "2026-06-29-rednote-publish-handoff-tier0"
  - "2026-06-29-xiaoji-app-publish-mechanism-handoff"
invariants:
  - "交接=唤起官方发布器/分享面板，用户手动确认发布；零自动操作账号"
  - "深链只做跳转与来源标记；正文通过 Web Share 或 Clipboard 带入"
  - "逻辑层 lib/share/rednote.js 纯函数可测；浏览器副作用留 components/AICrewStudio.jsx"
invariant_tests:
  - tests/share-rednote.test.js
---

# 小红书个人入口带稿交接复核

## Phase 1: Think

### Scope
- 重新复核小鸡 AI App「一键发布」原理：官方分享交接 + URL Scheme，不做 RPA/自动化。
- 小红书默认发布深链从旧 `post_note` 收敛到官方 `xhsdiscover://post`。
- 发布深链携带 `source.type=personal`，贴近「个人页面入口」语义。
- 内容带入保持双路径：Web Share 直接带 text/files；失败时 Clipboard 复制正文，再跳转发布器。桌面 Chrome/Edge 若未注册 `xhsdiscover://`，不得发起 scheme 跳转，避免 Console 报 no registered handler。

### Non-Scope
- 不做服务端代发布、批量定时无人发布、自动评论/点赞/私信。
- 不申请小红书开放平台 app key/secret；Tier1 真预填仍等凭证。
- 不伪造用户 id，不使用未验证的 `user/me` 个人主页深链当默认入口。

### Success
- `lib/share/rednote.js` 可构造官方 `xhsdiscover://post?source=...`，默认 source 为 `personal`。
- UI 的主发布路径复制文案后跳转个人入口发布器。
- 回归测试覆盖深链、source JSON、旧 `post_note` 不再默认、文案拼装和平台门控。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|--------|---------------------|--------------------|
| 发布交接 | 只唤起官方发布器/分享面板，用户手动确认 | 继续 Web Share / Clipboard / Deeplink，不写自动发布逻辑 |
| 纯逻辑/副作用分离 | `lib/share/rednote.js` 纯函数，组件层做浏览器副作用 | 新增 `buildRednotePublishDeeplink()`，`window.location` 仍留组件 |
| 渐进增强 | Web Share/Clipboard/深链失败时兜底 | 主路径仍按 Web Share -> Clipboard+Deeplink -> 手动提示降级 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 结果 |
|--------|----------|--------|------|
| 一键带稿去发布 | 点主按钮 | Web Share 带 text/files；否则移动端 Clipboard + `REDNOTE_PUBLISH_DEEPLINK`，桌面只复制提示 | 到小红书官方发布器，用户确认发布；桌面不报 scheme handler 错误 |
| 个人入口发布 | 点按钮 | 移动端 Clipboard + `xhsdiscover://post?source=...`；桌面复制提示 | 从 personal source 语义进入发布器；桌面不触发未注册协议 |
| 个人资料入口 | 点按钮 | Clipboard + `xhsdiscover://me/profile` | 可打开官方个人资料页，内容仍在剪贴板 |
| 纯函数测试 | `node tests/share-rednote.test.js` | URLSearchParams + JSON decode | 深链和 payload 可回归 |

### 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|-------------|------|----------------|----------|
| 2026-06-29 Tier0 | `post_note` 旧路径仍是默认 | 本 sprint 改为官方 `post` + `source.type=personal` | 2026-07-07 |
| 2026-06-29 Tier1 | 官方 SDK 真预填需凭证 | 继续推迟；无 app key/secret 不实现服务端签名 | 等凭证 |

### 研究复核

- 小红书官方 Deeplink 页：Capa/发布路径是 `xhsdiscover://post`，`source` 参数为 JSON，`source.type` 支持 `personal`。
- 同页用户资料入口为 `xhsdiscover://me/profile`；未看到可无需 user id 打开“我的主页”的稳定官方新路径。
- MDN Web Share：浏览器可在用户手势中分享 text/files 到用户选择的目标。
- MDN Clipboard：`navigator.clipboard.writeText` 可把正文写入系统剪贴板，作为深链无法直接承载正文时的合规兜底。

## Phase 3: Work

| # | Task | 风险 | 验证 |
|---|------|------|------|
| 1 | ✅ 更新 `lib/share/rednote.js` 深链模型 | L2 | `tests/share-rednote.test.js` |
| 2 | ✅ 更新 `components/AICrewStudio.jsx` UI 跳转 | L2 | build + 代码审查 |
| 3 | ✅ 更新研究/计划文档，避免旧路径回归 | L1 | 文档 grep |
| 4 | ✅ 全量回归测试和构建 | L2 | `npm test` + `npm run build` |

## Phase 4: Review

### 审查结果

| 视角 | 结果 | 证据 |
|------|------|------|
| 架构 | 通过 | 深链构造留在 `lib/share/rednote.js`，浏览器副作用留在 `components/AICrewStudio.jsx` |
| 安全/合规 | 通过 | 无自动发布、无账号操作、无 app secret；终点仍是用户在小红书确认发布 |
| 代码质量 | 通过 | `buildRednotePublishDeeplink()` 可测，未知 sourceType fail-closed 到 `personal` |
| 测试覆盖 | 通过 | `tests/share-rednote.test.js` 覆盖官方 `post`、personal source、fallback、旧 `post_note` 不默认 |
| 集成连续性 | 通过 | 旧 Tier0 文档与完整架构研究同步，避免后续 sprint 回归旧路径 |

### 验证

- `node tests\share-rednote.test.js`：10 pass。
- `npm test`：343 tests，341 pass，2 skip（`SUPABASE_DB_URL` 未配置），0 fail。
- `npm run build`：Next.js 16.2.9 production build pass。
- `git diff --check`：pass（仅 Git CRLF warning）。
- 2026-07-07 follow-up：新增桌面协议门控，Windows/Mac/Linux 桌面不再执行 `xhsdiscover://` 跳转，避免 Chrome `scheme does not have a registered handler`。
- Runtime smoke：`REDNOTE_PUBLISH_DEEPLINK` base = `xhsdiscover://post`，source.type = `personal`，extraInfo.from = `aicrew`。

## Phase 5: Compound

### 复利记录

- 经验：小红书发布默认应走官方 Capa `xhsdiscover://post`；`post_note` 只能作为旧兼容信息，不能继续做默认实现。
- 经验：无小红书开放平台凭证时，正文无法靠纯 deeplink 真预填；合规天花板仍是 Web Share 带 text/files，失败则 Clipboard + Deeplink。
- 经验：用户说“不是自动化、通过跳转带入”时，验收核心是“人在环 + 内容交接 + 官方入口”，不是服务端代发。
