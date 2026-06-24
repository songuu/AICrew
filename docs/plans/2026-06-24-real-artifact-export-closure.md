---
title: "真实图文内容包闭环"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, p0, artifacts, export, ai, roboneo]
aliases: ["real-artifact-export", "真实图文导出闭环"]
goal: "把当前 AICrew 的结构化 task、AI 文案和图片结果收敛为真实可交付的图文内容包；视频继续明确 deferred，不伪装成 ready 文件。"`ngoal_status: met`ngoal_iteration: 1
invariants:
  - "三模式必须经 Flow -> flowToSkill -> 同一执行管线，避免 auto/semi/manual 三套业务真相。"
  - "视频能力未真实接入前，MP4 只能是 deferred/placeholder，不得作为 ready/downloadable artifact。"
  - "Export 只能消费 ready artifacts；failed/deferred 必须显式显示原因。"
  - "CanvasStudio 保持运行时自包含；画布层不直接 import domain/ai。"
  - "AI 调用失败不能整单静默失败；单 variant 失败必须保留 error artifact。"
  - "ArtifactRef.status 是产物状态的唯一真相；record 级 status:'ready' 字面量必须废除，buildExports 与 buildExportRecord 两个生产者同步迁移。"
  - "ready image artifact 必须携带 imageStore refKey（variant:<id>），禁止内联 base64 data: url 进入任何持久化 state（exports/variants/artifacts）。"
invariant_tests:
  - "npm test"
  - "npm run build"
  - "npm run test:db"
related:
  - "[[2026-06-24-prd-architecture-operations-analysis]]"
  - "[[2026-06-24-surface-prepass-output]]"
  - "[[2026-06-23-manual-canvas-roboneo-parity]]"
---

# 真实图文内容包闭环

## Phase 1: Think

### 背景

当前 AICrew 已有：

- `lib/domain.js`：Agent、Skill、Brief、QA、Credits、Export 的确定性业务核心。
- `lib/flow/*`：三模式统一 Flow，并经 `flowToSkill` 回到同一执行管线。
- `lib/ai/workflow.js`：真实文案与图像增强路径，支持多 variant 出图。
- `CanvasStudio`：真实画布运行时，支持添加、导入、撤销、缩放、图层。
- `app/api/*` + `lib/db/*`：state/assets/brand/canvas/ai-selection 的 Supabase 边界与本地兜底。

但当前仍有硬缺口：

- export 仍偏文件名清单，不是严格的真实 artifact 包。
- `video.mp4` 仍是 placeholder/deferred，不能作为真实交付。
- AI 单图失败只在 `aiMeta.imageErrors` 中暴露，未形成可供导出/UI 消费的 artifact 合同。
- 文案、脚本、分镜、QA 尚未统一进入 artifact/export 模型。

### Scope

- 定义 `ArtifactRef` 合同 + 集中 helper（含 error 脱敏、确定性 id）。
- 把 variant 的图片、文案、分镜、QA 转成 artifacts（本 sprint 不做 script artifact，见决策冻结 #5）。
- export 只消费 ready artifacts：迁移 `buildExports` **和** `buildExportRecord` **和** `lib/export/bundle.js::assembleExportBundle`（真正的下载解析层）+ 折叠 `exportFilesFor`/`buildExportFiles` 平行文件名源。
- UI 区分可下载、失败、暂未支持；含 legacy 记录兼容 + 云同步信号。
- 检查 imageStore/Supabase/localStorage 持久化链路：sanitize 覆盖 artifact、rehydrate 回填 artifact、refKey 匹配。
- 保持视频 deferred，不接真实视频引擎。

### Non-scope

- 不接 Kling/Sora/任何真实视频 job。
- 不做真实支付/订单/退款。
- 不改认证/团队权限。
- 不改三模式搭图 UI。
- 不重构整个 task 状态机；下一 sprint 再做 queued/running/failed。

### Success

- 3 个 variant 均有 `image` artifact，状态为 `ready` / `failed` / `deferred` 之一（无 AI 路径为 deferred，失败带明确 reason）。
- export package 包含图片（ready 或 deferred）、文案 Markdown、分镜（video=storyboard / image=note）、QA report（task 级引用）。
- 未 ready 的文件不进入 downloadable files（按 artifact id/status 断言）。
- 视频只显示 deferred，不出现可下载 MP4。
- 持久化 state 无内联 base64；远端失败不宣称云端成功。
- `npm test`、`npm run build` 通过（迁移后净断言数不下降）。
- 有 DB 配置时 `npm run test:db` 通过；无 DB 时 graceful skip，不算远端成功声明。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|---|---|---|
| Flow | 三模式统一经 `flowToSkill` | 不在 auto/semi/manual 分支写导出逻辑，导出只看 task artifacts |
| Domain | PRD demo 闭环必须保留 | 保持 Brief -> Agent -> variants -> QA -> credits -> export |
| AI | 文案/图片失败可降级 | 单 variant 图像失败落 `failed` artifact，不拖垮整单 |
| Export | 视频未接入必须 deferred | `video/mp4` 不得 ready/downloadable |
| Storage | localStorage 与 Supabase 边界分清 | ready image artifact 走 imageStore/refKey，远端失败不冒充云端成功 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|---|---|---|---|---|
| image artifact | AI 出图成功 | `generateVariantImages` -> variant/artifact | imageStore + state/assets | 是 |
| image failed artifact | AI 出图失败 | catch error -> artifact error | task state | 是 |
| copy/script/storyboard artifacts | domain/AI 生成 task | `buildVariants` / merge AI copy | task state | 是 |
| export package | 用户查看/导出 | `buildExports` 消费 ready artifacts | export record | 是 |
| video deferred | skill 含 video/export | deferred artifact | task/export state | 是 |

### 入场扫描 - 债务清单

| 来源 | 议题 | 本 sprint 决策 | deadline |
|---|---|---|---|
| PRD §10/§19 | 真实视频导出 | 明确 deferred，不在本 sprint 做 | P2 video job skeleton |
| gap analysis | Agent 真协作 | 本 sprint 只规范产物合同，不做 DAG runner | P0-B task/agent run |
| 当前 export | 文件名清单混杂真实/占位 | 本 sprint 收口为 artifact-driven export | 本 sprint |

## Phase 2.5: 真实代码核验修正（2026-06-24 multi-agent plan review）

> 9-agent recon 把每条 task 对照真实代码核验，4 个 critic lens（架构/风险/完整性/可测性）收敛出以下修正。原计划方向正确，但 task 的 file list 系统性低估爆炸半径，且多条 Success 标准结构上无法断言。以下为开 Work 前的强制修正。

### 核验出的事实偏差（plan 假设 vs 代码真相）

| plan 假设 | 代码真相 | 影响 |
|---|---|---|
| `buildExports`(domain.js:1696) 是「只消费 ready」的落点 | 它只盖硬编码 `status:'ready'`；真正的 ready/placeholder 过滤、下载解析在 `lib/export/bundle.js::assembleExportBundle`，且 `tests/export.test.js` 测的是它 | Task 3 必须改 bundle.js，否则留 kind-based 平行真相（半下沉漂移） |
| 只有 `buildExports` 一个 export 生产者 | 还有 `buildExportRecord`(domain.js:1278，已 export，按需导出动作用) + 两个文件名源 `exportFilesFor`(1630) / `buildExportFiles` | 不同步迁移 → 两套业务真相，违反 invariant 1 |
| 删 `fileNames` 纯文件名清单即可 | `exportFileNames()`(AICrewStudio.jsx:104-107) 专门兜底 legacy `files: string[]` localStorage 形态；旧持久化记录无 status | 直接删会让旧记录灌进新三桶 UI 时空/崩，需 normalizer |
| failed image 已有载体 | `aiMeta.imageErrors` 是 `{index,error}` 按下标键、全成功时省略；`generateVariantImages` 结果不带 `variant.id`；失败 variant 原样返回无标记 | 「imageErrors 与 artifacts error 对齐」无 join key；还有第三态 `skipped:true`（maxImages 限流）plan 没提 |
| 确定性 task 即可产出 ready 封面 | `variant.imageUrl` 仅 AI 层(workflow.js:357)写入；纯 domain 路径封面永远 placeholder | Success「ready 或 failed」在无 AI 路径不可能，需第三态 deferred |
| sanitize 会挡住图片膨胀 | `sanitizeStateForStorage` 只剥 tasks/projects 的 `variant.imageUrl`，不碰 `state.exports`、不碰 artifact 数组；`state.js` 整体 `tx.json` 落库 | ready image artifact 带 base64 url 会直灌 DB payload + localStorage → 配额溢出 |

### 设计决策冻结（开 Work 前必须落定，缺一不通过 Plan）

1. **单一真相**：`ArtifactRef.status` 取代所有 record 级 `status:'ready'` 字面量。`buildExports` + `buildExportRecord` 同步迁移。
2. **图片真相归属**：`artifact.refKey` = imageStore key `variant:<variantId>`（与 `stashVariantImages` 写的同一 key）。`variant.imageUrl` 暂作 canonical 来源，`artifact.url` 为下载时惰性解析的投影，**持久化态不存内联 base64**。
3. **三态语义**：`ready`（有 url/refKey）/ `failed`（AI 试过且报错，带 error）/ `deferred`（视频未接入、无 AI、或 maxImages 限流 skipped）。失败 ≠ 未生成，必须可区分。
4. **QA 基数**：QA artifact 挂 task 级（一个），export 包按引用展示，不 per-variant 复制三份；`buildSkippedQa` 跳过态 → deferred/省略。
5. **script artifact**：今天无离散 script 数据（仅一行 agent 字符串）。要么 Task 2 补 renderer + 数据源，要么本 sprint 移出 script，二选一显式写明（默认：本 sprint 不做 script，从 Success 移出）。
6. **类型枚举**：`ArtifactRef.type` 裁到本 sprint 真产出的 `image|video|text|document`（去掉无生产者的 `audio`），并为全部 type×status 写 `isDownloadableArtifact` 真值表测试。
7. **error 脱敏**：`artifact.error`/`provider`/`providerJobId` 落库+导出+渲染前必须经脱敏 helper（剥 URL/key/header、限长、provider→展示名）。
8. **artifact.id 确定性**：id = `(variantId|taskId, type, source)` 的确定函数，跨 rebuild/reload 稳定、并发不撞，而非随机 uuid。

### 任务依赖链（硬序，不可并行）

```text
T1 (合同 + helpers + 脱敏 + id) ── greenfield，必须先 merge 且绿
   ↓
T2 (生产者给 variant 挂 ready/failed/deferred status + variant.id 入 image 结果)
   ↓
T3 (消费者读 status：buildExports + buildExportRecord + bundle.js + legacy normalizer)
   ↓
T4 (UI 三态 + legacy 记录容错 + lastSyncStatus 信号)
T5 (持久化：sanitize 覆盖 artifact + rehydrate artifact + refKey 匹配) ← 与 T4 可并行，但都依赖 T3
   ↓
T6 (验证：status-based 断言 + test:db graceful skip + 净断言数不下降)
```

> T3 在 T2 之前落地会把所有失败误判成「暂未支持」（failed 与未请求都退化成 placeholder）。建议 **T2+T3 合并为一次原子改动、单测试门**，避免不连贯中间态。

## Phase 3: Task Breakdown

### Task 1: 定义 Artifact 合同

改动文件：

- `lib/domain.js`
- `tests/export.test.js`
- 可能新增 `lib/artifacts.js`

实现：

- 定义 artifact 形状：

```ts
type ArtifactRef = {
  id: string;
  type: "image" | "video" | "text" | "document";
  status: "ready" | "failed" | "deferred";
  name: string;
  mimeType?: string;
  url?: string;
  refKey?: string;
  source?: "generated" | "upload" | "manual" | "deferred";
  provider?: string;
  providerJobId?: string;
  bytes?: number;
  variantId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  error?: string;
};
```

- 增加 helper：
  - `createReadyArtifact`
  - `createFailedArtifact`
  - `createDeferredArtifact`
  - `isDownloadableArtifact`

验收：

- `video/mp4` 无真实 URL 时只能是 `deferred`。
- failed artifact 必须带 error。
- ready artifact 必须有 `url` 或 `refKey`。

风险：L2。领域模型变化，影响 export/task 展示。

### Task 2: Variant 产物转 Artifact

改动文件：

- `lib/domain.js`
- `lib/ai/workflow.js`
- `tests/ai.test.js`
- `tests/domain.test.js`

实现：

- domain deterministic task 默认生成：
  - copy markdown/text artifact
  - storyboard/note document artifact
  - QA report artifact（task 级）
- AI 出图成功：
  - 每个 variant 添加 `image` ready artifact。
- AI 出图失败：
  - 对应 variant 添加 `image` failed artifact。
- `aiMeta.imageErrors` 与 artifacts error 对齐。

验收：

- 3 个 variant 均有 image artifact：ready 或 failed。
- copy/storyboard/QA artifacts 可被 export 消费。
- AI 出图失败不影响其他 variant。

风险：L3。AI 包装层与 domain task 合同变化，需覆盖失败路径。

### Task 3: Export 只消费 Artifact

改动文件：

- `lib/domain.js`
- `tests/export.test.js`
- `tests/domain.test.js`

实现：

- `buildExports` 改为基于 artifacts：
  - `downloadableFiles`: 只收 `status=ready` 且 `isDownloadableArtifact=true`
  - `deferredFiles`: 收视频等暂未支持项
  - `failedFiles`: 收失败项与 error
- export 包含：
  - cover image
  - copy markdown
  - storyboard/note JSON 或 CSV
  - QA report
- 删除或改造旧的纯文件名清单语义。

验收：

- 没 ready artifact 不进入 downloadable files。
- `video.mp4` 不再伪装成 ready。
- 导出包能明确展示 ready/failed/deferred 三类。

风险：L3。核心交付合同变化。

### Task 4: UI 展示真实/失败/暂未支持状态

改动文件：

- `components/AICrewStudio.jsx`
- `styles/globals.css`

实现：

- Export 区域分组展示：
  - 可下载
  - 生成失败
  - 暂未支持
- Agent 卡展示 artifacts：
  - ready: 可查看/可下载
  - failed: 错误摘要
  - deferred: 暂未支持说明
- 视频显示 `Deferred`，不显示假下载按钮。

验收：

- 用户可区分真产物和 deferred。
- failed variant 能看到错误原因。
- UI 不把 placeholder 文件当结果。

风险：L2。UI 合同变化，需 build + 手验。

### Task 5: 持久化链路检查

改动文件：

- `lib/storage/imageStore.js`
- `lib/storage/remote.js`
- `app/api/assets/route.ts`
- `tests/db.integration.test.js`

实现：

- ready image artifact 尽量引用 `imageStore` 的 `refKey`。
- Supabase 配置存在时，推送 assets 权威源。
- 无 DB 或远端失败时，localStorage 兜底；UI/日志不宣称云端成功。
- 确认 `variant:<id>` / `canvas:<id>` 命名空间不被破坏。

验收：

- 刷新后 ready image artifact 可回填。
- DB integration 覆盖 artifact/imageStore roundtrip。
- 远端失败路径保留本地可用状态。

风险：L3。涉及远端/本地一致性。

### Task 6: 验证与审查

命令：

```powershell
npm test
npm run build
npm run test:db
```

执行规则：

- `npm test` 必跑。
- `npm run build` 必跑。
- `npm run test:db` 有 `.env`/DB 配置时跑；无配置时记录为 skipped，不算远端验证成功。

审查视角：

- 架构：export 是否只消费 artifacts。
- 安全：error/provider detail 是否泄漏 token。
- 性能：base64/imageStore 是否造成 state 膨胀。
- 质量：artifact helper 是否集中，避免散落判断。
- 测试：ready/failed/deferred 三态均覆盖。
- 集成连续性：三模式、CanvasStudio、AI fallback 不破。

## Phase 3.1: Work Log（2026-06-24 已执行）

| Task | 状态 | 落地文件 | 结果 |
|---|---|---|---|
| T1 Artifact 合同 | ✅ completed | `lib/artifacts.js` | 集中定义 artifact type/status、确定性 id、refKey、脱敏、downloadable 判定、持久化剥离 helper。 |
| T2 Variant 产物 | ✅ completed | `lib/domain.js`, `lib/ai/workflow.js` | copy/storyboard/note/hashtags/QA 转 artifact；AI 出图 ready/failed/deferred 三态落到 variant artifacts；imageErrors 带 variantId。 |
| T3 Export 消费 | ✅ completed | `lib/domain.js`, `lib/export/bundle.js` | `buildExports`、`buildExportRecord`、`assembleExportBundle` 统一按 artifact.status 分 ready/failed/deferred，视频不再可下载。 |
| T4 UI 三态 | ✅ completed | `components/AICrewStudio.jsx` | Export 区域区分可下载、生成失败、暂未支持；失败/延迟项禁用并显示原因。 |
| T5 持久化链路 | ✅ completed | `lib/storage/imageStore.js`, `components/AICrewStudio.jsx` | ready image artifact 使用 `variant:<id>` refKey；localStorage/state 持久化前剥离 variant 与 export artifact data URL；rehydrate 回填 artifact.url。 |
| T6 验证 | ✅ completed | `tests/domain.test.js`, `tests/export.test.js` | status-based 断言覆盖视频 deferred、图片 ready/refKey、bundle 三桶输出。 |

### 验证记录

| 命令 | 结果 | 说明 |
|---|---|---|
| `node --test tests/export.test.js tests/domain.test.js tests/ai.test.js tests/imageStore.test.js` | ✅ pass | 103/103 pass。 |
| `npm test` | ✅ pass | 214 tests；212 pass；2 skipped（普通 `npm test` 不加载 DB env）；0 fail。 |
| `npm run build` | ✅ pass | 沙箱内 `.next` unlink EPERM；非沙箱重跑通过，Next 编译/TypeScript/静态页生成成功。 |
| `npm run test:db` | ✅ pass | 沙箱内 Node test runner spawn EPERM；非沙箱重跑真实 Supabase 集成 8/8 pass。 |

### 执行边界

- 本 sprint 未接真实视频引擎；`video.mp4` 仍是 `deferred` 且 `downloadable=false`。
- 本 sprint 未新增 script artifact；当前只落 copy、storyboard/note、hashtags、QA report 与 image/video artifacts。
- DB 集成测试本轮实际命中 `.env` 中的 `SUPABASE_DB_URL`，不是 skip。

## Phase 4: Review Checklist

P0 必查：

- [x] `video.mp4` 不可 ready/downloadable。
- [x] export 无假文件。
- [x] AI 单图失败不拖垮整个任务。
- [x] 远端失败不宣称 Supabase 成功。

P1 必查：

- [x] artifact 三态 UI 明确。
- [x] `aiMeta.imageErrors` 与 artifact error 一致。
- [x] `npm test` / `npm run build` 通过。
- [x] `npm run test:db` 结果如实记录。

## Phase 4.1: Review Result（2026-06-24）

- 架构：ArtifactRef.status 已成为 export/download 的单一状态来源；record 级 `status: ready` 字面量已移除。
- 安全：artifact error 统一经 `sanitizeArtifactError` 限长并清理 URL/token/key/header 形态。
- 性能：state/localStorage 持久化前剥离 artifact 内联 data URL；ready image 用 imageStore refKey 回填。
- 质量：artifact 创建、更新、下载判定、storage strip 逻辑集中在 `lib/artifacts.js`。
- 测试：ready/failed/deferred 的核心路径由 domain/export/ai/imageStore 测试覆盖；DB roundtrip 已跑真实 Supabase。
- 集成连续性：Flow/domain/AI/export/UI/storage 同步迁移；CanvasStudio 运行时边界未被引入 domain/ai 依赖。

P0/P1：本轮审查未发现阻断项。

## Phase 5: Compound 预期

预期沉淀：

- Artifact 合同成为 Media Plane 的第一块基石。
- Export 从文件名清单升级为真实产物包。
- 视频 deferred 规则硬化，避免产品声明漂移。
- 下一 sprint 可在此基础上做 P0-B：任务状态机 + Agent run。

## Phase 5.1: Compound 记录（2026-06-24）

- Artifact 合同已成为 Media Plane 基石：后续真实视频 job、文件上传、批量下载都应继续消费 `ArtifactRef`，不要回退到文件名清单。
- Export 已从「文件名/placeholder 混合」升级为「ready/failed/deferred 三态产物包」。
- 视频 deferred 规则已硬化：没有真实 URL/refKey/provider job 完成信号前，不允许 ready/downloadable。
- 下一 sprint 建议接 P0-B：task/agent run 状态机（queued/running/failed）与真实 agent execution DAG。

Goal loop: iter 1/1, until=n/a, goal-met=yes, decision=stop:completed

## 下一 Phase 预热

关键文件：

- `lib/domain.js`
- `lib/ai/workflow.js`
- `tests/export.test.js`
- `tests/ai.test.js`
- `components/AICrewStudio.jsx`

起步命令：

```powershell
rg -n "buildExports|buildExportFiles|video.mp4|imageUrl|aiMeta|exports|fileNames|generateVariantImages" lib tests components
npm test
```

下一步：进入 Work，从 Task 1 开始 TDD 定义 artifact helper 与 export 三态断言。


