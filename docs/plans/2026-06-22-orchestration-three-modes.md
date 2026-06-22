---
title: "三模式 AI 工作流编排 · 一个 Flow，三种创作方式"
type: design
status: proposed
created: "2026-06-22"
updated: "2026-06-22"
tags: [design, orchestration, flow, scifi-ui, workbench]
aliases: ["orchestration-three-modes", "三模式编排", "Flow 编排"]

related:
  - "[[2026-06-22-aicrew-scifi-ui]]"
  - "[[2026-06-22-canvas-toolbar]]"
  - "[[2026-06-22-ai-platform-integration]]"

scope: "在 AICrew Studio 中落地自动 / 半自动 / 手动三种 AI 工作流编排模式，共享同一 Flow 编排图抽象，统一科幻视觉语言。"
implementation_status: "底层 src/flow/* 已实现并通过单测；本文档定义产品形态、交互与 UI 落地方案。"
---

# 三模式 AI 工作流编排

> **一句话**：自动、半自动、手动三种创作方式，最终都在生成**同一张 Flow 编排图**——区别只在「谁来搭这张图、用户握有多少控制权」。控制权越多，自由度越高，算力越贵。

---

## 1. 概述与核心洞察

### 1.1 问题

AICrew Studio 已经有 9 个 Agent（brief → strategy → script → storyboard → visual → video → copy → qa → export）和 5 条预设流水线（`skills[]`）。但当前 `Workbench` 只暴露**一种**创作方式：填表单 → 选一条预设 skill → 一键生成。这对三类人都不合适：

- **小白 / 急用的人**：连选 skill 都嫌多，只想"说一句话就出片"。
- **运营 / 进阶用户**：预设链多一步少一步都不顺手，想增删几个 Agent、调下顺序。
- **重度创作者 / 工作室**：要像导演一样精确控制每个 Agent 的进出与连接，甚至分支。

一刀切的表单满足不了这三层人。但**为每层人各写一套独立引擎**又会产生三套评分、三套导出、三套计费——不可维护。

### 1.2 核心洞察

> 三种编排模式不是三个产品，而是**同一个 Flow 编排图的三种搭建方式**。

`Flow` = 一张以 domain agent 为节点的**有向无环图（DAG）**。预设 `skill.agents`（如 `["brief","strategy","script",...]`）只是 Flow 的**退化形态**——一条没有分支的线性链。三种模式只是回答「这张图由谁来搭」：

| 谁搭图 | 怎么搭 | 产物 |
|--------|--------|------|
| 中枢自动搭 | 从一句创意推断（`routeIdeaToFlow`） | 线性 Flow |
| 用户在中枢建议上微调 | 勾选增删 + 拖拽排序（`toggleAgent` / `reorderNode`） | 线性 Flow |
| 用户对话逐节点绘制 | 命令式 mutate（`addNode` / `connect` / ...） | 可分支 DAG Flow |

所有 Flow 最终都通过**唯一一座桥** `flowToSkill(flow)` 物化成 domain 认得的「合成 skill」，再交给**同一条执行管线** `runCreativeWorkflowWithSkill`。于是：

- 评分、QA、导出、事件、计费口径 **三模式完全一致**；
- 前端所有 task 视图（variant tabs、QA 遥测、Agent 执行记录）**零改动复用**；
- 加一个新模式 = 加一种"搭图 UI"，不碰执行层。

### 1.3 关系图（ASCII）

```
                       一句创意 / 用户意图
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   ╔═════════╗          ╔═══════════╗         ╔═══════════╗
   ║  自动   ║          ║  半自动   ║         ║   手动    ║
   ║Autopilot║          ║ Co-Pilot  ║         ║ Director  ║
   ╠═════════╣          ╠═══════════╣         ╠═══════════╣
   ║中枢推断 ║          ║中枢建议   ║         ║对话逐节点 ║
   ║整条链   ║          ║+用户勾选  ║         ║绘制(可分支)║
   ║         ║          ║+拖拽微调  ║         ║           ║
   ╚════╤════╝          ╚═════╤═════╝         ╚═════╤═════╝
        │                     │                     │
   routeIdeaToFlow      toggleAgent /          addNode / connect /
        │               reorderNode                 disconnect
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │   Flow  { mode, nodes, edges } │   ← 统一编排图
              │   一张以 agent 为节点的 DAG    │
              └───────────────┬───────────────┘
                              │ orderedAgentIds() 拓扑展平
                              ▼
                    flowToSkill(flow)          ← 唯一的桥
                              │
                              ▼
              runCreativeWorkflowWithSkill()   ← 唯一执行管线
                              │
                              ▼
              ┌───────────────────────────────┐
              │  task: 评分 / QA / 变体 /       │
              │  事件 / 导出 / 计费             │   ← 三模式同构
              └───────────────────────────────┘
```

**这就是整个设计的支点**：上半部分三条分叉是"创作方式"，下半部分单一汇流是"执行真相"。文档其余章节都围绕这张图展开。

---

## 2. 三模式对比

| 维度 | 自动 / Autopilot | 半自动 / Co-Pilot | 手动 / Director |
|------|------------------|-------------------|-----------------|
| **中文名** | 中枢自动驾驶 | 协同编排 | 导演台 |
| **用户角色** | 下单的人 | 副驾 | 导演 |
| **中枢角色** | 全权驾驶 | 出方案的参谋 | 听指令的执行手 |
| **控制权** | 最低（只给创意） | 中（勾选 + 排序） | 最高（逐节点 + 连线） |
| **交互范式** | 一句话输入框 + 思考动画 | 创意 + 可勾选的 Agent 芯片墙 + 拖拽条 | 左对话栏 + 右流程画布 |
| **Flow 形态** | 线性链（中枢生成） | 线性链（用户微调） | 可分支 DAG（用户绘制） |
| **自由度** | ★☆☆ | ★★☆ | ★★★ |
| **上手成本** | 极低 | 低 | 中高 |
| **出活速度** | 最快 | 中 | 最慢（换来精确） |
| **算力成本档** | 最低（中枢倾向最短可用链） | 中（用户可能加重 Agent） | 最高（链路最长、含探索/反复） |
| **计费档位隐喻** | 经济舱 · 自动巡航 | 商务舱 · 副驾协同 | 头等舱 · 全手动操纵 |
| **适用人群** | 新手、批量出稿、急用 | 运营、进阶创作者 | 工作室、重度玩家、定制需求 |
| **视频支持** | ✅（按平台推断） | ✅ | MVP 暂不做，UI 提示"未来支持" |

> **计费定性原则**：成本只跟"实际跑了哪些 Agent"走（`estimateFlowCredits` = Σ 节点 agent.cost × 平台倍率），与模式标签无关。但因为高自由度模式倾向于编排更长、更重（含 `video` / `visual`）的链路，**统计上**自由度越高越贵——这是行为导致的结果，不是对模式额外加价。三档"经济/商务/头等"是**呈现层的隐喻**，让用户对成本有直觉，不是独立的价目表。

---

## 3. 统一 Flow 数据模型

> 实现位于 `src/flow/model.js`，纯函数、不可变、无 DOM 依赖，可在 `node --test` 下完整验证。设计纪律对齐 `src/canvas/model.js`：所有变更返回新对象，绝不原地修改。

### 3.1 数据结构

```js
Flow = {
  id:    string,                 // "flow_..."
  mode:  "auto" | "semi" | "manual",
  brief: Brief | null,           // 归一化创意（parseBriefText 产出）
  nodes: Node[],                 // 图的节点
  edges: Edge[]                  // 图的有向边
}

Node = {
  id:      string,               // "node_..."
  agentId: string,               // 必须是 9 个 domain agent 之一
  x, y:    number,               // 手动画布上的世界坐标（自动/半自动可忽略）
  status:  "idle" | "running" | "done" | "error"   // 驱动节点脉冲动画
}

Edge = {
  id:   string,                  // "edge_..."
  from: string,                  // 源 node.id
  to:   string                   // 目标 node.id
}
```

### 3.2 字段说明

| 字段 | 作用 | 谁写它 |
|------|------|--------|
| `mode` | 标记搭图方式，影响 UI 渲染与默认行为；执行层不关心 | 创建 Flow 时定 |
| `brief` | 归一化创意，供执行管线取平台/卖点/受众 | 自动模式由 router 填；其余可后补 |
| `nodes[].agentId` | 指向 domain agent，决定该步算力/产物/成本 | 三模式各自的搭图动作 |
| `nodes[].x/y` | 仅手动画布需要（节点落点），自动/半自动是占位 | `defaultPosition` / 拖拽 |
| `nodes[].status` | 运行时状态，驱动节点点亮/脉冲/报错动画 | 执行器回写 |
| `edges` | 节点先后/依赖关系；**线性链可省略 edges**，由节点顺序隐含 | 半自动重建/手动连线 |

### 3.3 核心函数清单（已实现）

| 函数 | 职责 | 主要服务的模式 |
|------|------|----------------|
| `createFlow(mode, brief)` | 建空 Flow，非法 mode 抛错 | 全部 |
| `linearFlow(agentIds, mode, brief)` | 由有序 id 列表建线性链（A→B→C） | 自动 / 半自动 |
| `addNode` / `removeNode` | 增删节点（删时连带清理悬空 edge） | 手动 |
| `toggleAgent(flow, agentId)` | 已在图则移除、否则追加（线性链自动接尾） | 半自动 |
| `reorderNode(flow, from, to)` | 拖拽换序并重建线性连线 | 半自动 |
| `connect(flow, from, to)` | 连线，拒绝自环/重复边/成环（返回 `{ok, reason}`） | 手动 |
| `disconnect(flow, edgeId)` | 删边 | 手动 |
| `moveNode` / `setNodeStatus` | 改节点坐标 / 运行状态 | 手动 / 执行 |
| `orderedAgentIds(flow)` | **Kahn 拓扑排序**展平成线性执行序（无边→节点顺序；有环→兜底节点顺序） | 全部（执行前） |
| `validateFlow(flow)` | 校验可执行性（非空、agent 已知、无环），返回 `{valid, errors}` | 全部 |
| `isVideoFlow(flow)` | 图里有没有 `video` 节点 → 决定交付物形态 | 全部 |
| `estimateFlowCredits(flow, platform)` | Σ 节点 agent.cost × 平台倍率（与 domain 同口径） | 全部（报价） |
| `flowToSkill(flow, meta)` | **唯一的桥**：把 Flow 物化成 domain 合成 skill | 全部（执行前） |
| `sanitizeFlow(raw)` | 反序列化边界防御（丢弃非法节点/悬空边） | 持久化复原 |

### 3.4 为什么 skill 是 Flow 的退化形态

预设 skill 的核心字段就是 `skill.agents`——一个**有序的 agent id 列表**。把它喂给 `linearFlow(skill.agents)` 就得到一张**没有分支、edges 完全由顺序隐含**的线性 Flow。反过来，`flowToSkill(flow)` 又能把任意 Flow（先 `orderedAgentIds` 拓扑展平）还原成一个 `{agents:[...]}` 的合成 skill。

```
  预设 skill                          Flow（线性退化）
  { agents:                          nodes: [brief]→[strategy]→[script]...
    ["brief","strategy",   ──────►   edges 由顺序隐含（可省略）
     "script", ...] }                mode: "auto" | "semi"
        ▲                                     │
        └──────── flowToSkill ◄───────────────┘
                  (orderedAgentIds 展平)
```

这意味着：**预设 skill 是 Flow 空间里的一个点，Flow 是 skill 的超集**。三模式不是在 skill 之外另起炉灶，而是让用户在更大的 Flow 空间里挑/搭/画。

### 3.5 三模式如何各自产出 Flow

```
自动：  ideaText ──routeIdeaToFlow──► linearFlow(matched.agents) ──► Flow(mode:auto)
半自动：建议 Flow ──toggleAgent / reorderNode 反复 mutate──────────► Flow(mode:semi)
手动：  空 Flow ──addNode / connect / disconnect 对话驱动 mutate──► Flow(mode:manual, 可含分支)
```

三条路径产出的 Flow 形状完全一致，因此下游 `flowToSkill → runCreativeWorkflowWithSkill` 不需要知道它来自哪种模式。

---

## 4. 每种模式的交互流程

> 视觉母题统一为「中枢（Orchestrator Core）= 星核」「Agent = 能量节点」「edge = 能量连线」。详见第 5 章视觉规范。

### 4.1 自动 / Autopilot — 中枢自动驾驶

**心智模型**：把创意丢进星核，看它自己点亮一条链，然后出片。

**分步流程：**

| 步骤 | 用户动作 | 系统动作 / 调用 |
|------|----------|-----------------|
| 1 | 在一句话输入框写下创意，回车 | — |
| 2 | （等待） | `routeIdeaToFlow(ideaText, "auto")` → `{flow, brief, matchedSkill, rationale, summary}` |
| 3 | 看"中枢思考"动画 | 按 `rationale[]` 逐条点亮节点：每条 `{agentId, title, reason}` 让对应节点亮起 + 弹出理由气泡 |
| 4 | 看到完整链 + summary | 渲染 `flow.nodes` 成横向能量链；显示 `estimateFlowCredits` 报价 |
| 5 | 点"运行" | `runFlow({brief, flow})`（或 `runFlowWithAI` 若已配 AI）→ task |
| 6 | 看结果 | 复用现有 variant / QA / 导出视图 |

**ASCII 线框：**

```
┌──────────────────────────────────────────────────────────────┐
│  ◈ AUTOPILOT · 中枢自动驾驶                        credits ◷42 │
│                                                                │
│   ┌────────────────────────────────────────────────────────┐  │
│   │  ▸ 给小红书写一篇露营柔光灯的种草笔记…              ⏎ │  │  ← 一句话输入
│   └────────────────────────────────────────────────────────┘  │
│                                                                │
│              中枢识别为「小红书 · 图文」，匹配「种草笔记」     │  ← summary
│                                                                │
│        ✦ brief ──→ ✦ strategy ──→ ◌ visual ──→ ◌ copy ...     │  ← 逐节点点亮
│        └ 锁定受众  └ 定角度…    （正在思考…脉冲）              │     (rationale 气泡)
│                          ◉ 星核 ◉                              │  ← 中枢核心
│                                                                │
│                       [ ⚡ 运行编排 ]                          │
└──────────────────────────────────────────────────────────────┘
```

**关键点**：用户全程只输入一次。`rationale` 不是日志，它是**动画脚本**——逐条点亮节点让"中枢在思考"这件事可见、可解释、可信任。

### 4.2 半自动 / Co-Pilot — 协同编排

**心智模型**：中枢先给一版，我勾掉不要的、补上想要的、把顺序捋顺，再跑。

> **这是用户拍板的方案：双层 = 勾选为主 + 拖拽微调**。完整的节点连线/分支留给模式 3，半自动**不做**自由连线，只在线性链上增删与换序——这是刻意的复杂度控制。

**分步流程：**

| 步骤 | 用户动作 | 系统动作 / 调用 |
|------|----------|-----------------|
| 1 | 写创意 | `routeIdeaToFlow(ideaText, "semi")` → 建议 Flow + rationale |
| 2 | 看建议链 | 渲染为"已选 Agent 链"（线性） |
| 3 | 在 Agent 芯片墙勾选增减 | 每次点击 → `toggleAgent(flow, agentId)` → `{flow, added}`；移除连带清边，追加自动接尾保持单链 |
| 4 | 拖拽链上节点换序 | `reorderNode(flow, fromIndex, toIndex)` → 按新序重建线性连线 |
| 5 | 看实时报价随增删变化 | 每次 mutate 后 `estimateFlowCredits(flow, platform)` |
| 6 | 点"运行" | `validateFlow` → `runFlow` / `runFlowWithAI` |

**ASCII 线框：**

```
┌──────────────────────────────────────────────────────────────┐
│  ◈ CO-PILOT · 协同编排                            credits ◷78 │
│                                                                │
│  ▸ 创意：露营柔光灯 TikTok 广告                                │
│                                                                │
│  当前编排（拖拽 ⠿ 调序）：                                     │
│   ┌────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌────┐            │
│   │⠿brief│→ │⠿strat│→ │⠿script│→ │⠿visual│→ │⠿qa │  …         │  ← 可拖拽线性链
│   └────┘   └──────┘   └──────┘   └──────┘   └────┘            │
│                                                                │
│  Agent 库（点击 ✓ 增减）：                                     │
│   [✓brief][✓strategy][✓script][ storyboard][✓visual]          │  ← 芯片墙 toggleAgent
│   [ video][✓copy][✓qa][ export]                               │     (✓=已在链中)
│                                                                │
│                       [ ⚡ 运行编排 ]                          │
└──────────────────────────────────────────────────────────────┘
```

**关键点**：勾选是主操作（低风险、零学习成本），拖拽是微调（线性内换序）。`toggleAgent` 的"线性链自动接尾"保证用户永远不需要手动连线，链始终是一条干净的单链。

### 4.3 手动 / Director — 导演台 · 对话编排

**心智模型**：RoboNeo 风格——我跟中枢对话，它在画布上按我说的画流程图。

**布局**：左对话栏 + 右流程画布（复用 canvas 层的无限画布交互范式）。

**分步流程：**

| 步骤 | 用户对话指令（示例） | 解析后的系统动作 |
|------|---------------------|------------------|
| 1 | "加一个分镜 agent" | `addNode(flow, "storyboard")` → 画布出现新节点 |
| 2 | "把 QA 放最后" | 调整 QA 节点的连边，使其成为汇点 |
| 3 | "连 visual 到 copy" | `connect(flow, visualId, copyId)` → `{ok}`；成环则提示拒绝 |
| 4 | "删掉 script" | `removeNode(flow, scriptId)`（连带清边） |
| 5 | "断开 brief 到 strategy" | `disconnect(flow, edgeId)` |
| 6 | "跑起来" | `validateFlow` → `runFlow`；节点 `status` 实时回写驱动脉冲 |

每条指令 mutate 编排图后，画布上的节点**点亮 / 连线 / 高亮**给出即时反馈；非法指令（成环、连不存在的节点）在对话栏回一句人话错误（来自 `connect` 的 `reason`）。

**ASCII 线框：**

```
┌───────────────────────┬──────────────────────────────────────┐
│  ◈ DIRECTOR · 导演台   │   流程画布（无限缩放/平移）           │
│                       │                                        │
│  ▸ 你：加一个分镜      │        ┌──────┐                        │
│  ◉ 中枢：已加 storyboard│       │ brief│                        │
│                       │        └───┬──┘                        │
│  ▸ 你：连 visual 到 copy│           ▼                           │
│  ◉ 中枢：已连接 ✓      │        ┌────────┐    ┌──────┐          │
│                       │        │strategy│    │visual│──┐       │
│  ▸ 你：把 QA 放最后    │        └───┬────┘    └──────┘  │       │
│  ◉ 中枢：QA 已设为汇点 │            ▼              ┌─────▼┐      │
│                       │        ┌────────┐        │ copy │      │
│  ┌───────────────────┐│        │storybd │        └───┬──┘      │
│  │ 说点什么…       ⏎ ││        └────────┘            ▼          │
│  └───────────────────┘│                          ┌────┐        │
│                       │       〔视频节点 · 未来支持〕│ qa │      │  ← 灰显占位
│       ◉ 星核 ◉        │                          └────┘        │
└───────────────────────┴──────────────────────────────────────┘
```

**关键点**：
- 对话是**编排手段**，不是闲聊——每句话映射到一个 Flow mutation 函数。
- 画布执行时由 `orderedAgentIds`（Kahn 拓扑）把 DAG 展平成线性序再跑（见 §8.2 限制）。
- `video` 节点在 MVP 灰显占位，点击提示"未来支持"，不进 `validateFlow` 的可执行集。

---

## 5. 科幻视觉语言规范

> 复用并延续既有 "Neural Mission Control / RoboNeo Canvas" 设计系统（见 `[[2026-06-22-aicrew-scifi-ui]]`），不新起一套。本章给出可直接指导 CSS 实现的具体规范。

### 5.1 配色

```css
:root {
  /* 深空底 */
  --void-0:   #07090f;   /* 最深背景 */
  --void-1:   #0b0e17;   /* 面板底 */
  --void-2:   #121726;   /* 抬升面板 */
  --hairline: rgba(255,255,255,0.08);  /* 点阵 / 分隔线 */

  /* 中枢星核（霓虹主控） */
  --core-plasma: #6c5ce7;   /* 紫主动作（延续 RoboNeo 主色） */
  --core-glow:   #8b7bff;

  /* 文字 */
  --ink:     #f5f6fa;
  --muted:   #9aa6c8;   /* 正文遥测，≥AA 对比 */
  --muted-2: #5f6c8f;   /* 仅 placeholder */
}
```

**Agent accent 直接复用 domain 各 agent 的 `accent` 色**——节点颜色就是它的身份，三模式一致：

| agent | accent | agent | accent |
|-------|--------|-------|--------|
| brief | `#8bd3ff` | video | `#45e0c6` |
| strategy | `#f9c74f` | copy | `#ffb86b` |
| script | `#ff7a90` | qa | `#6ee7b7` |
| storyboard | `#b8f27b` | export | `#93c5fd` |
| visual | `#a78bfa` | | |

> 节点的发光（`box-shadow` / `filter: drop-shadow`）用 `color-mix(in srgb, var(--accent) 60%, transparent)`，让每个 Agent 自带光晕色，连线能量流也取首节点 accent。

### 5.2 视觉母题

| 母题 | 含义 | CSS 实现要点 |
|------|------|--------------|
| **深空点阵底** | 无限画布 | `background: radial-gradient(circle, var(--hairline) 1px, transparent 1px) 0 0/40px 40px`（延续 canvas `#canvas-grid`） |
| **中枢星核** | Orchestrator，三模式共同的中心 | 圆形多层 `radial-gradient` + 旋转 `conic-gradient` 光环 + 慢速 `@keyframes core-spin` |
| **能量节点** | 一个 Agent | 圆角胶囊 / 六边形，描边 = accent，`idle` 暗、`running` 脉冲、`done` 实心、`error` 红闪 |
| **能量连线** | edge / 执行先后 | SVG `path` + `stroke-dasharray` 流动（`@keyframes flow-dash`），方向用 `marker-end` 箭头（复用 canvas `#canvas-arrow`） |
| **粒子** | 数据在链上流动 | 沿 path 的小圆点 `offset-path` 动画，低密度，`prefers-reduced-motion` 下隐藏 |
| **扫描线 / 噪点** | HUD 质感叠层 | 全屏 `::after` 固定层 `z-index:0; pointer-events:none`（已有约定） |
| **能量焦点环** | 选中 / hover | 双层环 `outline` + `box-shadow`，`:focus-visible` 覆盖 active glow（既有 a11y 修复约定） |

### 5.3 动效

| 场景 | 动效 | 实现 |
|------|------|------|
| **中枢思考（自动模式）** | 节点按 rationale 顺序逐个点亮，每个点亮时弹理由气泡 | JS 驱动逐节点加 `.is-lit` class，延迟 ≈ 220ms 步进；CSS `transition: filter/opacity` + 气泡 `@keyframes fade-rise` |
| **连线能量流动** | dash 沿连线方向滚动 | `stroke-dasharray: 6 8; animation: flow-dash 1.2s linear infinite`（`stroke-dashoffset` 递减） |
| **运行时节点脉冲** | `running` 节点呼吸光晕 | `@keyframes node-pulse`（已有）作用于 `box-shadow` / `transform: scale(1↔1.04)` |
| **节点完成** | 一次性闪光后转实心 | `@keyframes node-settle`，`animation-fill-mode: forwards` |
| **报错** | accent 切红 + 抖动 | `@keyframes node-error-shake`，短促 |
| **模式切换** | "档位"推拉感（见 §5.4） | 切 tab 时整块画布 `transform: scale + blur` 微过渡 |

**降级**：全部装饰动画统一收口到 `@media (prefers-reduced-motion: reduce){ *,*::before,*::after { animation: none !important; transition: none !important } }`（既有项目约定）。`background-clip:text` 渐变文字必须配 `@supports not (...)` fallback。

### 5.4 模式切换的"档位"隐喻

三模式切换器做成**档位推杆 / 三段式开关**，强化"控制权 = 油门"的直觉：

```
  自动 ─────●──────── 半自动 ──────────── 手动
  Autopilot      Co-Pilot           Director
  ◷ 经济舱        ◷ 商务舱            ◷ 头等舱
  自由度 ★        自由度 ★★           自由度 ★★★
```

- 推杆滑到某档 → 该档配色饱和度 / 星核光环转速 / 画布元素密度递增（自动最简、手动最满）。
- 档位旁实时显示 `estimateFlowCredits` 报价随档位/编排变化，让"自由度越高越贵"可见。
- 推杆用 CSS `transition: transform var(--ease-out)`，配一声轻微 HUD 音效（可选，尊重静音）。

---

## 6. 接入现有系统

### 6.1 与现有 Workbench 的关系

当前 `Workbench`（`src/AICrewStudio.jsx`）是「brief 表单 + skill 下拉 + 一键 `generateFromBrief`」。三模式编排是它的**超集**，落地策略：

**方案（推荐）**：在 Workbench 顶部加**三档模式切换器**，下方区域按档位渲染对应搭图 UI；现有表单作为"半自动"的高级折叠项保留（不浪费已有结构）。

| 现有 | 替换 / 增强 |
|------|-------------|
| 一句话 quick 表单（`generateQuick`） | → **自动模式**的创意输入框（接 `routeIdeaToFlow`） |
| brief 表单 + skill 下拉（`generateFromBrief`） | → **半自动模式**：skill 下拉变成"建议 Flow 起点"，下方加 Agent 芯片墙 + 拖拽链 |
| （无） | → **手动模式**：新增 `OrchestrationCanvas`（左对话 + 右画布） |
| `run-panel` Agent 执行记录 | **保留**，三模式运行后都回写到这里（task.events 不变） |
| variant tabs / QA 遥测 / 导出 | **零改动**——执行产物同构 |

**执行入口对齐**：现有 `runAndCommit(brief, skillId, ...)` 走 `runCreativeWorkflow`/`runCreativeWorkflowWithAI(skillId)`。三模式改为走 `runFlow({brief, flow})` / `runFlowWithAI({brief, flow})`，内部 `flowToSkill(flow)` 产出合成 skill，再进**同一个** `runCreativeWorkflowWithSkill`。`commitGeneratedTask` 逻辑（扣费、通知、选中首 variant）完全复用。

> AI 增强已就绪：`runCreativeWorkflowWithAI` 已支持传 `skill` 对象（Flow 合成）而非 `skillId`（见 `src/ai/workflow.js` L86-90 注释"传 skill 对象走自定义编排"）。三模式与 AI 层零摩擦对接。

### 6.2 与 canvas 层的关系

手动模式的右侧流程画布**复用 canvas 层的交互范式**（无限缩放/平移、pointer 手势、draft/commit 一手势一历史、句柄命中），但**不复用 canvas 的图元模型**——节点是 Agent（`flow/model.js`），不是矩形/图片（`canvas/model.js`）。两者：

- 共享：viewport（`screenToWorld`/`panBy`/`zoomBy`）、history（`commit`/`undo`/`redo`）、手势骨架（gestureRef + draft）。
- 隔离：渲染层不同（Agent 节点 vs 画布图元），存储 key 不同。

> 设计纪律一致：Flow mutation 全部返回新对象（对齐 canvas/model.js 的不可变约定），可直接接 `createHistory`/`commit` 得到撤销/重做。

### 6.3 与 AI 层的关系

```
Flow ──flowToSkill──► 合成 skill ──┬─► runCreativeWorkflowWithSkill   （确定性，离线可跑）
                                   └─► runCreativeWorkflowWithAI(skill) （叠加真实 LLM 文案/封面）
```

- 自动模式的 `routeIdeaToFlow` 是**纯启发式**（无 LLM 调用、确定性、离线可跑）——这是刻意的（见 §8.1）。
- AI 仅在**执行阶段**介入（文案/封面增强），不参与搭图；搭图永远确定性可复现。
- 无系统 AI 配置 → `runFlowWithAI` 自动回退确定性结果，与预设 skill 行为一致。

### 6.4 计费

`estimateFlowCredits(flow, platform)` 与 `domain.estimateCreditsForSkill` **同口径**（成本只跟跑了哪些 agent 走）。三模式报价用同一函数，差异只来自用户编排出的链路本身。运行扣费走现有 `commitGeneratedTask` 的 `task.credits.actual`，不新增计费路径。

### 6.5 localStorage 持久化

延续 canvas 层"独立 storage key + 反序列化边界防御"模式：

```js
const FLOW_STORAGE_KEY = "aicrew-flow-v1";   // 与 canvas 的 "aicrew-canvas-v1" 隔离

// 存：仅持久化已提交现态
localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flow));

// 取：绝不信任反序列化数据
const flow = sanitizeFlow(JSON.parse(raw));  // 丢弃非法节点 / 悬空边，mode 非法→null
```

`sanitizeFlow` 已实现：校验 `mode` 合法、过滤非 `isValidNode` 的节点、丢弃端点不存在的边、缺 id 时补发。配额溢出时降级提示用户（不静默丢失），对齐 canvas 的 notice 约定。

---

## 7. MVP 范围 vs 未来

### 7.1 本轮 MVP 做什么

- [x] **底层 Flow 引擎**（`src/flow/model.js` / `router.js` / `execute.js`）——已实现并通过单测。
- [ ] **三模式可跑通**：每种模式都能产出 Flow → `runFlow` → 出 task（复用现有产物视图）。
- [ ] **科幻 UI 落地**：三档切换器 + 星核 + 能量节点/连线 + 中枢思考动画，达到既有设计系统的质感。
- [ ] **对话引擎"能演示"级**：手动模式的 NL 解析用**命令式解析器**（关键词 + 槽位），覆盖"加/删/连/断/调序/运行"等核心指令，足以演示，不追求自然语言全覆盖（见 §8.1）。
- [ ] **持久化**：Flow 入独立 localStorage key，`sanitizeFlow` 复原。

### 7.2 未来迭代

| 方向 | 说明 |
|------|------|
| **视频节点** | 手动模式解锁 `video` 节点（MVP 灰显占位），打通视频交付物形态。 |
| **真分支 DAG 执行** | 当前展平为线性执行（§8.2）；未来支持并行分支、条件分叉、扇入扇出的真并发执行。 |
| **LLM 驱动的对话编排** | 把命令式解析器升级为 LLM 意图解析，支持"帮我搭一个适合美妆种草的流程"这类高层指令直接生成子图。 |
| **协作编排** | 多人实时共编同一 Flow（光标 / 节点锁 / CRDT），把导演台变成"作战室"。 |
| **Flow 另存为 skill** | 手动搭的好编排一键 `flowToSkill` 存成团队预设，反哺 `skills[]`（闭环：Flow→skill→下次自动模式可匹配）。 |
| **节点级参数** | 单个 Agent 节点暴露可调参数（如 script 的脚本数、visual 的风格），从"编排"深入到"调参"。 |

---

## 8. 风险与权衡

### 8.1 对话编排：命令式解析器 vs 完整 LLM

**取舍**：MVP 手动模式用**命令式 NL 解析器**（关键词匹配 + Agent 名/同义词槽位 + 动作动词），而非完整 LLM 驱动。

| | 命令式解析器（选） | 完整 LLM（暂不选） |
|---|---|---|
| 确定性 | ✅ 可复现、可单测、离线可跑 | ❌ 不确定、难测 |
| 延迟/成本 | ✅ 零延迟、零 API 成本 | ❌ 每条指令一次调用 |
| 表达力 | ⚠️ 受限于预设指令模板 | ✅ 自然语言全覆盖 |
| 演示效果 | ✅ 足够演示核心编排动作 | ✅ 更惊艳 |

**结论**：与 `routeIdeaToFlow` 保持确定性同源——搭图过程必须可复现可测，把"惊艳但不可控"的 LLM 留到 §7.2 升级，且只增量叠加（命令式解析器作为兜底/离线路径保留）。**缓解**：解析失败时对话栏回一句人话引导（"试试'加一个 visual'或'连 A 到 B'"），降低用户挫败感。

### 8.2 DAG 执行展平为线性的限制

**现状**：`orderedAgentIds` 用 Kahn 拓扑排序把 DAG **展平成一条线性执行序**再交给 `runCreativeWorkflowWithSkill`（它只认线性 `skill.agents`）。

**含义/限制**：
- 手动模式画的分支（如 visual 和 script 并行）在执行时被**串行化**——执行结果正确（拓扑序保证依赖满足），但**没有真正的并发/并行收益**。
- 同层节点的相对顺序由"节点声明顺序"稳定排序决定（输出可预测），但用户对"并行"的视觉预期与"串行执行"的现实有落差。
- 有环时 `orderedAgentIds` 兜底退回节点顺序，且 `validateFlow` 会拦截（"流程存在环，无法确定执行顺序"），不会跑出错乱结果。

**缓解**：
- MVP UI 上对"分支"诚实标注——画布允许画分支（表达依赖关系），但提示"执行将按拓扑顺序串行进行"。
- 真并行执行列入 §7.2，届时执行层从"线性 skill"升级为"DAG runner"，`flowToSkill` 的桥接策略相应演进（可能输出执行计划而非线性 agents 列表）。

---

## 附录：关键文件索引

| 文件 | 角色 |
|------|------|
| `src/flow/model.js` | Flow 不可变模型 + 全部 mutation/校验/展平/物化函数 |
| `src/flow/router.js` | `routeIdeaToFlow`——自动模式的大脑（启发式，确定性） |
| `src/flow/execute.js` | `runFlow` / `runFlowWithAI`——校验+物化+委托执行 |
| `src/domain.js` | 9 个 agent、5 条预设 skill、`runCreativeWorkflowWithSkill` 执行管线 |
| `src/ai/workflow.js` | `runCreativeWorkflowWithAI`——已支持传 Flow 合成 skill |
| `src/canvas/*` | 无限画布交互范式（手动模式画布的复用来源） |
| `src/AICrewStudio.jsx` | `Workbench` 视图（三模式切换器的落点） |
| `docs/plans/2026-06-22-aicrew-scifi-ui.md` | 既有科幻设计系统（本文档视觉规范的延续基准） |
