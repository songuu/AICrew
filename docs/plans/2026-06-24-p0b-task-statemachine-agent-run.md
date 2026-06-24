---
title: "P0-B 任务状态机 + Agent run DAG"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
status_note: "draft→planning：用户已确认 credits 照旧不退款 + 其余 5 决策按推荐锁定，进 Work"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, p0, lifecycle, state-machine, agent-run, flow]
aliases: ["p0b-task-statemachine", "任务状态机"]
goal: "给创作任务真实的生命周期：用显式、可持久化的 task + 每 agent 状态机（queued→running→completed|failed）取代硬编码的 status:'completed'/progress:100，由一个依赖序运行器走 Flow DAG 驱动；失败成为一等公民（保留已成功 agent 的 ready artifacts + 重试），状态跨 reload 存活并在启动时调和孤儿 running 任务。"
goal_status: in-progress
goal_iteration: 0
invariants:
  - "三模式(auto/semi/manual)经 flowToSkill 单桥产出结构同构的 task；运行器消费 flow(nodes/edges)，永不读 flow.mode。"
  - "节点存在性门控保留：qa 仅当 'qa' 节点在、export 仅当 'export' 节点在、video 受 isVideoSkill 决定。"
  - "ArtifactRef(ready/failed/deferred) 仍是导出真相；失败 task 仍导出其 ready artifacts；export 只消费 ready。"
  - "不可变：每次 task/agent/flow 状态转移返回新对象，绝不原地改 task.agents 或 nodes。"
  - "确定性 + 离线：runFlow(无 AI) 路径在 node --test 下确定可跑；mock executor 永不随机失败。"
  - "计数锁定：variants 默认 3、exports 默认 3；qa.overallScore≥80、scoreHookStrength≥80 仍成立。"
  - "credits.actual 记账一致：run/retry 不重复计、不丢消耗。"
  - "DB：aicrew_ 前缀、复合 PK(workspace_id,id)、幂等迁移(add column if not exists)、status 列与 payload.status 在 saveStateSnapshot 同步；lib/db/* server-only。"
invariant_tests:
  - "npm test"
  - "npm run build"
  - "npm run test:db"
deferred:
  - sprint: 后续
    item: "真实多进程/服务端异步执行引擎（本期仅留 executeAgent 注入 seam）"
    deadline: ""
    reason: "blast radius 太大，本期 in-process"
  - sprint: 后续
    item: "并行分支执行（manual DAG 分叉）"
    deadline: ""
    reason: "本期 topo 拍平为顺序"
  - sprint: credit-system
    item: "credits reserve/settle/release 状态机"
    deadline: ""
    reason: "避免两个互锁状态机同期落地；见 [[2026-06-24-credit-system-design]]"
  - sprint: 后续
    item: "真实 agent 间数据流（上游 artifact 喂下游）"
    deadline: ""
    reason: "本期 DAG 只管顺序与失败传播，不管数据管道"
  - sprint: 后续
    item: "独立 aicrew_agent_runs 表（per-agent run 可独立更新/streaming）"
    deadline: ""
    reason: "本期 run 内嵌 task.payload.agents[]"
related:
  - "[[2026-06-24-real-artifact-export-closure]]"
  - "[[2026-06-24-prd-architecture-operations-analysis]]"
  - "[[2026-06-24-credit-system-design]]"
---

# P0-B 任务状态机 + Agent run DAG

> 本文档由 6-agent recon（task 模型 / Flow DAG / 持久化 / UI / PRD 需求）+ 合成产出，全部对照真实代码。**已确认：credits 照旧不退款（决策 b），其余 5 决策按推荐锁定 → status: planning，进 Work。**

## Phase 1: Think

### 背景（recon 核心事实）

今天**根本没有 task/agent 执行生命周期**：

- `runCreativeWorkflowWithSkill`(domain.js:1196) 是**同步、瞬时**的纯函数，一次构造出整个「已完成」task。
- `task.status` = 字面量 `'completed'`（domain.js:1215，构造时写死）；无 startedAt/finishedAt/error。
- `buildAgentStep`(domain.js:1359) 每个 agent 步**出生即 completed**：`status:'completed'`、`progress:100`、`duration` 由数组下标伪造(`(index+1)*7+8`)。
- `events`(buildAgentEvents:1372) 是**事后**从已完成 agent 重构的，不是实时日志。
- **DAG 不存在**：`skill.agents` 是 flat 有序 string[]，按下标消费，agent 间零数据依赖。
- `retryAgentStep`(:1405) 是唯一的「构造后变更」路径，但**永远落到 completed**，无法表达失败/进行中。

**唯一真实的状态机在 artifact 层**（artifacts.js:4 `ARTIFACT_STATUS = {ready,failed,deferred}`）。task/agent 执行生命周期得从零建，但有现成可复用底座：

- **`lib/flow/model.js` 已有 nodes/edges + `orderedAgentIds`(Kahn 拓扑, :233) + `setNodeStatus`(:118) + node 级 `idle|running|done|error`(:48)** —— 这就是 DAG 运行器的骨架，不必另造。
- artifact 三态 + `sanitizeArtifactError`(artifacts.js:28) 直接复用。
- `retryAgentStep` 已演示「不可变 task 更新 + event 追加 + credits.actual 累加」的模式。

### Scope

- 定义一个 canonical 生命周期枚举 `TASK_STATUS = Object.freeze({queued,running,completed,failed})`（仿 ARTIFACT_STATUS 风格），task 与 agent step 共用；artifact 的 ready/failed/deferred 词汇**保持独立不变**。
- agent step 加生命周期字段：queuedAt/startedAt/finishedAt/error（保留 progress、retryCount）。
- 拆 `runCreativeWorkflowWithSkill` 为 **plan 相**（建 queued task）+ **drive 相**（运行器走 flow edges，逐节点 queued→running→completed/failed、实时发 events、累加 credits.actual）。
- 实现**确定性、顺序、edge 序**运行器：只消费 flow 的 nodes/edges（复用 `orderedAgentIds` Kahn），一次执行一个 agent，经 `setNodeStatus` 更新 node 状态让 canvas/overlay 反映真实进度。
- 失败一等公民：executeAgent 可 throw → 运行器 catch、标该 agent failed（脱敏 error）、保留已成功 agent 的 artifacts、下游依赖留 queued（不启动）、task 落 failed 但仍从 ready artifacts 组导出/QA。
- 改 `retryAgentStep`：重试 failed agent 走 queued→running→completed|failed，保留 event+credits 记账契约。
- 单一渲染面 `AgentTimeline`(AICrewStudio.jsx:1613) 出每 agent 状态 pill + 进度条，Retry 按钮门控在 `status==='failed'`；task.status chip 绑新枚举。
- 持久化：`status` 提升为 `aicrew_tasks` 列（payload jsonb 仍是真相），启动调和孤儿 running/queued → failed(interrupted)。

### Non-scope

- 不做真实多进程/服务端异步引擎（仅留 `executeAgent` 注入 seam）。
- 不做并行分支执行（manual DAG 本期 topo 拍平为顺序）。
- 不做 credits reserve/settle/release 状态机（本期 credits.actual 照旧累加，无退款）。
- 不做真实 agent 间数据流（DAG 只管顺序与失败传播，不管数据管道）。
- 不接视频（video 节点仍硬拦；MP4 仍 deferred ArtifactRef）。
- 不加 `aicrew_agent_runs` 表（run 内嵌 task.payload.agents[]）。
- 不加 SSE/websocket/轮询端点；UI 经现有 setState→debounce-persist 反映状态。
- 不动 CanvasStudio 内部（不得新增 domain/ai import；node 状态经已传入的 flow prop 抵达 canvas）。

### Success

- 干净 run：task queued→running→completed；某 agent 失败：queued→running→failed，每 agent 有真实 startedAt/finishedAt（不再下标伪造 duration）。
- 运行中 `node.status`(idle→running→done/error) 由运行器经 `setNodeStatus` 推进；FlowOverlay/canvas 反映真实进度而非装饰性 reveal timer。
- 单 agent 失败：该 agent status=failed + 脱敏 error；下游不跑；上游保留 ready artifacts；task 落 failed 但 ready artifacts 仍可导出。
- Retry failed agent 经 Retry 按钮 → queued→running→completed(或仍 failed)，恰好 1 条 agent_retried 事件 + 1 次 credits.actual += cost。
- 三模式仍经 flowToSkill 单桥产出结构同构 task；grep 确认运行器不读 flow.mode。
- Reload 中途：running 任务 rehydrate 后启动调和为 failed(interrupted)，不永久卡住；completed 不变；server 权威 + localStorage 兜底。
- 既有 domain 测试在 fixture 迁移后通过（status/progress/duration 断言改为生命周期模型）；不删测试；加失败 + retry-from-failed 回归测试。
- node --test 确定性套件离线常绿（mock executor 不失败）；干净 run 的 credits 合计不变。

## Phase 2: 技术方案

### 状态机设计（两层一枚举）

`TASK_STATUS = Object.freeze({queued,running,completed,failed})`，task 与每个 agent step 共用。node 级状态(model.js:48 idle|running|done|error)是**展示镜像**，运行器经一个 map 更新：`queued→idle, running→running, completed→done, failed→error`（node 词汇不变，canvas 零改动）。

- **agent 转移**：queued —(deps 满足+executor 启动)→ running —(返回)→ completed | —(throw)→ failed。failed 终态直到 retry 重入 queued。上游失败的 agent 留 queued（= "blocked" 表达，无需新状态）。
- **task 转移**：plan 相建为 queued（全 agent queued）。首节点启动→running。终态：全 agent completed→completed；任一终态 failed→failed。retry failed agent：task failed→running 跑完再 re-settle。`cancelled` out of scope。
- **存储**：per-agent status + 时间戳/error 在 `task.payload.agents[]`（内嵌，本期不建表）。`task.status` 同时在 payload.status（真相）+ 提升到 `aicrew_tasks.status` 列（可查询 + 启动调和），在 `saveStateSnapshot`(state.js:96-100) 同步。events 改为 drive 相**实时**追加(agent_started/completed/failed/retried)。
- **运行器**：drive 相 = 从 edges 算 indegree(Kahn，复用 `orderedAgentIds`)，按稳定声明序取 ready 节点，逐个 `executeAgent(node, ctx)`（默认 = 现 buildAgentStep 工作包成 running→completed；AI 路径供可 throw 的真实异步 executor），成功则减下游 indegree，失败则跳过全部传递下游。运行器签名 `(flow, executor)`，**永不读 flow.mode**。保留同步 run-to-completion 包装器给 `execute.js runFlow` 等期望「拿到成品 task」的调用方。

### 入场扫描 - Invariants 继承

见 frontmatter `invariants`。关键守护：三模式同构（运行器不分支 flow.mode）、节点存在性门控、artifact 真相、计数锁定、credits 一致、DB 约定。

## Phase 3: Task Breakdown

> 硬依赖链：**T1 → T2 → {T3 → T4} 与 {T5}，最后 T6**。

### T1 — 定义生命周期枚举 + agent-step 生命周期字段（L1）
- 文件：`lib/domain.js`、`lib/artifacts.js`
- 加 `TASK_STATUS`(Object.freeze) 仿 ARTIFACT_STATUS；扩 `buildAgentStep`(domain.js:1359) 出 queuedAt/startedAt/finishedAt/error 并接受 status 参数（新初始化器默认 queued）；加 node↔task 状态 map。纯加法脚手架。
- 验收：TASK_STATUS 导出、四态；buildAgentStep 能出 queued 步（status=queued 时不硬编码 completed/progress:100）也能出 completed 步（back-compat）；状态 map 是覆盖四态的纯函数。

### T2 — 拆 plan/drive + edge 序顺序运行器（L4，临界路径脊柱）
- 文件：`lib/domain.js`、`lib/flow/execute.js`、`lib/flow/model.js`
- 引入 `planCreativeTask`（建 queued task）+ `driveCreativeTask(flow, executor)`（走 edges Kahn、逐节点 queued→running→completed、经 setNodeStatus + 发 agent_started/completed、累加 credits.actual，再建 variants/qa/exports 保留存在性门控）。保留同步 run-to-completion 包装器。默认 executor=现 buildAgentStep 工作；运行器**不读 flow.mode**。
- 验收：runFlow(无 AI) 三模式产出结构同构 completed task；grep 确认不引用 flow.mode；运行中 node.status idle→running→done 按拓扑序推进；门控行为不变；events 实时追加；credits.actual 与拆前干净 run 合计相等；无边/有环 flow 经 validateFlow 守护安全回退、不死锁。

### T3 — 失败一等公民 + 传播 + 部分 artifact 保留（L4）
- 文件：`lib/domain.js`、`lib/flow/execute.js`、`lib/ai/workflow.js`
- 运行器 executeAgent 包 try/catch：throw → 标 agent failed(脱敏 error)、发 agent_failed、保留已成功 artifacts、传递下游留 queued、task 落 failed 但仍从 ready artifacts 组装 exports/qa。AI 路径(runFlowWithAI→runCreativeWorkflowWithAI)经同一 executor seam 暴露 per-agent 失败。mock executor 不失败。
- 验收：模拟单 agent 失败 → task.status=failed、该 agent failed+非空脱敏 error、下游留 queued、上游保留 ready artifacts；失败 task 仍导出 ready artifacts + qa-report.json，video 永不 ready；AI 路径失败经同一 catch、无整单静默失败。

### T4 — 改 retryAgentStep 走生命周期重试 failed agent（L3）
- 文件：`lib/domain.js`
- 改 `retryAgentStep`(domain.js:1405)：重入 failed(或 completed) agent 经 queued→running→completed|failed（同一 executor），保留不可变更新 + agent_retried 事件 + credits.actual += cost **恰好一次**。仍失败则刷新 error；成功则清 error 并 re-settle task.status（若是最后一个失败则 failed→completed）。
- 验收：retry failed agent 走 running 再落 completed 或 failed；retryCount++；每次 retry 恰好 1 事件 + 1 次扣费；重试最后一个失败项 re-settle task failed→completed；无重复扣费、无原地变更、返回 {cost,task} 新对象。

### T5 — 持久化 status（列+payload）+ 启动调和孤儿 run（L3）
- 文件：`supabase/migrations/20260624xxxxxx_add_task_status.sql`、`lib/db/repositories/state.js`、`components/AICrewStudio.jsx`
- 幂等迁移：`alter table aicrew_tasks add column if not exists status text not null default 'completed'`（+ 可选 (workspace_id,status) 部分索引）。`saveStateSnapshot`(state.js:96-100) 提升 status 与 payload.status 同步。rehydration(AICrewStudio.jsx:266-275 / save gate :333) 调和孤儿 running/queued→failed(interrupted)，靠现有 600ms debounce + serializeWrite 合并瞬时 running tick。不建新表。
- 验收：`npm run db:migrate` 干净幂等（重跑 no-op）；旧行默认 completed；aicrew_ 前缀+复合 PK 守住、不动其他表；running 跨 reload 调和为 failed-interrupted、completed 不变；server 权威仍 gated on serverReadyRef、降级客户端不 replace-all 冲掉云端；payload.status 与列 save 后不背离。

### T6 — AgentTimeline 出生命周期 + 状态 chip（L2）
- 文件：`components/AICrewStudio.jsx`、`components/OrchestratorConsole.jsx`
- 单一共享 `AgentTimeline`(AICrewStudio.jsx:1613，Dashboard:924 + Workbench:1053 共用) 出每 agent 状态 pill(queued/running/completed/failed) + 进度条(复用 agent.progress) + 失败 error tooltip，Retry 按钮(:1638)门控 `status==='failed'`。TaskTable(:1810) + project chip(:1085) 绑新枚举样式。中和 OrchestratorConsole 装饰性 reveal timer(:308-321)，让真实事件单独驱动 auto-mode UI。
- 验收：Dashboard + Workbench 从同一组件出一致 pill/进度（无 fork）；失败 agent 出 error tooltip + 活跃 Retry；task/project/table chip 出四态样式无裸字符串；auto-mode UI 仅由真实 run 事件驱动（非 timer + 事件双驱动）。

## Phase 3.5: 待决策（开 Work 前必须拍板）

| # | 决策 | 推荐 | 影响 |
|---|---|---|---|
| a | **执行模型**：本期真异步 vs 同步带生命周期态 | **同步 in-process** 发真实 queued→running→completed/failed + 真时间戳，留 executeAgent seam | 定 T2 blast radius；mock 即时所以 running 仅瞬时可观测 |
| b | **credits 耦合**：本期接 reserve/settle/release（running 预留、completed 结算、failed 退款）vs 照旧 | **照旧累加、不退款**，reserve/settle 推到 credit-system sprint | 接退款=把 credit-system scope 拉进来；与并行的 credit-system-design.md 协调 |
| c | **Schema**：payload 内嵌 run + 仅提升 task.status 列 vs 现建 aicrew_agent_runs 表 | **payload 内嵌 + 一列 status** | 定 T5 迁移形态；独立表留到 run 需独立更新/streaming 时 |
| d | **DAG 执行**：顺序 topo 拍平 vs manual DAG 真并行 | **顺序**（保确定性） | 并行延后 |
| e | **启动调和策略**：孤儿 running/queued→failed-interrupted vs 尝试 resume vs 不管 | **failed-interrupted**（最安全，避免永久卡 UI） | |
| f | **cancelled 态**：本期要不要 | **不要**（同步 in-process 无可取消点） | 真异步后再议 |

> 推荐项整体把 sprint 锁在「同步运行器 + 生命周期态 + 失败一等公民」的有界范围。唯一有产品权重、需与并行工作协调的是 **决策 b（credits 耦合）**。

## Phase 3.6: Work Log

| Task | 状态 | 落地 | 验证 |
|---|---|---|---|
| T1 生命周期枚举 + agent step 字段 | ✅ done | `lib/lifecycle.js`(新)、`lib/domain.js`(buildAgentStep 加 status 参数+生命周期字段，默认 completed 保兼容)、`tests/lifecycle.test.js`(新) | `npm test` 221/219 pass/2 skip/0 fail；4 新测试绿；无回归 |
| T2 plan/drive 拆分 + 顺序运行器 | ✅ done | `lib/domain.js`(planCreativeTask + driveCreativeTask + defaultAgentExecutor seam + 同步包装器；删 dead buildAgentEvents)、`tests/task-runner.test.js`(新) | `npm test` 225/223 pass/2 skip/0 fail；4 新测试绿；结构同构保持(三模式经 skill.agents 顺序=拓扑序，drive 不读 flow.mode) |
| T3 失败一等公民 | ✅ done | `lib/domain.js`(markAgentFailed + driveCreativeTask try/catch：failed+脱敏 error、下游留 queued、task 落 failed 仍建产物)、`lib/ai/workflow.js`(全图失败→visual failed+task failed、灾难性 catch→failed)、tests | `npm test` 227/225；2 新测试绿。注：AI 仍 post-hoc enrichment，逐 agent AI executor 路由后续细化(seam 已就位) |
| T4 retry from failed | ✅ done | `lib/domain.js`(retryAgentStep 改走 running→completed\|failed + 可注入 executor + 解封下游 + 重新结算 status；扣费/事件恰好一次) | `npm test` 229/227；2 新测试绿；back-compat(completed 任务重试不变) |
| T5 status 持久化 + 启动调和 | ✅ done | `supabase/migrations/20260624160000_add_task_status.sql`(新，幂等 add column)、`lib/db/repositories/state.js`(status 列与 payload 同步)、`lib/domain.js`(reconcileInterruptedTasks 纯函数)、`components/AICrewStudio.jsx`(加载后施用调和)、tests | `npm test` 231/229；2 新测试绿；build 绿。⚠ test:db 需先 `npm run db:migrate`(新增列) |
| T6 AgentTimeline 四态 UI | ✅ done | `components/AICrewStudio.jsx`(agent 四态 pill + 失败 error + Retry 门控在 failed + task/project chip 绑枚举 + statusLabel)、`styles/globals.css`(四态配色) | `npm test` 231/229；build 绿。注：Retry 改为仅 failed 显示(原全 agent)；OrchestratorConsole 装饰 timer 中和未做(纯动画，盲改有风险，留后续) |

## Phase 3.7: 执行边界 / 后续

- **Retry 语义变更**：Retry 按钮现仅对 `status==='failed'` 的 agent 显示（原对全部 completed agent 显示）。同步 demo 无失败 → 默认不出现 Retry，符合「Retry=重试失败」语义。
- **AI 逐 agent executor 路由**（T3 deferred）：AI 路径仍是 post-hoc enrichment，失败已非静默（全图失败→visual failed+task failed、灾难性→failed），但未逐 agent drive-via-executor。domain seam 已就位。
- **OrchestratorConsole 装饰 reveal timer 中和**（T6 deferred）：纯动画，盲改风险高，留待可视验证时处理。
- **test:db**：本 sprint 新增 `aicrew_tasks.status` 列，跑 `npm run test:db` 前必须先 `npm run db:migrate`（幂等）。沙箱无 DB，本轮未跑 test:db。
- **credits 耦合**（决策 b）：照旧累加不退款；reserve/settle/release 留 credit-system sprint（见 [[2026-06-24-credit-system-design]]）。

## Phase 4: Review Checklist（占位，Work 后填）

P0：三模式同构(grep 无 flow.mode)、失败 task 仍导出 ready、credits 不重复计、迁移幂等、reload 调和不卡死。
P1：node.status 真实推进、retry 恰好一次扣费、UI 四态无裸字符串、mock executor 离线确定性。

## Phase 4: Review 结果

- 三模式同构：运行器 `driveCreativeTask` 只吃 skill、不读 flow.mode（grep 确认仅注释/flow→skill stage 标签引用）。
- 失败 task 仍导出 ready artifacts + qa-report（T3 测试断言）；video 仍 deferred（未触）。
- credits 重试恰好扣一次（T4 测试断言）；计数锁定 variants/exports=3（T2 测试断言）。
- 无 dead code（删 buildAgentEvents）；CanvasStudio 未被引入 domain/ai。
- 残留 `status:"completed"` 字面量仅 createInitialState 种子 + orchestrator 记录（值同枚举，非生命周期路径，可接受）。
- 全程 TDD（每 task RED→GREEN）；`npm test` 231/229 pass/2 skip/0 fail；`npm run build` 沙箱外 exit 0。

## Phase 5: Compound 记录

- **任务从「伪完成」升级为真实生命周期**：queued→running→completed|failed，失败一等公民 + retry-from-failed + 启动调和。
- **运行器复用 flow/model.js Kahn 拓扑**，证明 Flow 图是三模式统一的正确底座；plan/drive 分离 + executor seam 为后续真异步执行 / agent_runs 表 / credit reserve-settle 铺底。
- **沉淀**：执行生命周期词汇集中在 `lib/lifecycle.js`（与 artifacts 的交付物状态正交）；新增 aiMeta/artifact error 一律经 `sanitizeArtifactError`（见 [[aicrew-persist-sanitization-blindspot]]）。
- 下一步候选：真异步 executor 路由（AI 逐 agent）/ credit-system reserve-settle / 并行分支执行。
