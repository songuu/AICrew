---
title: "trend/persona/seo 升级为独立结构化生成 pass"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, ai, agents, enrichment]
aliases: ["enrichment passes", "独立 pass"]

invariants:
  - "AI 层包装不改 domain：不动 domain task.agents 静态 artifact / buildVariants / copy JSON {hook,caption,hashtags}"
  - "copyApplied===3 / imageAppliedCount===3 / variants===3"
  - "任一 AI 调用失败 → 局部优雅回退，整体不抛错（aiMeta 记录）"
  - "renderXGuidance gated on skill.agents.includes；节点缺省 prompt 与改动前一致；不含「创作技能」字面量"
  - "preset.lang 单源；新 pre-pass 输出语言随 preset.lang"
invariant_tests:
  - tests/ai.test.js
  - tests/domain.test.js
  - tests/flow.test.js

deferred:
  - sprint: next
    item: "把 pre-pass 结构化产物回写到 domain task.agents[].artifact（取代静态字符串）"
    deadline: "2026-09-15"
    reason: "需改 domain 层 + task 形状；本轮先在 AI 层 aiMeta 落地，不动 domain"
  - sprint: next
    item: "确定性兜底 hook/caption 模板 i18n / render*Guidance 全量本地化"
    deadline: "2026-09-01"
    reason: "i18n 收尾，独立排期"
  - sprint: next
    item: "variant 扩量>3 + A/B pack"
    deadline: "2026-09-01"
    reason: "需重构 variants===3 契约"
---

# Sprint: trend/persona/seo 升级为独立结构化生成 pass

> 承接 f91f59c(i18n)。上几轮 trend/persona/seo 是 **prompt 指令级**（renderXGuidance 注入泛指令，同 hook MVP 边界）。本轮升级为 **AI 层独立结构化生成 pass**：各自先跑一次 LLM 产出结构化输出，concrete 结果注入文案 prompt。

## Phase 1: 需求分析（Think — CEO/产品视角）

### 背景
trend/persona/seo 当前只在 `buildCopyPrompt` 注入一句泛指令（"结合热点切入"/"真人口吻"/"含核心词"），模型自由发挥，没有"先想清楚再写"。升级为独立 pass = 先让模型**结构化产出**选题角度 / 口吻 profile / 关键词标签，再把 concrete 结果喂给文案生成——更可控、更可见、质量更高。

### Scope（做什么）
- AI 层（`lib/ai/workflow.js`）新增 `runEnrichmentPasses`：对 skill 编排了的节点各跑一次 LLM pre-pass（**节点级 gated**，**每节点一次、跨 3 variant 共享**），产出结构化 JSON：
  - `trend` → `{angles:[3 个高流量选题角度]}`
  - `persona` → `{voice, phrases:[标志性措辞]}`
  - `seo` → `{keywords:[核心词], hashtags:[标签]}`
- `buildCopyPrompt` 接 `enrichment` 参数；`renderTrend/Persona/SeoGuidance` 改为**「有 concrete 输出 → 注入具体内容（保留原 label），否则回退现有泛指令」**。
- `aiMeta.prePasses` 记录哪些 pass 成功（可观测）。
- pre-pass 输出语言随 `preset.lang`（en 平台出英文角度/关键词）。

### Non-scope（不做什么）
- ❌ 改 domain：task.agents 静态 artifact 不动、buildVariants 不动、copy JSON 形状不动。pre-pass 产物挂 `aiMeta`，不回写 domain（回写 defer 下轮）。
- ❌ 改 variants/copyApplied 数量。
- ❌ 确定性路径（无 AI）：pre-pass 仅在 textEnabled 时跑，无 AI 时行为不变。
- ❌ 碰 domain.js / 并行会话文件（本轮目标 lib/ai/workflow.js + tests/ai.test.js）。

### Success（成功标准）
- 节点存在 + AI 文本开 → 对应 pre-pass 跑，concrete 输出进 copy prompt（可测：prompt 含 pre-pass 派生内容），`aiMeta.prePasses` 记录。
- pre-pass 失败 → 回退现有泛指令，copy 仍 apply，不抛错。
- 节点缺省 → 不跑 pre-pass、不注入（向后兼容；现有 gated 断言仍过，因 label 保留）。
- 既有不变量全过：copyApplied===3、AI 失败优雅回退、「创作技能」门、preset.lang。
- 全套 0 回归 + build ✓。

### Risks（风险）
- R1 额外 LLM 调用：含 3 节点的 skill + AI 开 → 3 pre-pass + 3 copy = 6 次（pre-pass 跨 variant 共享，不是 ×3）。延迟/成本上升，属"独立 pass"固有代价，记录。
- R2 既有 ai.test 断言 prompt 含「选题角度/人设口吻/搜索优化」label → concrete 注入**保留 label**，断言仍过；另加 concrete + aiMeta 新断言。
- R3 测试 mock 对所有 text 调用返回同一 JSON → pre-pass 与 copy 形状不同；测试用**按 prompt 内容分流的 router**返回对应结构。
- R4 pre-pass 输出语言：随 preset.lang（复用 copySystemFor），避免 en 平台出中文角度。

→ 'go' 进入 Plan | 调整范围 | 'skip'

---

## Phase 2: 技术方案（Plan — 架构师视角）

### 入场扫描 - Invariants 继承（回归扫描）

| 子系统 | 继承 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| AI 包装不改 domain | 评分/结构/导出契约不受 AI 影响 | pre-pass 产物只挂 `aiMeta`，不动 domain task.agents/buildVariants/copy JSON |
| copy 契约 | {hook,caption,hashtags}；copyApplied===3 | pre-pass 与 copy 解耦；copy 调用与 merge 逻辑不变 |
| 优雅降级 | 任一 AI 调用失败局部回退不抛错 | 每 pre-pass try/catch→null→renderXGuidance 回退泛指令 |
| gated 注入 | renderXGuidance gated；缺省 prompt 不变；不含「创作技能」 | concrete 分支保留原 label + gated 不变；新文本不含该字面量 |
| i18n 单源 | preset.lang 决定语言 | pre-pass system 复用 copySystemFor(preset)，输出随 lang |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 产出可见 | 刷新后 |
|--------|----------|--------|----------|--------|
| runEnrichmentPasses | 选含 trend/persona/seo 的 skill + AI 文本开 | textEnabled 块前置跑 pre-pass → enrichment | ✅ concrete 进 copy prompt + `aiMeta.prePasses` | ✅（aiMeta 在返回 task，内存态） |
| renderXGuidance concrete/fallback | buildCopyPrompt 渲染 | enrichment 有则 concrete 否则泛指令 | ✅ 文案受具体角度/口吻/关键词影响 | ✅ |

> 无 ❌：pre-pass 输出被 copy prompt 消费 + aiMeta 记录（非 dead）。回写 domain task.agents artifact 显式 defer 下轮（frontmatter）。

### 入场扫描 - 债务清单

| 来源 | 议题 | 本 sprint 决策 | deadline |
|------|------|----------------|----------|
| copy-engine/agent-expansion | trend/persona/seo 升级独立 pass | ✅ 本轮做（AI 层 aiMeta） | — |
| 本轮新拆 | pre-pass 产物回写 domain task.agents artifact | ⏭ 推迟（需改 domain/task 形状） | 2026-09-15 |
| 历史 | 确定性兜底 i18n / guidance 本地化 / variant 扩量 | ⏭ 推迟 | 2026-09-01 |

### 设计要点（均在 lib/ai/workflow.js）
- `runEnrichmentPasses({brief, preset, skill, aiConfig, signal, fetchImpl})`：对 `skill.agents.includes` 命中的节点，`Promise.all` 并发跑 pre-pass；每个 `generateText`（system=`copySystemFor(preset)`，maxTokens≈300）+ `extractJson`，try/catch→null。返回 `{trend, persona, seo}`。
  - prompt：trend→`{"angles":[3]}`、persona→`{"voice","phrases":[]}`、seo→`{"keywords":[],"hashtags":[]}`；en 平台附 "Output values in English"。
- `buildCopyPrompt(..., enrichment)`；`renderTrend/Persona/SeoGuidance(brief, skill, enrichment)`：concrete（保留原 label）或回退泛指令。
- `runCreativeWorkflowWithAI` textEnabled 块：copies map 前 `const enrichment = await runEnrichmentPasses(...)`；buildCopyPrompt 传 enrichment；`aiMeta.prePasses = {trend:bool,persona:bool,seo:bool}`。

### 任务拆解

| # | Task | 风险 | 验证 |
|---|------|------|------|
| T1 | runEnrichmentPasses + 3 pre-pass prompt builder（gated/并发/lang-aware/try-catch） | L3 | ai.test pre-pass 跑+结构 |
| T2 | buildCopyPrompt 接 enrichment + renderXGuidance concrete-or-fallback（保留 label） | L3 | ai.test concrete 注入 + label 保留 |
| T3 | 接入 textEnabled 块（前置 enrichment）+ aiMeta.prePasses | L2 | ai.test aiMeta + copyApplied===3 不变 |
| T4 | 测试：prompt 分流 mock + concrete 注入/失败回退/缺省不跑/aiMeta/lang | L3 | node --test 新增全绿 |
| T5 | 回归(全套) + build + changelog | L2 | 0 回归 + build ✓ |

5 个 task，无 L4、无 destructive、无跨用户副作用。

→ 'go' 进入 Work | 调整计划

---

## Phase 3: 变更日志（Work）

| Task | 状态 | 改动 |
|------|------|------|
| T1 | ✅ | lib/ai/workflow.js：`enrichLangNote` + `buildTrend/Persona/SeoPrompt` + `ENRICHMENT_NODES` + `runEnrichmentPasses`（节点 gated、Promise.all 并发、system=copySystemFor、maxTokens 300、extractJson、try/catch→null、非对象忽略） |
| T2 | ✅ | renderTrend/Persona/SeoGuidance 改 `(brief, skill, enrichment)`：有 concrete（angles/voice+phrases/keywords+hashtags）→ 注入具体内容（保留原 label），否则回退泛指令；buildCopyPrompt 接 `enrichment` 参数并传入三 render |
| T3 | ✅ | runCreativeWorkflowWithAI textEnabled 块：copies map 前置 `runEnrichmentPasses`；buildCopyPrompt 传 enrichment；`aiMeta.prePasses={trend,persona,seo:bool}` |
| T4 | ✅ | tests/ai.test.js：分流 router `enrichmentRouter`；+4 测试（concrete 注入+aiMeta / 失败回退泛指令 / 缺省不跑 / en pre-pass 英文 note）；修共享 helper promptCaptureRouter+captureBodies 只捕获 copy 调用（含「开场钩子」标记），不混入 pre-pass |
| T5 | ✅ | 回归 + build |

### 验证
- ai.test.js：37/37（4 新 pre-pass + 7 既有经 helper 修复恢复绿）。
- 全套：208 / 206 pass / 0 fail（2 跳过含 db.integration）。
- `npm run build`：✓ Compiled successfully。
- 不变量：AI 包装不改 domain（产物挂 aiMeta）、copyApplied===3、优雅回退、「创作技能」门、preset.lang——全保持。

---

## Phase 4: 审查结果（Review — 6 视角）

| 视角 | 结论 |
|------|------|
| 架构 | pre-pass 全在 AI 层；产物挂 aiMeta 不污染 domain；renderXGuidance concrete/fallback 对称、复用既有 gated + label |
| 安全 | 无 secret / 无新输入路径；pre-pass system 复用 copySystemFor（JSON-only + 语言约束） |
| 性能 | R1 已知：含 3 节点 skill +3 LLM 调用（pre-pass 跨 variant 共享非 ×3）；并发跑、独立 pass 固有代价 |
| 代码质量 | 函数小、注释解释 WHY；非对象/数组 pre-pass 结果被忽略（防脏数据）；try/catch 局部隔离 |
| 测试覆盖 | concrete 注入 / 失败回退 / 缺省不跑 / aiMeta / en 语言——四向覆盖；helper 修复防 pre-pass 污染既有断言 |
| 集成连续性（第6视角） | ① 继承不变量全过（不改 domain/copyApplied3/优雅回退/「创作技能」/lang）② 无 dead code：enrichment 被 buildCopyPrompt 消费 + aiMeta 记录 ③ 回写 domain task.agents artifact 显式 defer 下轮 ④⑤ 仅碰 lib/ai/workflow.js + tests/ai.test.js，未碰 domain.js/并行会话 |

**P0/P1：无。**

P2（已 defer）：pre-pass 结构化产物尚未回写 domain `task.agents[].artifact`（仍静态字符串）——前端 agent 步骤卡看不到具体 pre-pass 内容，需改 domain/task 形状，defer 下轮。

## Phase 5: 复利记录（Compound）

- **沉淀**：[[aicrew-copy-engine]] 记「trend/persona/seo 为 prompt 指令级 MVP」的边界本轮被推进——升级为 AI 层独立结构化 pre-pass（gated/并发/跨变体共享/优雅回退/concrete-or-generic 保留 label）。产物挂 aiMeta 不改 domain（AI 包装不改 domain 的又一应用）。
- **测试 gotcha（新）**：在 AI 层新增额外 generateText 调用（pre-pass）会让"无差别捕获所有 text prompt"的共享测试 router 把新调用混入既有 `every(...)` copy 断言导致假失败——共享 capture helper 应按 prompt 标记（如 copy schema「开场钩子」）只捕获目标调用。
- **未提交**：lib/ai/workflow.js + tests/ai.test.js + 本 doc，待提交（domain.js 未碰，与并行会话零冲突）。
