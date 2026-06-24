---
title: "surface pre-pass 结构化产物（concrete artifact + aiMeta 内容）"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, ai, enrichment, observability]
aliases: ["surface pre-pass", "prepass artifact"]

invariants:
  - "AI 层包装不改 domain：override 走新建视图（immutable），不 mutate base task / 不改 buildAgentArtifact / 不改 copy JSON"
  - "agent 步骤 artifact 恒为 truthy string（前端 dd 渲染 + domain.test:287 every(artifact)）"
  - "copyApplied===3 / 优雅回退 / aiMeta 既有键（used/provider/model/copyApplied/imageApplied/imageAppliedCount）不变"
  - "pre-pass 失败/缺省 → artifact 回退静态、prePasses 项为 null（不抛错）"
invariant_tests:
  - tests/ai.test.js
  - tests/domain.test.js
  - tests/flow.test.js

deferred:
  - sprint: next
    item: "确定性兜底 hook/caption 模板 i18n / render*Guidance 全量本地化"
    deadline: "2026-09-01"
    reason: "i18n 收尾"
  - sprint: next
    item: "variant 扩量>3 + A/B pack"
    deadline: "2026-09-01"
    reason: "需重构 variants===3 契约"
  - sprint: next
    item: "publish/CTR learning loop"
    deadline: "2026-09-15"
    reason: "需后端数据管线（并行会话已铺 supabase，未来可接）"
---

# Sprint: surface pre-pass 结构化产物

> 承接 2ce2623（enrichment pre-pass）的 P2。上轮 trend/persona/seo 升级为独立结构化 pre-pass，但产出（angles/voice/keywords）注入 copy prompt 后**即弃**：aiMeta.prePasses 只存 bool，前端 agent 步骤卡仍显示静态 artifact，用户看不到"生成了哪些选题角度/口吻/关键词"。本轮把产物**surface 出来**。

## Phase 1: 需求分析（Think — CEO/产品视角）

### 背景
pre-pass 的结构化输出是有价值的中间产物（具体选题角度、口吻定调、关键词标签），但当前被消费完即丢。前端 `AICrewStudio.jsx:1641` 已渲染 `agent.artifact`；只要把 AI 层返回 task 的 trend/persona/seo 步骤 artifact 换成 concrete 内容，用户即可看到——零组件改动。

### Scope（做什么）
- `aiMeta.prePasses` 从 `{trend,persona,seo: bool}` 升级为**存实际结构化内容**：`{trend: {angles}|null, persona: {voice,phrases}|null, seo: {keywords,hashtags}|null}`。
- AI 层 override 返回 task 的 agent 步骤：对 trend/persona/seo，当 pre-pass 成功 → 用 concrete 内容格式化覆盖该 step 的 `artifact`（**新建 agents 数组，immutable，不 mutate domain base**）；失败/缺省 → 保留 domain 静态 artifact。
- 新增格式化 helper：content → 人类可读 artifact string（trend→"选题角度：A；B；C"等）。

### Non-scope（不做什么）
- ❌ 改 domain.js：`buildAgentArtifact` 静态产物保留（无 AI 路径仍用它）；task 形状契约不动。
- ❌ 改前端组件：`agent.artifact` 已被渲染，override 后自动显示。
- ❌ 改 copy JSON / variants / 无 AI 确定性路径。
- ❌ 持久化 pre-pass 产物（CTR/回流 defer）。

### Success（成功标准）
- AI run + pre-pass 成功 → 返回 task 的 `agents.find(trend).artifact` 为 concrete（非静态 "Trend: …"）；`aiMeta.prePasses.trend === {angles:[...]}`。
- pre-pass 失败/缺省 → 该 agent.artifact 仍为 domain 静态串；`prePasses.x === null`。
- `base`（domain task）的 agents **不被 mutate**（immutability 可测）；domain.test 不受影响。
- agent.artifact 恒 truthy string；copyApplied===3 / 优雅回退 / aiMeta 既有键不变。
- 全套 0 回归（更新上轮 prePasses-bool 断言）+ build ✓。

### Risks（风险）
- R1 prePasses shape 改（bool→内容）破上轮断言 → 更新该测试；前端未消费 prePasses（已核查），无破坏。
- R2 immutability：`{...base}` 浅拷贝**共享 agents 引用**；override 必须显式 `agents: 新数组`，且新数组用 map 产新对象，不改 base.agents 元素。
- R3 agent.artifact 必须留 truthy string（前端 dd + 契约）→ concrete 串非空。
- R4 仅 textEnabled + pre-pass 成功才 override；其余保留静态，不抛错。

→ 'go' 进入 Plan | 调整范围 | 'skip'

---

## Phase 2: 技术方案（Plan — 架构师视角）

### 入场扫描 - Invariants 继承（回归扫描）

| 子系统 | 继承 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| AI 包装不改 domain | base task 不被 mutate；评分/结构契约不受影响 | override 用 `agents: base.agents.map(新对象)`，显式覆盖返回值的 agents，不动 base 元素 |
| agent 契约 | artifact 恒 truthy；domain.test:287 every(artifact&&evaluation&&tools) | override 仅换 artifact 字符串内容（仍 truthy）；domain.test 跑 domain 路径不受 AI 层影响 |
| copy/优雅回退 | copyApplied===3；任一失败局部回退 | 不动 copy 逻辑；pre-pass 失败 → 保留静态 artifact + prePasses null |
| aiMeta 键 | used/provider/model/copyApplied/imageApplied/imageAppliedCount | 仅改 prePasses 值（bool→内容），其余键不动 |
| enrichment | pre-pass gated/并发/lang/try-catch（2ce2623） | 复用 runEnrichmentPasses 返回值，不改其逻辑 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 产出可见 | 刷新后 |
|--------|----------|--------|----------|--------|
| agent.artifact override | AI run + pre-pass 成功 | runCreativeWorkflowWithAI 返回 `agents:` 覆盖 → `AICrewStudio.jsx:1641 {agent.artifact}` | ✅ 前端 agent 卡显示 concrete 选题/口吻/关键词 | ✅（task 内存态） |
| aiMeta.prePasses 内容 | 同上 | 返回 aiMeta.prePasses={内容} | ✅ 可观测/调试（前端未消费，预留） | ✅ |

> 无 ❌：artifact 已被前端渲染（零组件改动）；prePasses 内容为预留可观测，前端当前不消费（已核查无破坏）。

### 入场扫描 - 债务清单

| 来源 | 议题 | 本 sprint 决策 | deadline |
|------|------|----------------|----------|
| enrichment(2ce2623) | pre-pass 产物 surface/回写 | ✅ 本轮做（AI 层 override + aiMeta 内容） | — |
| 历史 | 确定性兜底 i18n / guidance 本地化 / variant 扩量 / CTR | ⏭ 推迟 | 2026-09-01+ |

### 设计要点（均在 lib/ai/workflow.js）
- 格式化 helper：`formatEnrichmentArtifact(nodeId, data)` → string：
  - trend → `选题角度（AI 生成）：${angles.join("；")}`
  - persona → `人设口吻（AI 生成）：${voice}${phrases? "｜措辞：" + phrases.join("/") : ""}`
  - seo → `搜索优化（AI 生成）：关键词 ${keywords.join("、")}｜标签 ${hashtags.join(" ")}`
  - 空/缺字段 → 返回 null（调用方回退静态）。
- `aiMeta.prePasses = { trend: enrichment.trend, persona: enrichment.persona, seo: enrichment.seo }`（内容或 null）。
- override：`const enrichedAgents = base.agents.map(a => { const data = enrichment[a.id]; const art = data && formatEnrichmentArtifact(a.id, data); return art ? { ...a, artifact: art } : a; })`；返回 `{ ...base, variants, agents: enrichedAgents, aiMeta:{...} }`。textEnabled=false 时 enrichment 全 null → enrichedАgents === base.agents 内容（map 产新数组但元素同值，base 元素不变）。

### 任务拆解

| # | Task | 风险 | 验证 |
|---|------|------|------|
| T1 | formatEnrichmentArtifact(nodeId,data)（trend/persona/seo + 空字段→null） | L2 | ai.test 格式 |
| T2 | aiMeta.prePasses 改存内容（enrichment 对象/null） | L2 | ai.test prePasses 内容 |
| T3 | enrichedAgents immutable override + 返回 `agents:` | L3 | ai.test override + base 不变 |
| T4 | 测试：override concrete / 失败回退静态 / base 不被 mutate / prePasses 内容 | L3 | node --test 新增全绿 |
| T5 | 回归(全套) + build + changelog | L2 | 0 回归 + build ✓ |

5 个 task，无 L4、无 destructive、无跨用户副作用。

→ 'go' 进入 Work | 调整计划

---

## Phase 3: 变更日志（Work）

| Task | 状态 | 改动 |
|------|------|------|
| T1 | ✅ | lib/ai/workflow.js：`formatEnrichmentArtifact(nodeId, data)`——trend→「选题角度（AI 生成）：…」/ persona→「人设口吻（AI 生成）：…｜措辞：…」/ seo→「搜索优化（AI 生成）：关键词…｜标签…」；字段缺/空→null |
| T2 | ✅ | aiMeta.prePasses 从 bool 改存实际内容（`enrichment.{trend,persona,seo}` 对象或 null） |
| T3 | ✅ | runCreativeWorkflowWithAI 返回：`enrichedAgents = base.agents.map(a => fmt ? {...a,artifact} : a)` + `agents: enrichedAgents`（immutable，base 元素不动） |
| T4 | ✅ | tests/ai.test.js：更新上轮 3 处 prePasses 断言（bool→内容/null）；+2 测试（domain 静态 / AI override concrete + 非 enrichment 节点不变 + artifact 恒 truthy） |
| T5 | ✅ | 回归 + build |

### 验证
- ai.test.js：39/39。
- 全套：210 / 208 pass / 0 fail（2 跳过含 db.integration）。
- `npm run build`：✓ Compiled successfully。
- 前端零改动：`AICrewStudio.jsx:1641 {agent.artifact}` 自动渲染 override 后的 concrete 内容。

---

## Phase 4: 审查结果（Review — 6 视角）

| 视角 | 结论 |
|------|------|
| 架构 | override 走 immutable map（`agents:` 覆盖返回值），base 元素不 mutate，守「AI 包装不改 domain」 |
| 安全 | 无 secret / 无新输入路径；formatEnrichmentArtifact 仅字符串拼接 |
| 性能 | 一次 map（≤10 元素），无新网络/循环 |
| 代码质量 | formatEnrichmentArtifact 防空字段→null；override 三元保留非 enrichment 节点；注释解释 WHY |
| 测试覆盖 | prePasses 内容 + artifact override + 非 enrichment 节点不变 + truthy 契约 + domain 静态对照 |
| 集成连续性（第6视角） | ① 继承不变量全过（不 mutate base/artifact truthy/copyApplied3/优雅回退/aiMeta 既有键）② 无 dead code：artifact 被前端 dd 渲染、prePasses 内容预留可观测 ③ 完成 enrichment(2ce2623) 的 P2 ④⑤ 仅碰 lib/ai/workflow.js + tests/ai.test.js |

**P0/P1：无。**

P2（可选 defer）：prePasses 内容前端暂未单独消费（仅 artifact 渲染）；如需"选题角度面板"等独立 UI 可下轮接 `aiMeta.prePasses`。

## Phase 5: 复利记录（Compound）

- **沉淀**：[[aicrew-copy-engine]] 第三轮已记 pre-pass；本轮补完——产物经 **AI 层 immutable override**（`agents: base.agents.map(...)`）surface 到 agent.artifact（前端 `{agent.artifact||agent.output}` 自动显示，零组件改动）+ aiMeta.prePasses 存内容。守「AI 包装不改 domain」：`{...base}` 浅拷贝共享 agents 引用，必须显式 `agents: 新数组` 且 map 产新对象才不污染 base。
- **未提交**：lib/ai/workflow.js + tests/ai.test.js + 本 doc，待提交（零 domain.js，与并行会话无冲突）。
