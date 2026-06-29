---
title: "Agent executor 路由与 Credit reserve-settle"
type: sprint
status: completed
created: "2026-06-25"
updated: "2026-06-25"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, agents, credits, billing]
aliases: ["agent executor routing", "credit reserve settle"]
invariants:
  - "AI 路径必须走 agent executor seam，失败仍落 agent failed 且错误脱敏"
  - "所有扣费必须先 reserve 再 settle/release，不能直接信任客户端 actual credits"
  - "积分余额必须以服务端账本为准，前端 state 只能作为展示缓存"
  - "reserve/settle/release 必须幂等，迟到或重复调用不得二次扣费或二次退款"
  - "三模式执行结果仍保持 task/agent/variant/export 结构同构"
invariant_tests:
  - "node --test tests/task-runner.test.js"
  - "node --test tests/ai.test.js"
  - "node --test tests/domain.test.js"
deferred: []
---

# Agent executor 路由与 Credit reserve-settle

## Phase 1: Think

### Scope

- 把 AI 增强从 post-hoc wrapper 收敛到逐 agent executor 路由，复用 `planCreativeTask` / `driveCreativeTask` 已存在的 seam。
- 基于 `docs/plans/2026-06-24-credit-system-design.md` 落一个可测试的 reserve-settle 内核，先做本地/服务端可迁移的纯函数账务模型。
- 将前端生成与重试的扣费从“直接扣 actual”改为“reserve estimated -> settle actual/release remainder”语义。
- 使用并行 worker 分支执行无冲突切片，主线程负责集成和审查。

### Non-Scope

- 不接真实支付、订阅、订单 webhook。
- 不改 Supabase 真钱表结构到可上线支付态。
- 不引入真实异步 worker 队列或 `aicrew_agent_runs` 表。
- 不把 RoboNeo 价格写死到业务 UI。

### Success

- AI 配置存在时，copy/visual/trend/persona/seo 能作为 agent executor 路由执行；相关 agent artifact/status 反映真实 AI 子任务结果。
- 任务生成与 retry 有 reserve/settle/release ledger，不再只有单条 consume。
- 失败任务 release 未消费 reservation；partial settle 可退回 remainder。
- `node --test tests/task-runner.test.js tests/ai.test.js tests/credits.test.js` 通过；必要时跑全量 `npm test`。

### Risks

- `workflow.js` 测试多，改动容易破坏现有 AI 降级语义。
- 当前 `workspace.credits` 仍是客户端展示缓存，完整服务端权威化需后续 DB/API sprint。
- 并行 worker 只适合 disjoint 写集；`components/AICrewStudio.jsx` 和最终 glue 由主线程串行处理。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|---|---|---|
| Agent runner | `driveCreativeTask` 不读 `flow.mode`，agent 失败一等公民 | AI executor 仍经同一 task/agent 生命周期，保持三模式同构 |
| Credit system | 先 reserve 后 settle/release；余额缓存可对账 | 新增纯 credit ledger 内核，UI 提交只调用 reservation API/函数 |
| Error safety | provider/token 错误不得落持久化面 | executor 捕获和 aiMeta/imageErrors 继续使用 `sanitizeArtifactError` |
| State persistence | 前端 state 只是展示缓存 | 本 sprint 不把 snapshot PUT 当权威扣费来源，ledger 语义先收敛 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|---|---|---|---|---|
| AI executor 路由 | Workbench/Flow run | `runCreativeWorkflowWithAI` -> per-agent executor | task payload + aiMeta | yes |
| generation reserve-settle | 点击生成 | reserve quote -> AI/deterministic run -> settle/release | `creditLedger` 展示缓存 | yes, 但服务端权威 DB API 后续 |
| retry reserve-settle | Retry failed agent | reserve retry cost -> `retryAgentStep` -> settle/release | `creditLedger` 展示缓存 | yes |
| credit ledger core | domain/UI 调用 | pure ledger state | local/Supabase snapshot payload | yes |

### 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|---|---|---|---|
| `2026-06-24-p0b-task-statemachine-agent-run.md` | AI 逐 agent executor 路由 | 本 sprint 解决 | 2026-06-25 |
| `2026-06-24-p0b-task-statemachine-agent-run.md` | credits reserve/settle/release | 本 sprint 解决核心闭环，DB 权威化后续 | 2026-06-25 |
| `2026-06-24-credit-system-design.md` | 真 auth + per-user wallet | 推迟，仍按 default workspace 展示缓存 | real-auth-landing + 1 sprint |

### Task Breakdown

| ID | 并行 | Task | 文件 | 风险 | 验证 |
|---|---:|---|---|---|---|
| T1 | [P] | Credit reserve/settle/release 纯内核 + 单测 | `lib/credits.js`, `tests/credits.test.js` | L3 | `node --test tests/credits.test.js` |
| T2 | [P] | AI 逐 agent executor 路由 + AI 回归测试 | `lib/ai/workflow.js`, `tests/ai.test.js` | L3 | `node --test tests/ai.test.js` |
| T3 |  | Domain async drive glue，如 T2 需要 | `lib/domain.js`, `tests/task-runner.test.js` | L3 | `node --test tests/task-runner.test.js` |
| T4 |  | UI generation/retry reserve-settle 接线 | `components/AICrewStudio.jsx` | L2 | `node --test tests/domain.test.js tests/credits.test.js` |
| T5 |  | State 去客户端权威写入的最小防护/测试更新 | `lib/db/repositories/state.js`, `tests/db.integration.test.js` | L3 | `node --test tests/db.integration.test.js`（需 DB） |
| T6 |  | 文档、审查、全量回归 | sprint doc + tests | L2 | `npm test` |

### 并行批次

- Batch A: T1 与 T2 写集不重叠，允许 worker 并行分支。
- T3/T4/T5 依赖 T1/T2 输出，主线程串行集成。

## Phase 3: Work Log

| Task | Status | Notes |
|---|---|---|
| T1 | done | Added pure reserve/settle/release ledger core in `lib/credits.js`; covered partial settle, release, insufficiency, idempotency, reconcile failure. |
| T2 | done | Routed AI enhancement through per-agent executor registry in `lib/ai/workflow.js`; exposed `aiMeta.agentExecutions`. |
| T3 | done | Reused existing domain executor seam; added `settleTaskCreditsInState` to bridge task lifecycle and credit reservation state. |
| T4 | done | Workbench/Flow/retry now preflight available credits and commit via reserve->settle/release display cache. |
| T5 | done | State API no longer accepts client credit authority; added minimal `/api/credits/transaction` server transaction to persist real consume ledger while full auth/bucket wallet remains deferred. |
| T6 | done | Review and validation complete: targeted tests, full `npm test`, and `npm run build` passed. |

## Phase 4: Review

### Findings

- P0: none.
- P1: initial integration could throw after generation when credits were insufficient; fixed by preflight quote checks before Workbench, Flow, and retry runs.
- P2: full auth/bucket wallet remains outside this sprint; fixed the immediate persistence gap with a server-side idempotent credit transaction endpoint and kept snapshot PUT away from server-owned ledger.

### Review Notes

- AI errors still pass through `sanitizeArtifactError` before aiMeta/artifacts.
- Generation failures release reservations instead of consuming display balance.
- Retry keeps existing contract: retry attempt reserves and settles the attempt cost exactly once.
- `git diff --check` passes; Windows line-ending warnings only.

### Validation

- `node --test tests/credits.test.js tests/domain.test.js tests/task-runner.test.js tests/ai.test.js` -> 111/111 pass.
- `node --test tests/domain.test.js tests/flow.test.js tests/task-runner.test.js tests/ai.test.js tests/credits.test.js` -> 153/153 pass.
- Post-audit targeted: `node --test tests/credits.test.js tests/domain.test.js tests/ai.test.js tests/flow.test.js tests/ai-route-guard.test.js tests/state-repository.test.js` -> 164/164 pass.
- Post-audit full: `npm test` -> 267 pass / 0 fail / 2 DB integration skipped (no `SUPABASE_DB_URL`).
- Post-audit build: `npm run build` -> pass, includes `/api/credits/transaction`.
- Pre-audit `npm test` -> 247 pass / 2 skipped / 0 fail; skips are DB tests because `SUPABASE_DB_URL` is not configured.
- Pre-audit `npm run build` -> Next.js production build passed.

Note: sandboxed Node test runner still fails with Windows `spawn EPERM`; validation above was run with escalated local process permissions.

## Phase 5: Compound

### Knowledge

- Per-agent AI routing can be introduced without changing `driveCreativeTask` by keeping the agent executor registry inside `workflow.js` and surfacing execution metadata in `aiMeta`.
- Reserve/settle can land first as a pure domain ledger and be wired to UI display cache; DB authority should wait for wallet API/auth boundaries.
- Credit integration must preflight quote before long-running generation; post-generation insufficient-credit failures are a user-visible crash pattern.

### Deferred

- Move demo scalar credits from `aicrew_workspaces.credits` to full wallet/bucket/reservation tables once auth lands.
- Add bucket allocation/expiry semantics from the full credit-system design.
- Add real auth scoped wallet migration before any money-backed orders/subscriptions.

Done: sprint completed.
Knowledge: 3 rules, 0 instincts, 0 skill signals.
Compact: suggested after commit/review if continuing into DB wallet sprint.
