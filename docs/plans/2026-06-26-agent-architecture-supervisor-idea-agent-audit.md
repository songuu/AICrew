---
title: "Agent 架构调研：Supervisor 与想法 Agent 编排"
type: audit
status: completed
created: "2026-06-26"
updated: "2026-06-26"
tags: [audit, agent-architecture, supervisor, orchestration, flow]
aliases: ["agent architecture supervisor audit", "想法 agent 编排审查"]
scope: "研究当前 AICrew 的整体 agent 架构，重点评估 supervisor 的设置/编写，以及想法 agent 的编排和设置是否合理。"
---

# Agent 架构调研：Supervisor 与想法 Agent 编排

## 结论摘要

当前架构的核心方向是合理的：`Flow -> flowToSkill -> runCreativeWorkflowWithSkill/runCreativeWorkflowWithAI` 是一个干净的控制面，自动 / 半自动 / 手动三种入口都汇入同一执行契约，避免了三套执行引擎分叉。

但当前并没有一个真正意义上的独立 `Supervisor Agent`。代码里的 supervisor 能力分散在三处：

- `lib/flow/router.js` 的 deterministic Orchestrator Router：负责“想法文本 -> Skill/Flow”。
- `components/OrchestratorConsole.jsx`：负责三模式 UI、参数收敛、触发运行。
- `lib/domain.js` 的 `orchestratorAgent`：主要是 task 上的元数据展示，并不是运行时调度器。

因此，如果目标是“产品演示级的可解释编排”，当前方案够用；如果目标是“真实 supervisor 负责规划、约束、评估、恢复、路由每个 agent”，当前实现还偏弱，建议补一个显式 `supervisor` 层。

## 已验证事实

### 1. 统一控制面成立

- Flow 模型明确声明：三种模式都产出同一张有向无环图，自动 / 半自动是线性链，手动可以是 DAG，执行时经 `orderedAgentIds` 展平。（`lib/flow/model.js:1-12`）
- `flowToSkill` 是唯一桥：把 Flow 物化成 domain 可执行的合成 skill。（`lib/flow/model.js:292-320`）
- `runFlow` / `runFlowWithAI` 只做校验、物化 skill、委托 domain/AI 管线。（`lib/flow/execute.js:1-50`）
- UI 侧 `runFlowAndCommit` 与旧 `runAndCommit` 共用同一套扣费、提交、项目/导出写入逻辑。（`components/AICrewStudio.jsx:621-741`）

判断：这部分设计健康，是当前架构最稳的地方。

### 2. 自动“想法 agent”本质是启发式 router，不是真 agent

- `routeIdeaToFlow` 纯函数、无 LLM 调用，按关键词识别媒介意图，并对 `skills[]` 打分排序。（`lib/flow/router.js:1-8`, `lib/flow/router.js:72-98`）
- 打分维度主要是 skill 名称/品类、视频/图文意图、平台默认媒介。（`lib/flow/router.js:26-43`）
- 模糊输入时直接回退第一个预设 skill，保证始终有可运行方案。（`lib/flow/router.js:76-82`）
- 测试覆盖了小红书图文、抖音视频、模糊输入仍 runnable。（`tests/flow.test.js:193-212`）

判断：作为 MVP/演示的 idea router 合理；作为“想法 agent”偏浅，因为它不产出假设、置信度、缺失信息、备选方案，也不基于素材/受众/品牌记忆做深度规划。

### 3. Supervisor 元数据存在，但不是实际 supervisor

- `orchestratorAgent` 定义了“总控调度”的责任、工具、评价和重试策略。（`lib/domain.js:185-195`）
- task plan 阶段会写入 `orchestrator: buildOrchestratorRecord(...)`。（`lib/domain.js:1351-1378`）
- 真正执行由 `driveCreativeTask` 顺序跑 `skill.agents`，失败后下游保持 queued，task 落 failed。（`lib/domain.js:1412-1480`）

判断：`orchestratorAgent` 更像“运行记录卡/展示用角色”，不掌握策略选择，也不实时监督 agent 输出质量。

### 4. AI agent 编排已经部分 agent 化，但与 domain runner 仍是两层

- AI 层有 `AGENT_EXECUTOR_REGISTRY`：`trend/persona/seo/copy/visual` 对应真实执行器。（`lib/ai/workflow.js:560-566`）
- `trend/persona/seo` 是结构化 pre-pass，失败回退为泛指令，不抛错。（`lib/ai/workflow.js:250-264`）
- copy agent 并发生成每个 variant 的文案，visual agent 并发生成图片。（`lib/ai/workflow.js:500-557`）
- AI 执行结果写入 `aiMeta.agentExecutions`，并能把失败映射回 agent 状态。（`lib/ai/workflow.js:574-599`, `lib/ai/workflow.js:639-680`）
- 但 AI 层先调用 domain 同步产出 base task，再 post-hoc 增强；不是把每个 AI executor 接进 `driveCreativeTask` 的 executor seam。（`lib/ai/workflow.js:601-605`）

判断：AI 编排方向正确，但“domain agent 生命周期”和“AI executor 生命周期”还没有完全合并。现在会出现两套执行叙事：domain events 说一条，`aiMeta.agentExecutions` 说另一条。

### 5. 手动导演台的 LLM/正则双路可用，但新 agent alias 不完整

- `resolveDirectorCommand` 优先 LLM 意图分类，失败时回退正则解析。（`lib/flow/director.js:102-114`）
- LLM intent 白名单来自 `agents`，只排除 `video`，因此理论上支持新 agent。（`lib/flow/intent.js:9-23`）
- 正则 alias 只覆盖 `brief/strategy/script/storyboard/visual/video/copy/qa/export`，未覆盖 `hook/trend/persona/seo` 的中文短称。（`lib/flow/director.js:12-22`）

判断：有 AI 配置时导演台可编排新 agent；无 AI 配置或 LLM 失败时，“加趋势 / 加人设 / 加钩子”这类中文短指令容易识别失败。这里是 P1 体验缺口。

## 主要风险

### P1: Supervisor 名义大于实际能力

当前 UI/文案叫 Orchestrator/中枢，但代码里的 supervisor 不是一个集中规划者。它不会产出可审计计划、不会复核 agent 输出、不会基于失败重规划。用户会以为“中枢很聪明”，实际自动模式是启发式 skill 匹配。

建议：要么把当前能力命名为 `router/orchestrator router`，避免过度承诺；要么新增显式 supervisor 层。

### P1: 新 agent 的解释链不足

`reasonFor` 只覆盖旧核心 agent：`brief/strategy/script/storyboard/visual/video/copy/qa/export`。`trend/persona/seo/hook` 会落到泛化理由“执行该编排步骤”，削弱自动模式“中枢为什么这么编排”的可信度。

建议：补齐所有 agent 的 rationale，并加测试确保任一 `skills[].agents` 都有非泛化解释。

### P1: 手动导演台 fallback 没跟上 agent 扩容

新 agent 已进 domain 和 skill，但正则口语入口没同步扩展。无 AI 或 AI 失败时，用户不能稳定用中文短词编排新 agent。

建议：`AGENT_ALIASES` 从 agent 定义派生默认 id/name/title，再手写增补中文短称：`趋势/选题`、`人设/口吻`、`搜索/SEO`、`钩子/hook`。

### P2: 想法 router 打分过浅

当前 `scoreSkill` 不看素材、品牌、受众、历史偏好、预算、目标类型，也没有返回置信度/备选方案。模糊输入直接选第一个 skill 虽然 runnable，但可能让“想法 agent”看起来武断。

建议：扩展 route 结果为 `FlowPlan`：`selectedSkill`、`confidence`、`assumptions`、`missingInputs`、`alternatives`、`rationaleByAgent`、`riskFlags`。

### P2: DAG 名义和顺序执行之间有落差

Flow 支持手动 DAG，但执行仍通过 `orderedAgentIds -> skill.agents` 展平成顺序列表。这个边界在文档里已诚实说明，代码也可测，但如果 supervisor 未来要做并行/分支推理，当前 runner 不够。

建议：短期维持顺序执行；中期把 `driveCreativeTask` 从 `skill.agents` 顺序执行升级为真正按 `flow.nodes/edges` 执行。

## 架构判断

### 当前合理之处

1. `Flow` 作为控制面事实源是对的。它让自动、半自动、手动共用执行合同。
2. `flowToSkill` 单桥是对的。它让旧 skill 系统和新 Flow 编排自然兼容。
3. `runFlowWithAI` 的节点存在性门控是对的。没有 `copy` 就不跑 text，没有 `visual` 就不跑 image。（`lib/flow/execute.js:17-25`）
4. `trend/persona/seo` 作为 pre-pass 是对的。它们把“想法增强”从最终 copy prompt 前置为结构化中间产物。
5. deterministic router + LLM director intent 的组合是现实的。自动入口稳定可测，手动入口可以逐步变聪明。

### 当前不够合理之处

1. `Supervisor` 没有清晰边界：router、UI、domain record、AI executors 都承担一点中枢职责。
2. idea router 的结果没有审计字段：没有 confidence/assumptions/alternatives，难以解释“为什么选这条链”。
3. AI executor 没有真正接入 domain runner seam，导致 task events 和 aiMeta agentExecutions 不是同一套事实流。
4. agent 扩容后，router rationale 与 director alias 没同步，这是架构注册单点还不完整的信号。

## 建议方案

### 近期修正（低风险）

1. 新增 `lib/flow/supervisor.js` 或重命名 `router.js` 为明确的 `supervisor/router` 边界：
   - 保留 deterministic route 作为 fallback。
   - 输出结构化 `FlowPlan`，包含置信度、假设、备选 skill、每个 agent 的理由。
2. 补齐 `reasonFor`：
   - `trend`: “先定平台选题角度，避免泛泛介绍产品”
   - `hook`: “生成候选钩子并选择最强开场”
   - `persona`: “统一创作者人设口吻，降低 AI 腔”
   - `seo`: “布局搜索关键词和话题，提升可发现性”
3. 补齐 `AGENT_ALIASES`：
   - `hook: ["钩子", "开场", "hook"]`
   - `trend: ["趋势", "选题", "热点", "trend"]`
   - `persona: ["人设", "口吻", "语气", "persona"]`
   - `seo: ["搜索", "关键词", "标签", "seo"]`
4. 增加回归测试：
   - `routeIdeaToFlow` 对所有入选 agent 都给非泛化 rationale。
   - `parseDirectorCommand("加趋势")`、`("加人设")`、`("加钩子")`、`("加SEO")` 均可添加节点。
   - `FlowPlan` 模糊输入返回 assumptions/alternatives，而不是静默默认第一 skill。

### 中期重构（中风险）

1. 把 AI executor 接进 `driveCreativeTask` 的 executor seam：
   - domain event 与 AI agent execution 共用同一事实流。
   - `agent_started/agent_completed/agent_failed` 能真实反映 AI 调用。
2. 引入 Supervisor structured prompt：
   - system: “你是 AICrew 的创作编排 supervisor，只能从 allowed agents 选择 DAG，必须解释每个节点理由，不得使用 video，除非显式解锁。”
   - output schema: `{flowOps, selectedSkillId, confidence, assumptions, alternatives, riskFlags, rationale}`
   - fallback: 当前 deterministic `routeIdeaToFlow`。
3. 为 supervisor 增加评估器：
   - 校验必须有 `qa/export`，除非用户明确只要草稿。
   - 校验没有 dead node。
   - 校验成本不超过预算。
   - 校验平台和媒介一致。

### 长期演进（高风险）

1. 真 DAG runner：按 `flow.edges` 执行，支持并行分支和扇入。
2. Agent 间数据流：每个 agent 的 artifact 明确作为下游 input，而不是仅共享 brief/skill。
3. 运行时 supervisor loop：agent 输出失败或质量低时，supervisor 可以重试、替换节点、降级路径。

## 最终判断

当前 AICrew 的 agent 架构不是“错”，而是处在从“可解释的 Flow 编排产品”到“真实 agent supervisor runtime”的中间态。

- 如果产品定位是 AICrew Studio 的可用创作工作台：当前架构合理，重点补 alias/rationale/FlowPlan 可观测性。
- 如果产品定位是类似 CrewAI/LangGraph 的真实多 agent supervisor：当前 supervisor 还不够，必须把 supervisor 独立成模块，并把 AI executor 接入统一 runner。

推荐下一步先做低风险修正：`reasonFor` + `AGENT_ALIASES` + `FlowPlan` 可观测字段 + 测试。这样能不破坏现有单桥架构，同时让“中枢/想法 agent”从演示感提升到可信的产品能力。
## 修补记录（2026-06-26）

已落实低风险修补：

- `lib/flow/router.js`：补齐 `trend/hook/persona/seo` 的具体 rationale，新增 `selectedSkill`、`confidence`、`assumptions`、`missingInputs`、`alternatives`、`riskFlags`、`rationaleByAgent` 等 FlowPlan 可观测字段，保留旧 `matchedSkill/rationale/summary` 契约。
- `lib/flow/director.js`：补齐 `trend/hook/persona/seo` 中文口语 alias，保证无 AI 或 LLM fallback 时也可用“加趋势 / 加钩子 / 加人设 / 加SEO”编排。
- `tests/flow.test.js`、`tests/director-intent.test.js`：补回归测试，覆盖新 agent rationale、FlowPlan 字段、director fallback alias。
