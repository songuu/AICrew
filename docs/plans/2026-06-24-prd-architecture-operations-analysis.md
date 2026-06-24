---
title: "AICrew RoboNeo PRD 架构与实操分析"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 1
tasks_completed: 1
tags: [sprint, analysis, prd, architecture, operations, roboneo]
aliases: ["PRD 架构实操分析", "RoboNeo PRD 分析"]
goal: "继续分析 docs/AICrew_Studio_RoboNeo_Product_PRD.md，从架构层面和实际操作层面形成可执行结论。"
invariants:
  - "PRD Demo 闭环必须可跑通：Brief -> Agent 工作流 -> 3 个内容变体 -> 导出包 -> 积分扣减。"
  - "三模式必须经 Flow -> flowToSkill -> 同一执行管线，避免三套业务真相。"
  - "CanvasStudio 保持运行时自包含；画布层不直接 import domain/ai。"
  - "涉及视频能力时必须明确 deferred/placeholder，不得宣称真实出片。"
---

# AICrew RoboNeo PRD 架构与实操分析

## Phase 1: Think

### 目标

继续分析 `docs/AICrew_Studio_RoboNeo_Product_PRD.md`，重点回答两件事：

1. 架构层面：当前 AICrew 是否具备 PRD 中「AI Creative Operating System」的骨架，哪些边界需要先固化。
2. 实操层面：现在用户/开发者能实际跑通什么，哪些能力仍是模拟、占位或 deferred，下一步怎样落地最稳。

### Evidence

| 证据 | 结论用途 |
|---|---|
| `docs/AICrew_Studio_RoboNeo_Product_PRD.md` | 产品北极星：Agent、Skill、Brand Memory、Model Router、任务状态机、编辑器、导出、计费 |
| `docs/research/2026-06-23-roboneo-vs-aicrew-gap-analysis.md` | 现状基线：AICrew 是「高保真编排外壳 + 局部真生成」，视频/真实媒体引擎是最大缺口 |
| `docs/plans/2026-06-22-orchestration-three-modes.md` | 架构支点：一个 Flow，三种创作方式 |
| `docs/plans/2026-06-23-manual-canvas-roboneo-parity.md` | 手动导演台已复用真实 CanvasStudio 运行时，不再只是皮肤 |
| `lib/domain.js` | Agent/Skill/Brief/QA/Credits/Export 的确定性领域核心 |
| `lib/flow/*` | Flow DAG、路由、执行桥、导演台指令、overlay 纯函数 |
| `lib/ai/workflow.js` / `lib/ai/providers.js` | 真实 AI 文案/图像路径已接入；video provider 存在但 workflow 未调用 |
| `app/api/*` / `lib/db/*` | state/assets/brand/canvas/ai-selection 已有 Supabase API 边界与本地兜底 |

### Scope

- 输出架构层判断。
- 输出实操层判断。
- 给出后续 sprint 排序。
- 不改产品代码。
- 不接入视频、不部署、不改 DB schema。

## Phase 2: 架构分析

### 1. 产品架构判断

PRD 的核心不是「多几个生成按钮」，而是：

```text
用户目标 + 素材 + 品牌 + 平台规则 + Skill + Agent + 模型路由 + 编辑/导出 + 数据反馈
= 可发布、可复用、可迭代的商业内容资产
```

当前仓库已经做对了上半场：控制平面已经成型。

| PRD 层 | 当前落点 | 评价 |
|---|---|---|
| 自然语言入口 | Workbench / OrchestratorConsole / Director chat | 已具备入口，manual 指令仍偏命令式 |
| 多 Agent | `lib/domain.js` agents + task events + agent artifacts | 结构化，但仍是确定性管线，不是真 Agent Teams |
| Skill | `skills[]` + Flow 合成 skill | 骨架正确，缺用户保存 Flow 为 Skill 的闭环 |
| Brand Memory | `defaultBrandKit` + brand API/doc | 有字段和持久化边界，缺版本化与生成反馈学习 |
| Flow 编排 | `lib/flow/model.js` + `flowToSkill` | 当前最强架构资产 |
| 画布编辑 | `CanvasStudio` + Director overlay | 真实白板/编辑器，缺生成式编辑工具 |
| 模型路由 | text/image provider selection | 有抽象，缺任务级 router/队列/视频 job runner |
| 导出/计费 | domain 模拟 export/credits | 只适合 demo，不适合商业声明 |

架构结论：AICrew 不是普通 AI 工具壳，它已经有「创作控制平面」。但还不是完整 PRD 产品，因为「媒体生产平面」和「运营交易平面」没有成型。

### 2. 推荐的系统分层

后续不要继续把所有能力堆进 `domain task`。应硬拆两层：

| 层 | 职责 | 当前状态 | 下一步 |
|---|---|---|---|
| Control Plane | Brief、Flow、Agent DAG、Skill、UI 编排、QA 规则、成本估算 | 已成型 | 继续守住纯函数/单桥 |
| Media Plane | 图片/视频/音频生成 job、provider adapter、artifact 存储、导出文件 | 未成型 | 新增 Artifact/Job 合同 |
| Operations Plane | 认证、团队、计费、任务队列、后台监控、审计 | 部分 UI + 模拟 | 先补任务状态机与真实导出，再补真实计费 |

关键原则：Flow/Agent 只产出「要生成什么」与「生成后如何验收」，媒体平面负责「真正生成、存储、轮询、失败恢复」。

### 3. Artifact 合同必须先落地

当前 `buildExports` 仍能产出 `video.mp4` 占位文件名。要从 demo 走向真实生产，先定义 Agent 交接物，而不是直接上视频。

建议合同：

```ts
type ArtifactRef = {
  id: string;
  type: "image" | "video" | "audio" | "text" | "document";
  status: "planned" | "queued" | "running" | "ready" | "failed" | "deferred";
  url?: string;
  refKey?: string;
  provider?: string;
  providerJobId?: string;
  mimeType?: string;
  bytes?: number;
  metadata?: Record<string, unknown>;
  error?: string;
};
```

导出层只能消费 `ArtifactRef(status=ready)`；`placeholder/deferred` 必须显式显示，不再伪装成真实文件。

### 4. 三模式架构应继续保留

`自动 / 半自动 / 手动` 不应变成三套执行器。当前 `Flow -> flowToSkill -> runCreativeWorkflowWithSkill/runCreativeWorkflowWithAI` 是对的。

下一步只允许新增两类东西：

1. 新的搭图方式：例如「从爆款结构生成 Flow」。
2. 新的执行后端：例如「Flow -> DAG runner -> media jobs」。

禁止：在 auto/semi/manual 内分别写一套生成、计费、导出逻辑。

## Phase 3: 实操分析

### 1. 今天实际能跑通什么

| 操作 | 当前真实度 | 说明 |
|---|---:|---|
| 进入 Workbench，输入 Brief，选择平台/受众/Skill | 高 | UI 与 brief merge 已成型 |
| 三模式搭建 Flow | 高 | auto/semi/manual 都能产出 Flow |
| 执行 Flow 并生成 task | 高 | 经同一 domain 执行管线 |
| 文案生成 | 高（需 AI 配置） | `generateText` 真接入；无配置时 deterministic fallback |
| 多 variant 出图 | 中高（需 AI 配置） | `generateVariantImages` 支持多图，受 `maxImages` 配置控制 |
| Agent artifact 展示 | 中高 | pre-pass 产物可 surface 到 agent 卡 |
| 手动画布添加图元/导入/撤销/缩放/图层 | 高 | CanvasStudio 真实可用 |
| 画布 AI 生成图 | 中（需 AI 配置） | 组件注入 `onGenerateImage`，可落画布 |
| Supabase 持久化 | 中 | state/assets/brand/canvas/ai-selection 有 API；租户仍是默认 workspace |
| 视频生成 | 低/无 | provider 有函数，workflow 未调用；导出视频仍 placeholder |
| 真实导出下载 | 低 | 图文可有 URL/dataURL，但导出合同仍偏清单 |
| 真实计费 | 无 | credits 是估算/模拟，不可当商业扣费 |

### 2. 不能对外宣称的能力

- 不能说「已能生成真实短视频」：`video.mp4` 仍是 placeholder/deferred。
- 不能说「RoboNeo 级 Agent Teams」：当前是结构化 Agent timeline + LLM 增强，不是并行多 Agent 调引擎交接真实媒体。
- 不能说「真实商业计费」：积分消耗尚未绑定支付、订单、退款、模型成本对账。
- 不能说「完整移动端/API 平台」：当前是单 Web 产品，API 主要服务前端状态。
- 不能说「完整 Brand Memory 学习」：有 brand kit 持久化，但未从成功任务/用户反馈自动更新。

### 3. 建议的实际操作路径

开发/验收时按以下路径，不要跳级：

1. 图文闭环：
   - Workbench 选择图文 Skill。
   - 配置 text/image AI。
   - 运行后检查 3 个 variant 是否有文案、图片、agent artifact、QA。
   - 检查 export 不再用虚假媒体名。
2. 画布闭环：
   - 进入 `/canvas` 或 manual Workbench。
   - 添加图片/文字/图形。
   - AI 生成图落画布。
   - 刷新后确认 storageKey 对应画布仍可见。
3. 持久化闭环：
   - 有 DB 时跑 `npm run test:db`。
   - 无 DB 时确认 UI 明确走本地兜底，不把本地成功说成云端成功。
4. 任务透明度：
   - 每个 Agent 卡必须有 concrete artifact 或明确 skipped/deferred reason。
   - `aiMeta.prePasses` 失败时不影响主任务，但 UI 不能假装已增强。

### 4. 验证命令

| 场景 | 命令 |
|---|---|
| 全量领域/Flow/画布/AI 回归 | `npm test` |
| Next 构建与静态导出 | `npm run build` |
| DB 持久化回归 | `npm run test:db` |
| 本地开发手验 | `npm run dev` 后访问 `/workbench`、`/canvas` |

本次是分析文档变更，未执行测试。

## Phase 4: 后续 Sprint 排序

### P0-A：真实图文内容包闭环

目标：先把「图片 + 文案 + 脚本 + 分镜 + QA + 导出」做成真实可交付，不接视频。

任务：

- 定义 `ArtifactRef`。
- `variant.imageUrl` 全部进入 artifact store。
- `buildExports` 改为消费 ready artifacts。
- 导出包至少包含真实图片 URL/dataURL、文案 Markdown、脚本/分镜 JSON/CSV。
- 所有 placeholder 文件显式标注 `deferred`。

验收：

- 3 个 variant 均有真实图片或明确失败原因。
- 导出层无伪装文件名。
- `npm test` + `npm run build` 通过。

### P0-B：任务状态机 + Agent run 运行记录

目标：把当前 completed 即时任务升级为可观测任务，而不是直接一步完成。

任务：

- 引入 `creative_tasks` / `agent_runs` 内存或 DB 适配层。
- 状态：`draft -> queued -> running -> agent_processing -> completed/failed/cancelled`。
- Agent step 有 `startedAt/finishedAt/error/artifactRefs/retryCount`。
- UI 先用 polling，不急着 SSE。

验收：

- 单个 Agent 失败可重试。
- task 失败保留部分 artifacts。
- 不再只靠前端 state 表示生产过程。

### P1：Brand Memory 持久化与学习

目标：把品牌记忆从「默认字段」升级为可复用资产。

任务：

- Brand doc 增加 version / source / updatedByTaskId。
- 成功导出后可把 voice、禁用词、视觉偏好写回建议。
- 用户确认后才更新 brand memory。

验收：

- 第二次创作自动带入上一轮确认过的品牌偏好。
- brand 更新可追溯到任务。

### P1：生成式画布编辑

目标：画布从白板变成创作工作台。

任务：

- 选中画布对象后支持 AI 操作：换背景、改风格、生成相似图。
- 操作输出新 artifact，并作为新图层落画布。
- 原图保留，可回滚。

验收：

- 选中图层 -> 输入修改指令 -> 新图层出现 -> 刷新后仍在。

### P2：视频 Job Skeleton（只建骨架）

目标：为后续真实视频接入打地基，不直接承诺质量。

任务：

- `generateVideo` 接入到 media job adapter。
- 支持 `providerJobId`、polling、超时、失败原因、取消。
- UI 显示 video deferred/running/ready。
- Export 只在 ready 后出现 MP4。

验收：

- fake provider + real provider 都走同一 job 合同。
- 没有 ready 视频时，不出现可下载 MP4。

## Phase 5: 结论

AICrew 现在最强的是架构骨架，不是媒体生成能力。

正确路线不是继续堆 UI，也不是直接冲视频；先把「图文真实内容包」和「Artifact/Task 合同」做硬。等导出层只认真实 artifact 后，再接视频 job。这样 PRD 的「AI Creative OS」会从可演示产品壳，逐步变成可交付生产系统。

Goal loop: iter 1/3, until=n/a, goal-met=yes, decision=stop:met
