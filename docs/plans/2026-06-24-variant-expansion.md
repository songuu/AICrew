---
title: "variant 扩量（可配置变体数 + A/B 标记）"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 4
tasks_completed: 4
tags: [sprint, feature, variants]
aliases: ["variant 扩量", "A/B pack"]

invariants:
  - "默认 variantCount===3：不传 count 的既有调用仍得 3 个变体（variants===3 / exports===3 / copyApplied===3 不破）"
  - "角度池前 3 个逐字不变（既有 CTA/hookStrength/caption 断言不破）"
  - "新角度 angle 值 ∈ HOOK_FRAMEWORKS（renderAngleFramework 自动锁框架，workflow.js 不改）"
  - "variant 仍含既有键 {hook,caption,hashtags,cta,score,metrics,...}；只新增 abLabel 字段"
  - "qa.overallScore >= 80（scoreHookStrength 80 floor）"
invariant_tests:
  - tests/domain.test.js
  - tests/ai.test.js
  - tests/flow.test.js

deferred:
  - sprint: next
    item: "A/B 胜出追踪 / 真实投放回流（CTR learning loop）"
    deadline: "2026-09-15"
    reason: "需后端数据管线；本轮只做变体扩量 + A/B 标记（labeled arms）"
  - sprint: next
    item: "确定性兜底 i18n / guidance 全量本地化"
    deadline: "2026-09-01"
    reason: "i18n 收尾"
---

# Sprint: variant 扩量（可配置变体数 + A/B 标记）

> 承接 8728f77。把固定 3 变体升级为**可配置变体数**（默认仍 3，向后兼容）+ 每变体 A/B 标记（labeled arms）。**快进快提交**：default 3 → 零既有测试改动，压缩与并行会话的 domain.js 冲突窗口。

## Phase 1: Think
- Scope：① `buildVariants(brief,brandKit,skill,count=3)` 加 count 参数（默认 3，clamp[1,角度池上限]）② 角度池 3→6（前 3 个逐字不变，新增 社会证明/具体数字/反共识）③ 每变体加 `abLabel`(A/B/C…) ④ `variantCount` 经 runCreativeWorkflow / runCreativeWorkflowWithSkill / runCreativeWorkflowWithAI 透传。
- Non-scope：A/B 胜出追踪/CTR 回流（需后端，defer）；改 copy JSON；改 variants 默认数（仍 3）。
- Success：不传 count→3（既有全绿）；count=5→5 变体/5 导出/abLabel A-E/qa>=80；count clamp 越界安全。
- Risks：R1 default 必须 3 否则破 6 处 variants===3；R2 前 3 角度逐字不变；R3 metrics 对高 index 仍有效（clamp 到池上限保证）；R4 domain.js 改动与并行会话冲突 → 快提交。

## Phase 2: Plan
### 入场扫描 - Invariants 继承
| 子系统 | invariant | 如何保持 |
|---|---|---|
| variants 契约 | variants/exports/copyApplied===3 | count 默认 3；exports/copyApplied 本就 variants.length 派生，自动随 count |
| 角度内容 | 前 3 角度 CTA/hook/caption 既有断言 | 前 3 angle 对象逐字不变，仅 append 角度 4-6 |
| 框架锁 | renderAngleFramework 依赖 angle∈HOOK_FRAMEWORKS | 新角度 angle 用 社会证明/具体数字/反共识（均在库），workflow.js 不改 |
| AI 层 | copyApplied/imageAppliedCount===variants.length | 已是 variants.length，自动随 count |
| QA | qa.overallScore>=80 | scoreHookStrength 80 floor；新 hook 非空 |

### 入场扫描 - 集成路径
| 改动点 | 触发 | 中间层 | 可见 |
|---|---|---|---|
| variantCount 透传 | 调用方传 count | runCreativeWorkflow(WithAI)→WithSkill→buildVariants | ✅ N 变体 + N 导出 + abLabel |
> 无 ❌：count 默认 3 向后兼容；abLabel 为新增非破坏字段；前端变体列表数据驱动（map variants）自动显示更多。

### 入场扫描 - 债务清单
| 来源 | 议题 | 决策 | deadline |
|---|---|---|---|
| 历史 | variant 扩量+A/B | ✅ 本轮（变体扩量+A/B 标记） | — |
| 本轮拆 | A/B 胜出/CTR 回流 | ⏭ 推迟（需后端） | 2026-09-15 |

### 任务
| # | Task | 风险 | 验证 |
|---|---|---|---|
| T1 | buildVariants 加 count(默认3,clamp) + 角度池扩 6(前3不变) + abLabel | L3 | domain.test count>3 |
| T2 | variantCount 透传 runCreativeWorkflow/WithSkill（domain）+ runCreativeWorkflowWithAI（workflow） | L2 | ai/flow 透传 |
| T3 | 测试：默认 3 不变 + count=5 全链路(变体/导出/abLabel/qa) + clamp 越界 | L3 | node --test |
| T4 | 回归 + build + changelog | L2 | 0 回归 + build ✓ |

→ Work

## Phase 3: Work（changelog）
| Task | 状态 | 改动 |
|---|---|---|
| T1 | ✅ | lib/domain.js：`buildVariants(...,count=3)` + 角度池 3→6（前 3 逐字不变；新增 口碑背书/数据说话/反差对比，angle=社会证明/具体数字/反共识 ∈ HOOK_FRAMEWORKS）+ `n=clamp(count,[1,6])` + `angles.slice(0,n)` + 每变体 `abLabel`(A/B/C…) |
| T2 | ✅ | variantCount 透传：runCreativeWorkflow / runCreativeWorkflowWithSkill（domain）+ runCreativeWorkflowWithAI（workflow.js）；undefined→buildVariants 默认 3 |
| T3 | ✅ | tests/domain.test.js +3：默认 3+abLabel / count=5 全链路(变体+导出+abLabel A-E+qa≥80+前3不变) / clamp(99→6,0→3,1→1) |
| T4 | ✅ | 回归 + build |

### 验证
- 全套 `node --test`：213 / 211 pass / 0 fail（3 新变体测试 + **0 既有回归**，default 3 守住 6 处 variants===3）。
- `npm run build`：✓ Compiled successfully。

## Phase 4: Review（6 视角）
- 架构：count 默认 3 向后兼容；exports/copyApplied/imageAppliedCount 本就 variants.length 派生，自动随 count，零额外接线。
- 安全/性能：纯数据，clamp 防越界（metrics 高 index 仍有效因 clamp 到池上限）。
- 代码质量：前 3 角度逐字不变（差异最小）；abLabel 非破坏新增字段；注释解释 WHY。
- 测试覆盖：默认/扩量/clamp 三向 + 前 3 不变 + qa floor。
- 集成连续性：① variants===3 默认守住（6 处）② 新角度 angle∈HOOK_FRAMEWORKS→renderAngleFramework 自动锁框架，workflow.js 无需改 ③ A/B 标记 labeled arms，胜出追踪/CTR defer ④ abLabel 前端变体列表 map 自动显示。
- **P0/P1：无。** P2：A/B 仅 label（无胜出追踪/真实投放回流），需后端，defer。

## Phase 5: Compound
- 关键：**默认值向后兼容是破焊死契约的最省 churn 路径**——variants===3 焊死 6 处，把变体数改为 `count=3` 默认参数 → 不传 count 的既有调用全绿，只 ADD 扩量测试，零既有改动；同时压缩与并行会话的 domain.js 冲突窗口。承接 [[aicrew-make-it-real]]（variants 提质不增量的边界本轮以"可配置增量、默认不变"方式突破）。
- 未提交：lib/domain.js + lib/ai/workflow.js + tests/domain.test.js + 本 doc，快提交。
