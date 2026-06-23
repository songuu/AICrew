---
title: "手动模式画布主区化 + 操作栏门控"
type: sprint
status: completed
created: "2026-06-23"
updated: "2026-06-23"
checkpoints: 0
tasks_total: 7
tasks_completed: 7
tags: [sprint, ui, orchestration, workbench, manual-mode]
aliases: ["manual-canvas-layout", "手动画布布局"]
related:
  - "[[2026-06-22-orchestration-three-modes]]"
  - "[[2026-06-22-canvas-toolbar]]"

invariants:
  - "三模式共用同一 Flow / onRun(brief, flow, meta) 契约，本次只改呈现层"
  - "自动 / 半自动布局零改动（仍是现三栏 compose|canvas / run|canvas）"
  - "FloatingCommandLayer 仅删 bottom-tool-dock，right-tool-rail + zoom-dock 保留"
invariant_tests:
  - tests/flow.test.js
  - tests/canvas.test.js
---

# 手动模式画布主区化 + 操作栏门控

## Phase 1: 需求分析

截图来自 Workbench（AI 创作工作台）。两个优化点，**都是手动模式专属**，硬布局要求：

1. **流程图（FlowCanvas）**：已只在 manual 渲染，但挤在左侧窄栏（compose 0.8fr）+ CSS 写死 `max-height:280px` → 太小。设计文档 §4.3 原意它就是手动主交互区。要做成右侧主区、合理放大。
2. **底部操作栏（选择/抓手/添加/撤销/重做）**：当前是全局 `FloatingCommandLayer.bottom-tool-dock`（纯装饰，按钮全跳 canvas，超宽屏才显示），所有非 canvas 页都出现。要改成**只在手动模式显示**、作为画布的操作栏正确归位。

### 用户决策（AskUserQuestion）
- **画布布局** = 占右侧主栏：手动时画布移到右侧大栏（替换 OUTPUT 预览位），左栏留 模式选择+创意+对话；自动/半自动维持现三栏。
- **操作栏功能** = 仅门控+正确归位：可见性门控 + 归位 + 画布加大；按钮视觉就位、功能轻量；纯前端布局/CSS + mode 状态。

### Non-scope
- flow model / flowToSkill / 执行管线不动
- 画布 pointer 手势 / viewport 缩放 / flow 撤销重做历史 → 后续单独迭代（本轮撤销/重做按钮 disabled）
- 自动 / 半自动布局不动

## Phase 2: 技术方案

核心：`mode` 从 OrchestratorConsole 上提到 Workbench（受控），让 Workbench 按 mode 重排。

| # | 改动 | 文件 |
|---|------|------|
| T1 | mode 上提：Workbench 持 orchMode；OrchestratorConsole 受控 (mode/onModeChange) | OrchestratorConsole.jsx + AICrewStudio.jsx |
| T2 | 手动分支重排双列（左 控件 / 右 大画布+dock）；自动半自动维持扁平 | OrchestratorConsole.jsx |
| T3 | 手动时 Workbench 隐藏 OUTPUT + run-panel，oc-panel 跨满宽 | AICrewStudio.jsx + globals.css |
| T4 | FlowCanvas viewport+inner 双层：去 280px 上限、填满、空态居中 | OrchestratorConsole.jsx + globals.css |
| T5 | 新 oc-canvas-dock（选择/抓手/添加/撤销/重做）轻量功能 | OrchestratorConsole.jsx + globals.css |
| T6 | 删全局 bottom-tool-dock | AICrewStudio.jsx |
| T7 | CSS：manual grid / canvas 填充 / dock / .is-manual / 响应式 | globals.css |

验证：`npm test` + `npm run build`。风险 L2。

## Phase 3: 变更日志

- **T1 mode 上提**：`OrchestratorConsole` 改受控（`mode` / `onModeChange` props），删内部 `useState("auto")`；`switchMode` 改为 `onModeChange(next)` + 重置内部 flow/route/phase/tool。`Workbench` 新增 `const [orchMode, setOrchMode] = useState("auto")`。
- **T2 手动双列重排**：手动分支独立 `if (mode === "manual") return ...`，左 `oc-manual-side`（modeBlock + ideaField + 对话 + 运行 + aiHint）/ 右 `oc-manual-stage`（FlowCanvas + 视频占位 + 操作坞）。共享片段提取为 `modeBlock`/`ideaField`/`aiHint` 常量，自动/半自动走原扁平返回路径（DOM 零改动，仅包无 DOM Fragment）。
- **T3 Workbench 重排**：`workbench-layout` 加 `is-manual` 类；手动时 OUTPUT 预览 + run-panel 条件不渲染（`{!isManual && (<>…</>)}`）。CSS `.workbench-layout.is-manual` 单列 `"compose"`。
- **T4 FlowCanvas 填充**：viewport(`oc-canvas`, flex:1/min-height:420px/去 280px 上限) + inner(`oc-canvas-inner`, 按节点坐标定尺寸) 分层；空态居中于 viewport。
- **T5 操作坞**：新 `oc-canvas-dock` + `OcDockButton`（选择/抓手/添加/撤销/重做）；选择/抓手=本地 `tool` 视觉态、添加=`focusChat()` 聚焦对话、撤销/重做=disabled（本轮无 flow 历史）。
- **T6 删全局 dock**：`FloatingCommandLayer` 移除 `bottom-tool-dock` JSX + 不再用的 `generating` prop；保留 right-tool-rail + zoom-dock。
- **T7 CSS**：manual grid（双列，1100px 以下堆叠）、canvas 填充、dock 样式、`.is-manual` 跨列、900px min-height 调整。

验证：`npm test` → 106/106 通过（含 invariant flow/canvas）；`npm run build` → 编译成功，TypeScript 通过，/workbench 静态生成。

## Phase 4: 审查结果

| 视角 | 结论 |
|------|------|
| 架构 | mode 干净上提；OrchestratorConsole 受控；唯一调用方 Workbench 已同步。✓ |
| 代码质量 | 共享片段提取无 JSX 重复；注释解释 WHY。✓ |
| 安全 | 纯前端布局，无新输入/密钥/边界。✓ |
| 性能 | 无新订阅/计算；条件渲染减少手动模式 DOM。✓ |
| 测试覆盖 | invariant 回归绿；布局为视觉项，与现有测试策略一致（仓库无组件测试），风险 L2。✓ |
| 第6视角 集成连续性 | **P1（已解决）**：手动运行 Director 后 OUTPUT + Runtime 于画布下方整宽显现（见 T8）。默认仍无 OUTPUT（画布为主区），运行后才出，切模式复位。 |

### P1 解决（T8）
- **手动模式运行结果可见性**：Workbench 加 `manualResultShown` 状态，包 `handleRunFlow`（手动运行完成置真）+ `handleModeChange`（切模式复位）。手动运行后 `.workbench-layout.is-manual.manual-result` 切 3 行（compose/canvas/run），OUTPUT + Runtime 整宽显现于画布下方。**不切模式、不重置 flow、最小惊扰**；非手动模式 OUTPUT 始终在，标记无副作用。
- 验证：`npm run build` 通过、`npm test` 121/121。

### 后续（非阻塞）
- **死 CSS**：`.bottom-tool-dock` 系列规则随 JSX 移除已无元素命中（无害），可在后续清理时一并删除。

## Phase 5: 复利记录

- 经验：app-shell 级全局组件（FloatingCommandLayer）要按子组件局部状态（orchestrator mode）门控时，正解是把状态上提到共同祖先（Workbench）或把控件迁移到状态所在组件——本次用「迁移操作栏进手动面板 + 上提 mode」双管，比给全局组件灌 mode 更内聚。
- 不变量沿用 [[2026-06-22-orchestration-three-modes]]：呈现层改动不得碰 Flow/flowToSkill/执行管线；自动/半自动布局保持零改动。
- 关联记忆更新：[[aicrew-flow-orchestration]] 增手动模式布局契约。

