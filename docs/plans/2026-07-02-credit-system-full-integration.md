---
title: "AICrew 积分系统全方位接入"
type: sprint
status: completed
created: "2026-07-02"
updated: "2026-07-02"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, credits, billing, wallet, catalog]
aliases: ["credit full integration", "积分系统全量接入"]
goal: "全方位接入积分系统，保持现有功能正确，并完整完成当前无真实支付/认证边界内的钱包、积分桶、权益、目录、报价、结算、展示功能"
goal_max_iter: 3
goal_until: ""
goal_iteration: 0
goal_status: completed
invariants:
  - "积分余额必须以服务端账本为准，前端 state 只能作为展示缓存"
  - "所有扣费必须先 reserve 再 settle/release，不能直接信任客户端 actual credits"
  - "积分余额必须可对账：available = sum(bucket.remaining)，reserved = sum(bucket.reserved)"
  - "会员计划、单购包、赠送规则必须产品目录化，不能硬编码在 UI"
  - "任务失败、重复 settle/release、重复领取权益必须幂等"
  - "真钱支付、真实 auth、per-user wallet 不伪装为已完成"
invariant_tests:
  - "node --test tests/credits.test.js"
  - "node --test tests/domain.test.js"
  - "node --test tests/state-repository.test.js"
deferred:
  - sprint: "payment-auth"
    item: "真实支付 provider、webhook 签名、per-user 钱包隔离"
    deadline: "real-auth-landing + 1 sprint"
    reason: "当前仓库仍是 default workspace，无真实 auth/session 边界"
---

# AICrew 积分系统全方位接入

## Phase 1: Think

### Scope

- 在 `2026-06-24-credit-system-design.md` 和 `2026-06-25-agent-executor-credit-reserve-settle.md` 基础上，把积分从单余额展示升级为可对账的钱包、积分桶、权益、产品目录与报价/冻结/结算模型。
- 保持现有 Workbench/Flow/retry 执行链路正确，现有本地 reserve-settle 展示缓存继续可用。
- 服务端 State API 继续把余额视为 server-owned，客户端 PUT 不得覆盖服务端钱包。
- Billing 页面展示余额桶、会员计划、充值包、价格目录和流水分类。

### Non-Scope

- 不接真实支付 provider、自动续费 webhook、订单回调签名。
- 不接真实 auth/per-user wallet，仍锁定 `default` workspace。
- 不做真实后台运营控制台权限模型。

### Success

- 纯内核支持 grant/daily refresh/topup/admin adjustment/reserve/settle/release/expire/reconcile，并有 L3 测试。
- 服务端 API 能返回 wallet/catalog/ledger，quote 能返回版本化报价。
- State GET 合并 server wallet；State PUT 不接受客户端余额/账本。
- Billing UI 不再只有静态价格卡，能看到钱包桶、会员、充值包、价格目录和 Received/Used 流水。
- `node --test tests/credits.test.js tests/domain.test.js tests/state-repository.test.js` 通过；必要时跑全量。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|---|---|---|
| Credit system | 先 reserve 后 settle/release；余额缓存可对账 | 新增 bucket wallet 内核，所有写后 reconcile |
| State persistence | 前端 state 只是展示缓存 | `sanitizeClientStateForSave` 继续丢弃客户端余额/账本，GET 合并 server wallet |
| Product catalog | 计划/充值/价格不硬编码 UI | 目录常量由纯内核导出，UI 从 catalog 渲染 |
| Payment boundary | 真钱表需 auth 后上线 | 本轮只做 checkout shell/catalog，不伪装真实支付 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|---|---|---|---|---|
| 钱包读取 | 打开 app / Billing | `/api/state` + `/api/credits/wallet` | server-owned wallet snapshot | yes |
| 报价 | Workbench/Flow 估算 | `/api/credits/quote` + catalog version | quote response | yes |
| 扣费 | generation/retry settle | 本地 reserve-settle + `/api/credits/transaction` | server wallet + ledger mirror | yes |
| 每日权益 | Billing 领取入口/API | grant policy | wallet bucket + transaction | yes |
| Billing 展示 | 进入 Billing | `state.creditWallet` | snapshot display cache | yes |

### 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|---|---|---|---|
| `2026-06-24-credit-system-design.md` | Phase 1-4 钱包/权益/目录/UI | 本 sprint 解决无支付/auth边界内闭环 | 2026-07-02 |
| `2026-06-25-agent-executor-credit-reserve-settle.md` | DB 权威钱包 | 本 sprint 以 server-owned wallet snapshot + migration 表准备承接 | 2026-07-02 |
| `2026-06-24-credit-system-design.md` | 真实支付/webhook/per-user | 推迟 | real-auth-landing + 1 sprint |

### Task Breakdown

| ID | Task | 文件 | 风险 | 验证 |
|---|---|---|---|---|
| T1 | 完整 credit wallet/catalog 纯内核 | `lib/credit-system.js`, `tests/credits.test.js` | L3 | `node --test tests/credits.test.js` |
| T2 | 服务端 wallet/quote/grant API 与 state 读取接线 | `lib/db/repositories/credits.js`, `lib/db/repositories/state.js`, `app/api/credits/*` | L3 | `node --test tests/state-repository.test.js` |
| T3 | Billing UI 全量展示 | `components/AICrewStudio.jsx`, `styles/globals.css` | L2 | `node --test tests/domain.test.js` + build |
| T4 | DB migration 表结构准备 | `supabase/migrations/*credit_wallet_system.sql` | L3 | migration lint/read review |
| T5 | 回归、审查、compound | tests/docs | L2 | targeted + full where feasible |

## Phase 3: Work Log

| Task | Status | Notes |
|---|---|---|
| T1 | done | Added bucket wallet/catalog core with signup, daily refresh, reserve, partial settle, release, expire, reconcile tests. |
| T2 | done | Added server-owned wallet snapshot repository, wallet/quote/grant/reserve/settle/release APIs, and State GET/PUT wallet merge/sanitize. |
| T3 | done | Billing now renders wallet summary, buckets, memberships, topups, pricing catalog, and received/used ledger. |
| T4 | done | Added idempotent aicrew_ credit wallet migration tables and seed catalog rows. |
| T5 | done | Review found public mint risk; fixed grant/transaction public endpoints and reran tests/build. |
## Phase 4: Review

### 派遣记录

- 评估 risk: L3（账务、服务端 API、state 持久化、migration、UI）。
- 跑的视角: security, arch, quality, test, design, integration-continuity。
- 跳过的视角: perf 深挖；原因：未引入循环查询或高吞吐路径，wallet 当前仍 default workspace 低并发。

### Gap Detection Walkthrough

| workflow / invariant | existing coverage | uncovered gap | action |
|---|---|---|---|
| 客户端不能覆盖服务端余额 | `tests/state-repository.test.js`, full `npm test` | none | pass |
| Bucket reserve/settle/release/expire | `tests/credits.test.js` 12 cases | DB integration skipped without `SUPABASE_DB_URL` | documented skip |
| 公共 credit API 不得 mint | review 发现 grant/transaction 可构造正向交易 | fixed: grant 只允 daily/signup, transaction 只允 negative consume | P0 fixed |
| Billing catalog 不硬编码 | UI 从 `getCreditCatalog()` / server `creditCatalog` 渲染 | none | pass |
| 真实支付/auth 边界 | sprint non-scope + route forbid topup/admin public writes | payment provider 未接 | deferred |

### Findings

- P0 fixed: public `/api/credits/grant` and `/api/credits/transaction` could be used to mint credits before auth/payment exists. Fixed by allowing only `daily_refresh`/`signup_bonus` on grant and only negative `consume` on transaction.
- P1: DB relation tables are added but runtime repository currently stores wallet authority in `workspace.payload.creditSystemWallet` for compatibility. This is intentional bridge state; relationship-table runtime can land after auth/payment.
- P2: Visual verification is source/build only; no Playwright screenshot was run in this sprint.

### Validation

- `node --test tests/credits.test.js` -> 12/12 pass.
- `node --test tests/credits.test.js tests/domain.test.js tests/state-repository.test.js` -> 87/87 pass after P0 fix.
- `npm test` -> 328 pass / 0 fail / 2 DB integration skipped (`SUPABASE_DB_URL` not configured).
- `npm run build` -> pass; new `/api/credits/*` routes included.
- `git diff --check` -> pass; Windows LF/CRLF warnings only.

## Phase 5: Compound

### Knowledge

- Credit API public surface must default-deny minting. Before real auth/payment, browser-callable routes may claim free idempotent entitlements or consume, but must not accept arbitrary positive grant/topup/adjustment.
- A server-owned wallet can bridge via `workspace.payload.creditSystemWallet` while relational wallet tables are introduced; State GET exposes only `creditWallet` overview and State PUT preserves the hidden wallet snapshot.
- Billing should render catalog data, not own plan/topup/pricing numbers, otherwise product rules drift from billing logic.

### Solution

- `docs/solutions/2026-07-02-credit-system-full-integration.md`
- `docs/solutions/index.jsonl` appended with the new solution entry.

Goal loop: iter 1/3, until=n/a, goal-met=yes, decision=stop:credit-system-current-boundary-complete

