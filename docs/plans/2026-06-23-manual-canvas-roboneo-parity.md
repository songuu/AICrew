---
title: "手动导演台画布 RoboNeo 直接添加对齐"
type: sprint
status: completed
created: "2026-06-23"
updated: "2026-06-23"
checkpoints: 0
tasks_total: 7
tasks_completed: 7
tags: [sprint, ui, canvas, orchestration, manual-mode]
aliases: ["manual-canvas-roboneo", "手动画布对齐"]
related:
  - "[[2026-06-22-canvas-toolbar]]"
  - "[[2026-06-23-manual-mode-canvas-layout]]"

invariants:
  - "复用单一画布运行时 lib/canvas/{model,viewport,history,tools}.js，不重写画布逻辑（DRY）"
  - "不碰 Flow model / flowToSkill / 执行管线 onRun(brief,flow,meta)（守呈现层契约）"
  - "自动 / 半自动布局零改动"
  - "画布状态走独立 localStorage key；手动画布与 /canvas 画布各自独立 key 不串"
  - "静态导出契约不破：纯前端组件复用，不加后端持久化"
  - "domain/ai/flow/canvas 既有测试断言全绿"
invariant_tests:
  - tests/canvas.test.js
  - tests/flow.test.js
  - tests/domain.test.js
  - tests/ai.test.js
---

# 手动导演台画布 RoboNeo 直接添加对齐

需求：截图 #2（手动「AI 创作工作台」）画布区要像截图 #1（RoboNeo studio）——「添加」开菜单（导入图片/导入视频/文字/矩形/圆形/箭头）真落画布，选择/抓手/撤销/重做/缩放/图层全部可用，体验与 RoboNeo / 现 `/canvas` 一致。

## Phase 1: 需求分析（Think）

### 现状差距
- `/canvas` 视图 = `CanvasStudio`（`components/canvas/CanvasStudio.jsx`）= 完整 RoboNeo 自由画布，已 completed、自包含可复用。
- 手动导演台画布 = `FlowCanvas`（`OrchestratorConsole.jsx` 内的流程节点图）+ `oc-canvas-dock` **皮肤坞**：添加=仅 `focusChat()`、选择/抓手=纯视觉态、撤销/重做=disabled。即坞按钮全无真功能。

### 用户决策（AskUserQuestion）
**画布形态 = 统一画布**：复用真画布运行时作底座，Director 流程节点作只读 overlay 叠加其上，共享同一视口/缩放；底部坞驱动真工具（添加/选择/抓手/撤销/重做 + 缩放/适应/图层）。既得 RoboNeo 直接添加，又保留流程可视化。

### Scope
- 手动 stage 用 `CanvasStudio` 替换 `FlowCanvas`，获得全套真工具坞 + 添加菜单 + 缩放 + 图层。
- Director `flow` 渲染为画布坐标系内的**只读 SVG overlay**（节点 + 连线），随画布 pan/zoom。
- 与 `/canvas` 体验一致：手动画布同样接入 AI 生成图（`onGenerateImage`）+ 导入本次封面（`covers`）。

### Non-scope
- 不碰 flow model / flowToSkill / 执行管线 / 对话 Director。
- 自动 / 半自动布局零改动。
- overlay 节点不可拖拽编辑（只读；流程仍由对话搭建）。
- 后端持久化（守静态导出）。

### Success
- 手动画布：点「添加」可真插入图片/视频/文字/矩形/圆形/箭头；可选/移/缩/旋/删；撤销重做、缩放、图层可用。
- Director 流程节点叠加显示并随画布缩放。
- `npm test` 全绿（新增 overlay 纯函数测试 + 既有 invariant 回归）。
- `npm run build` 静态导出通过。

## Phase 2: 技术方案（Plan）

### 入场扫描 — Invariants 继承

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| 画布运行时 | 纯逻辑/渲染分层、零 import domain/ai | 仅给 `CanvasStudio` 加 3 个可选 prop，不改 lib/canvas/* 逻辑 |
| Flow 编排 | 呈现层改动不碰 model/flowToSkill/onRun | overlay 只读消费 `flow`，不 mutate；运行链路不动 |
| 构建 | 静态导出 output:export | 纯 client 组件复用，无新后端 |
| 存储 | 画布独立 localStorage key | /canvas 仍 `aicrew-canvas-v1`；手动用新 key `aicrew-manual-canvas-v1` |
| 测试 | domain/ai/flow/canvas 断言全绿 | 每 task 跑 invariant_tests |

### 入场扫描 — 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| 手动画布加图元/图片 | 坞「添加」/绘制 | CanvasStudio history.commit | ✅ localStorage(`aicrew-manual-canvas-v1`) | ✅ |
| Director overlay | flow 变化 | computeFlowOverlay(flow) → SVG | ❌ overlay 不入画布存储（flow 自有生命周期） | ✅（flow 在内存） |
| AI 生成图落手动画布 | 添加菜单 | onGenerateImage（AICrewStudio→Workbench→OC→CanvasStudio） | ✅ 入手动 key | ✅ |

无「❌ 静默丢失」：overlay 不持久化是有意（流程由对话/运行管线管理，非画布资产）。

### 入场扫描 — 债务清单

| 来源 | 议题 | 本 sprint 决策 | 备注 |
|------|------|----------------|------|
| 2026-06-23-manual-mode-canvas-layout | 死 CSS `.bottom-tool-dock` 系列 | ⏭ 不在本 sprint 范围 | 与本次无关 |
| 本 sprint 产生 | `FlowCanvas`/`OcDockButton`/`oc-canvas*` 改后变死 | **本 sprint 删除**（守第6视角无死代码） | 见 T5 |

### 任务拆解

| # | 任务 | 风险 | 测试 |
|---|------|------|------|
| 1 | `lib/flow/overlay.js`：纯函数 `computeFlowOverlay(flow)` → {nodes,edges,isEmpty}，节点尺寸常量 + 连线 bezier 端点几何 | L3 | TDD：节点映射/边端点/缺端点丢弃/空流（tests/flow.test.js 追加） |
| 2 | `CanvasStudio` 加 3 可选 prop：`storageKey`（默认 `aicrew-canvas-v1`）、`overlay`（SVG ReactNode，渲染于世界变换组内、pointer-events:none）、`emptyHint`（覆盖空态文案，null=不显）；`className` 透传根节点 | L2 | 既有 canvas.test 回归 + build |
| 3 | `OrchestratorConsole`：新增 `FlowOverlay`（消费 computeFlowOverlay + AGENT_BY_ID 渲染只读 SVG 节点/连线）；手动 stage 用 `<CanvasStudio className="is-embedded" storageKey="aicrew-manual-canvas-v1" overlay={<FlowOverlay flow={flow}/>} .../>` 替换 `FlowCanvas`+`oc-future`+`oc-canvas-dock` | L2 | build + 手测 |
| 4 | prop 串接：AICrewStudio→Workbench→OrchestratorConsole 传 `onGenerateImage`（gated generateCanvasImage）；`covers` 由 OC 从 `task` 本地计算 | L2 | build |
| 5 | 删死代码：`FlowCanvas`、`OcDockButton`、`tool`/`setTool`/`focusChat`；CSS 删 `.oc-canvas`/`.oc-canvas-inner`/`.oc-canvas-edges`/`.oc-canvas-node*`/`.oc-canvas-empty`/`.oc-future`/`.oc-canvas-dock`/`.oc-dock-*` 及其响应式 | L2 | grep 零引用 + build |
| 6 | CSS：`.canvas-view.is-embedded` 填充 stage（flex:1/height:auto/min-height:0）；嵌入态坞偏移避让全局 right-tool-rail；flow overlay 节点样式 | L1 | 手测 + 截图 |
| 7 | 验证：`npm test` 全量 + `npm run build` 静态导出 + Playwright 手动空态/添加流截图 | — | 全量 |

### 验证策略
- T1 纯逻辑 L3 → TDD（RED→GREEN），node --test。
- 每 task 跑 invariant_tests（canvas/flow/domain/ai）。
- UI L2：build 通过 + 截图手测（手动画布添加图元/overlay 缩放）。

## Phase 3: 变更日志

- **T1** `lib/flow/overlay.js`：纯函数 `computeFlowOverlay(flow)` → `{nodes, edges, isEmpty}`（节点尺寸常量 FLOW_NODE_W/H 124×58、连线右中→左中 bezier 端点）。TDD `tests/flow.test.js` +5 测试（节点映射/边端点/缺端点丢弃/空流不抛/自定义尺寸）。flow+canvas **80/80** RED→GREEN。
- **T2** `CanvasStudio` 加 4 可选 prop：`storageKey`（默认 `aicrew-canvas-v1`，load/persist effect 改用之 + 入 deps）、`overlay`（渲染于世界变换组内、`.canvas-overlay` pointer-events:none）、`emptyHint`（覆盖空态：ReactNode 自定义 / null 抑制 / 不传走默认）、`className`（透传根节点）。零改 lib/canvas/* 逻辑。
- **T3** `OrchestratorConsole`：新增 `FlowOverlay`（消费 computeFlowOverlay + AGENT_BY_ID 渲染只读 SVG 节点/连线）；手动 stage 用 `<CanvasStudio className="is-embedded" storageKey="aicrew-manual-canvas-v1" overlay={<FlowOverlay flow={flow}/>} onGenerateImage covers emptyHint/>` 替换 `FlowCanvas`+`oc-future`+`oc-canvas-dock`。
- **T4** prop 串接：`AICrewStudio`→`Workbench`→`OrchestratorConsole` 传 `onGenerateImage`（gated `generateCanvasImage`）；`covers` 由 OC `useMemo` 从 `task.variants` 本地计算（与 /canvas 同口径）。
- **T5** 删死代码：`FlowCanvas`/`OcDockButton` 组件、`tool`/`setTool` 状态、`focusChat`、`isVideoFlow` 死导入；CSS 删 `.oc-canvas`/`.oc-canvas-inner`/`.oc-canvas-edges`/`.oc-edge`/`.oc-canvas-node*`/`.oc-canvas-empty`/`.oc-future`/`.oc-canvas-dock`/`.oc-dock-*` 及 4 处响应式引用 + `@keyframes oc-flow-dash`（`oc-pulse` 仍被他处用，保留）。更新 FloatingCommandLayer 过时注释。
- **T6** CSS：`.canvas-view.is-embedded` 填满 stage（flex:1/height:auto/min-height:420px 下限）；嵌入态 `.canvas-view-dock`+`.canvas-layers` 偏移 right:96px 避让全局 right-tool-rail；`.oc-overlay-edge/node/node-title/node-id` overlay 样式；窄屏 320/360 下限。
- **T7** 验证：`npm run build` 编译成功 + TypeScript 通过 + 17 页静态（含 /workbench、/canvas）；`npm test` **189/189**（含 invariant flow/canvas/ai/domain；domain 的并发会话 WIP 此间已被修复）。

## Phase 4: 审查结果

5+1 视角对抗式自审（详见会话）。无 P0。

| 严重度 | 视角 | 问题 | 处理 |
|--------|------|------|------|
| P1 | UX/集成 | 嵌入态 `.canvas-layers`/`.canvas-view-dock` 与全局 `right-tool-rail`(fixed right:18px) 重叠（/canvas 不渲染 rail 故未暴露） | ✅ 嵌入态二者偏移 right:96px |
| P1 | 正确性/布局 | embedded `min-height:0` 在 flex 链未撑高时画布坍塌 | ✅ 复原 420px 下限（沿用旧 `.oc-canvas`） |
| P2 | UX | `显示全部`(fitToView) 只框 freeform 对象、不含 flow overlay 节点 | ⏭ 推迟（无害；节点默认在原点附近视口内可见） |
| P2 | 性能 | FlowOverlay 未 memo，CanvasStudio 重渲染时重算 computeFlowOverlay | ⏭ 推迟（O(节点数)、节点极少，可忽略） |

### 第 6 视角 — 集成连续性
- 不破 invariant：CanvasStudio 仍零 import domain/ai；手动画布独立 storageKey `aicrew-manual-canvas-v1` 与 /canvas 不串。
- flow model / flowToSkill / onRun 执行管线、auto/semi 布局零改动。
- 无新增 dead code：旧 FlowCanvas/dock/state/CSS 全清；新 API `computeFlowOverlay` 被 OC + 测试 import（计数≥1）。
- 分层洁净：flow overlay 由 OC（知 flow）渲染后作**不透明 ReactNode** 注入 CanvasStudio，画布层不耦合 flow。

## Phase 5: 复利记录

- **统一画布 = 复用单一运行时 + 注入式 overlay**：把已验证的 `CanvasStudio` 经三个正交 prop（`storageKey` 多实例隔离 / `overlay` 世界坐标系只读叠加 / `emptyHint` 空态覆盖）变成可嵌入运行时，而非为手动模式重造画布逻辑。Director 流程作 `pointer-events:none` 的 SVG overlay 叠在自由画布之上、随 pan/zoom 缩放——既得 RoboNeo 直接添加，又保留流程可视化。沉淀进 [[aicrew-canvas-runtime]]。
- **overlay 由领域侧渲染、以不透明 ReactNode 注入，守住画布零依赖**：CanvasStudio 不认识 flow；OC 把 `<FlowOverlay flow/>` 作为 opaque child 传入。运行时复用不以牺牲分层为代价。
- **几何下沉纯函数取 ground truth**：`computeFlowOverlay` 纯函数化（不读 DOM/React）→ 5 个单测覆盖端点/边界，与画布运行时同一「纯逻辑可测」哲学。
- **复用既有组件时，差异环境会暴露隐藏耦合**：CanvasStudio 在 /canvas（无 right-tool-rail）正常，嵌入手动工作台（有 rail）才暴露 dock/图层面板与 rail 重叠——复用组件务必核对宿主环境差异（此处靠嵌入态 CSS 偏移消解）。
