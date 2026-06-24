---
title: "历史记录与素材库模块"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, history, assets, aicrew]
aliases: ["history-assets"]
goal: "新增历史记录模块：查看历史生成情况、点击重看效果、支持重新编辑、支持锁定后禁止编辑；新增素材库模块：支持上传文件和图片，并可直接引用到生成。结束条件：验证通过且提交成功。"
goal_status: met
goal_iteration: 0
invariants:
  - "Supabase 主 snapshot 仍是工作区状态权威源；localStorage 只做离线兜底。"
  - "三模式生成仍经 OrchestratorConsole -> onRun(brief, flow, meta) 单桥执行。"
  - "素材作为 brief.materials 进入生成链路；生成提示只消费素材引用名，不直接读取二进制。"
  - "图片/文件上传必须在边界校验 MIME 与大小，失败显示明确原因。"
  - "锁定历史记录后不得触发重编辑、Hook 修改、Agent retry 等编辑动作。"
invariant_tests:
  - "npm test"
  - "npm run build"
deferred: []
---

# 历史记录与素材库模块

## Phase 1: Think

### Scope

- 新增 `History` 导航和 `/history` 页面。
- 历史记录复用现有 `state.tasks/projects/exports`，不新增后端表。
- 支持点击历史项切换当前查看任务，在 Workbench 重新看到对应效果。
- 支持从历史项把 brief 回填到生成台，重新编辑并再次生成。
- 支持锁定历史项；锁定后重编辑、Hook 修改、Agent retry 禁用。
- 素材库支持上传图片与常见文件，预览图片、展示文件类型/大小。
- 素材库卡片支持“引用到生成”，引用项进入下一次 `brief.materials`。

### Non-scope

- 不做云对象存储或 signed upload；本期沿用 snapshot 持久化 data URL。
- 不做素材版本审计、权限、多工作区素材隔离 UI。
- 不把非图片文件内容注入模型上下文；只注入文件名作为引用事实。

### Success

- 历史页可看到所有生成任务、状态、分数、时间、素材数。
- 点击“查看效果”后 Workbench 显示该历史任务的 preview、variant、runtime。
- 点击“重新编辑”后生成台创意基底、平台、受众、素材引用回填。
- 锁定任务后重编辑按钮禁用，当前锁定任务不可 Hook revise / Agent retry。
- 素材页可上传 image/pdf/txt/csv/json/Office 文件，图片有缩略图。
- 素材页可切换引用状态，Workbench 能显示并随下一次生成进入 `brief.materials`。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|---|---|---|
| 生成链路 | 三模式统一从 `onRun(brief, flow, meta)` 执行 | 素材引用只合并到 `brief.materials`，不绕开 onRun |
| 持久化 | snapshot + localStorage 双层 | 新字段挂在 task/asset shape 内，由既有 save effect 持久化 |
| 素材 | 图片 data URL 不能撑爆主状态 | 新上传统一 10MB cap，边界显式报错 |
| 锁定 | 用户语义比 UI 装饰重要 | 编辑入口统一检查 `task.locked` |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|---|---|---|---|---|
| 历史重看 | History 点击查看 | selectedTaskId -> activeTask | 任务已在 snapshot | 是 |
| 历史重编辑 | History 点击重新编辑 | editSeed -> OrchestratorConsole params | 新生成后写 snapshot | 是 |
| 历史锁定 | History 点击锁定 | task.locked | snapshot/localStorage | 是 |
| 素材上传 | Assets 选择文件 | validateLibraryAsset -> FileReader | state.assets | 是 |
| 素材引用 | Assets 点击引用 | referencedAssetIds -> libraryMaterials -> brief.materials | 引用选择本期内存态 | 当前会话可见 |

### 入场扫描 - 债务清单

无前置 `deferred` 必须本 sprint 收口。

## Phase 3: Work Tasks

- [x] Task 1: 新增素材库文件校验/归一纯函数与测试。
- [x] Task 2: 新增 active task selection、history view、锁定状态。
- [x] Task 3: 接通 history 重看、重编辑、锁定编辑门控。
- [x] Task 4: 改造 Assets 页面上传文件/图片、预览、引用到生成。
- [x] Task 5: 更新 CSS 与路由页面。
- [x] Task 6: 跑 `npm test`、`npm run build`，启动本地服务检查路由。

## Phase 4: Review Checklist

- P0: 锁定任务仍能通过任一入口编辑。
- P0: 历史查看仍硬取最新 task，导致旧任务无法重看。
- P1: 文件上传无大小/MIME 边界。
- P1: 素材引用只改 UI，不进入 `brief.materials`。
- P1: 历史/素材新增页面不可从侧边栏发现。

## Phase 5: Compound

### 已验证事实

- `npm test` 通过：236 tests，234 pass，2 skipped（`SUPABASE_DB_URL` 未配置的集成测试）。
- `npm run build` 通过，Next route table 包含 `/history`、`/assets`、`/workbench`。
- 本地 dev server `npm run dev -- -p 3001` 启动成功。
- HTTP 验证 200：`http://localhost:3001/aicrew/history/`、`/aicrew/assets/`、`/aicrew/workbench/`。
- `git diff --check` 通过。

### 收口

- 历史模块：新增导航、`/history` 页面、active task selection、查看效果、重新编辑、锁定禁编辑。
- 素材库：新增文件/图片上传、类型/大小校验、图片缩略图、素材引用到生成。
- 生成台：历史重编辑可回填 brief；素材库引用会合并进下一次 `brief.materials`。
- 测试沉淀：新增素材库文件校验测试、任务锁定测试。
