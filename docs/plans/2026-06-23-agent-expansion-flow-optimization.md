---
title: "Agent 扩容 + 内容流程优化"
type: sprint
status: completed
created: "2026-06-23"
updated: "2026-06-23"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, feature, agents, pipeline]
aliases: ["agent 扩容", "流程优化"]

# === 继承上一轮（2026-06-23-tweet-copy-engine-upgrade）的不变量 ===
invariants:
  - "variants.length === 3 / aiMeta.copyApplied === 3 / imageAppliedCount === 3（提质不增量，测试焊死）"
  - "qa.overallScore >= 80（scoreHookStrength 80 floor 守住）"
  - "确定性 hashtags 必含 #${platform}；copy JSON 契约恒 {hook,caption,hashtags}"
  - "renderSkillClause 仅在 skill.bestFor 非空时输出含「创作技能」子串；新 prompt 文本绝不含该字面量"
  - "每个被 skill 引用的 agent 必须有 7 字段 + buildAgentSummary + buildAgentArtifact 条目（domain.test:287 every(artifact&&evaluation&&tools)）"
  - "KNOWN_AGENT_IDS 自动派生 agents[]；flowToSkill/linearFlow/getAgent 零改兼容；orderedAgentIds(flow)===skill.agents"
  - "主 skill ecom_tiktok_product_ad_v1 agents.length >= 8（domain.test:103，只增不减）"
  - "flow.test:209 锁死某 skill agents===['brief','visual','qa']，不得改动该 skill"

invariant_tests:
  - tests/domain.test.js
  - tests/ai.test.js
  - tests/flow.test.js

# === 上一轮 deferred，本轮决策见 Phase 2 债务清单 ===
deferred:
  - sprint: next
    item: "新平台 IG Reels / YouTube Shorts / Shopify PDP"
    deadline: "2026-08-01"
    reason: "本轮聚焦 agent/flow，不扩平台"
  - sprint: next
    item: "variant 扩量(>3) + A/B variant pack"
    deadline: "2026-08-01"
    reason: "需先重构 variants===3 测试契约"
  - sprint: next
    item: "publish/CTR learning loop（真实回流学习）"
    deadline: "2026-09-01"
    reason: "需后端 + 数据管线，超本轮静态站边界"
  - sprint: next
    item: "trend/persona/seo 升级为独立生成 pass + platform preset trendHints"
    deadline: "2026-08-15"
    reason: "本轮为 prompt 指令级 MVP（同 hook 边界），独立 pass 需扩 copy JSON schema"
---

# Sprint: Agent 扩容 + 内容流程优化

> 承接上一轮「推文/文案引擎升级」(commit cac0ba8)。原始需求剩余线程：**研究出更多相关 agent** + **优化整个流程**。

## Phase 1: 需求分析（Think — CEO/产品视角）

### 背景
上一轮把"推文吸引力"根因落到 prompt 层，加了 `hook` agent + Hook Lab skill。但原始需求还有两条线程未动：
1. **更多相关 agent**：当前管线 brief→strategy→(hook)→script→storyboard→visual→video→copy→qa→export，缺少**选题/趋势**、**人设口吻**、**搜索流量优化**这三类对带货内容"天花板"影响最大的环节。
2. **优化整个流程**：管线是固定线性序，"选题"在 strategy 内隐式发生（决定内容上限却无独立环节）；copy 缺人设一致性与搜索可发现性增强。

### Scope（做什么）
- 新增 **3 个高价值 domain agent**（产品视角去重后，不与现有 hook/copy/strategy 重叠）：
  1. `trend` 趋势选题 Agent — 管线前置，喂给 strategy 平台趋势角度/选题（启发式，无外网）
  2. `persona` 人设口吻 Agent — 让文案像特定创作者人设，而非泛泛 AI 腔
  3. `seo` 搜索优化 Agent — 平台搜索流量：关键词 + 标签策略（区别于 copy 的"挑标签"，这是"上搜索"）
- **流程优化**：`trend` 选题前置插入内容型 skill；`persona`/`seo` 接入文案型 skill；新增 1 个 flagship skill 串起增强后的全链路，展示流程升级。
- **AI prompt 层接入**（沿用上轮 hook 模式）：每个新 agent 在被编排时向对应生成步骤注入 prompt 指引（trend→strategy 选题、persona→copy 口吻、seo→hashtags/caption 关键词），gated 保 flowToSkill 合成 skill 向后兼容。

### Non-scope（不做什么）
- ❌ 新平台（IG/YT/Shopify）— defer
- ❌ variant 扩量 >3 / A/B pack — defer（破 variants===3 契约）
- ❌ 真实外部趋势 API / 网络请求 — 静态客户端边界，trend 为启发式/prompt 级
- ❌ CTR/发布回流学习闭环 — defer（需后端）
- ❌ 改 domain 管线核心契约 / variants / copy JSON 形状

### Success（成功标准）
- 3 个新 agent 通过 7 字段契约（domain.test 全 agent `every(artifact&&evaluation&&tools)`）
- 每个新 agent 至少接入 1 个 skill 管线且产出独立 artifact（非 dead node），buildAgentSummary/buildAgentArtifact 齐
- AI prompt 层各注入对应指引且 gated（不含「创作技能」字面量，flowToSkill 合成 skill 断言不破）
- 全部继承不变量保持：variants===3 / copyApplied===3 / qa>=80 / hashtags 含 #platform / copy JSON {hook,caption,hashtags}
- 既有 177 测试 0 回归 + 新增测试覆盖新 agent 契约/接入/prompt 注入

### Risks（风险）
- R1 给现有 skill 插 agent 会改 `skill.agents` → 但派生测试(orderedAgentIds/flowToSkill/plan/events)自动跟随，唯一硬约束是 buildAgentArtifact 必须补条目；flow.test:209 锁死的 skill 不能动。
- R2 prompt 注入过多 → token 膨胀；需控制每段长度，沿用上轮 maxTokens=900 预算评估。
- R3 「创作技能」注入门：新文本误带该字面量会破 ai.test 向后兼容断言。
- R4 新 agent 流于"装饰"（prompt 不真正改变输出）→ 须每个 agent 有可验证的输出影响（trend 改 strategy/角度、persona 改口吻措辞、seo 改 hashtags/keyword）。

→ 'go' 进入 Plan | 调整范围 | 'skip' 跳过

---

## Phase 2: 技术方案（Plan — 架构师视角）

### 入场扫描 - Invariants 继承（回归扫描）

| 子系统 | 继承 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| variants 契约 | variants/copyApplied/imageAppliedCount === 3 | 只加 agent/skill/prompt，不碰 buildVariants 的 3 角度数组 |
| QA 分 | qa.overallScore >= 80 | 不改 scoreHookStrength / metrics floor |
| copy JSON | 恒 {hook,caption,hashtags}；hashtags 含 #platform | mergeAiCopy 只读三键不动；seo 仅丰富 AI 端 hashtags 内容不改形状/键 |
| agent 契约 | 每个被引用 agent 有 7 字段 + summary + artifact（domain.test:287 every） | 新 3 agent 补全 7 字段 + buildAgentSummary + buildAgentArtifact 条目 |
| flow 派生 | KNOWN_AGENT_IDS 派生 agents[]（model.js:18）；orderedAgentIds===skill.agents | 只 push 进 agents[]，linearFlow/flowToSkill/getAgent 零改自动纳入 |
| 主 skill | ecom_tiktok agents.length>=8（:103）、credits.estimated>=120（:84） | 插 trend/seo 只增不减，二者皆继续满足 |
| 「创作技能」门 | renderSkillClause 独占该字面量（ai.test:521/550） | 新 3 个 render* 函数文本绝不含「创作技能」 |
| flow.test:209 | linearFlow(['brief','visual','qa']) 内联构造 | 非真 skill，加 agent 不影响；不动该测试 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 产出可见 | 刷新后 |
|--------|----------|--------|----------|--------|
| trend/persona/seo agent | 用户选含该 agent 的 skill → orchestrator 编排 | buildAgentStep → summary+artifact+event | ✅ agent 步骤卡 + 事件流 | ✅（task 内存态，同所有 skill） |
| trend/persona/seo prompt 注入 | AI 开启 + skill 含该 agent | buildCopyPrompt → render*Guidance | ✅ 生成文案受指引改变 | ✅ |
| flagship skill viral_content_engine_v1 | 选择器短视频/推荐 tab | skillsInGroup 数据驱动 | ✅ 卡片自动显现（featured） | ✅ |

> 全链路均在本 sprint 收口，无 ❌ 悬挂；无新增持久化层（沿用 task 内存态）。

### 入场扫描 - 债务清单（上一轮 deferred）

| 来源 | 议题 | 本 sprint 决策 | deadline |
|------|------|----------------|----------|
| tweet-copy-engine | 新平台 IG/YT/Shopify | ⏭ 推迟（见 frontmatter deferred） | 2026-08-01 |
| tweet-copy-engine | variant 扩量>3 + A/B pack | ⏭ 推迟（需先重构 variants===3 契约） | 2026-08-01 |
| tweet-copy-engine | CTR 回流学习闭环 | ⏭ 推迟（需后端+数据管线） | 2026-09-01 |

### 设计要点

- **新 3 agent**（agents[] push，自动被 KNOWN_AGENT_IDS 纳入）：
  - `trend` 趋势选题（cost 7）：管线前置，喂 strategy 选题角度；tools: trend_scanner / topic_angle_miner / seasonal_calendar
  - `persona` 人设口吻（cost 6）：文案第一人称真人口吻；tools: persona_profiler / tone_shifter / voice_consistency_check
  - `seo` 搜索优化（cost 5）：平台搜索流量关键词+标签策略；tools: keyword_extractor / hashtag_strategist / search_intent_mapper
- **流程优化（接入现有 skill 的 agents 序）**：
  - ecom_tiktok_product_ad_v1：`trend` 前置 strategy + `seo` 前置 qa
  - rednote_seeding_note_v1：`trend` 前置 strategy + `persona` 前置 copy + `seo` 前置 qa
  - ugc_review_v1：`persona` 前置 copy（UGC=真人口吻核心）
  - hook_lab_v1：`seo` 前置 qa
- **flagship skill** `viral_content_engine_v1`（全链路爆款内容引擎）：brief→trend→strategy→hook→persona→copy→seo→qa→export，group shortvideo + featured。
- **AI 注入**（workflow.js，gated on skill.agents.includes）：`renderTrendGuidance` / `renderPersonaGuidance` / `renderSeoGuidance` 注入 buildCopyPrompt；agent 不存在返回 ""（flowToSkill 合成 skill 向后兼容，prompt 与改动前一致）。绝不含「创作技能」。

### 任务拆解

| # | Task | 风险 | 验证 |
|---|------|------|------|
| T1 | agents[] 加 trend/persona/seo（各 7 字段）+ buildAgentSummary/buildAgentArtifact 条目 | L2 | domain.test agent 契约 every() |
| T2 | 流程优化：4 个现有 skill 的 agents 序插入新 agent | L2 | domain.test skill 接入 + flow 等价 |
| T3 | 新 flagship skill viral_content_engine_v1（全链路 + featured） | L2 | domain.test featured + 管线顺序 |
| T4 | AI prompt：render{Trend,Persona,Seo}Guidance + 接入 buildCopyPrompt（gated，不含「创作技能」） | L3 | ai.test 注入/缺省双向 |
| T5 | 测试：domain（agent/skill/flagship）+ ai（3 guidance）+ flow（新 agent 等价） | L3 | node --test 新增全绿 |
| T6 | 回归（177+新）+ next build + 文档 changelog | L2 | 全绿 + build ✓ |

6 个 task，无 L4、无 destructive、无跨用户副作用。

→ 'go' 进入 Work | 调整计划

---

## Phase 3: 变更日志（Work）

| Task | 状态 | 改动 |
|------|------|------|
| T1 | ✅ | lib/domain.js：agents[] 加 `trend`/`persona`/`seo`（各 7 字段全）+ buildAgentArtifact 3 条 + buildAgentSummary 3 条 |
| T2 | ✅ | lib/domain.js：ecom_tiktok(+trend,+seo)、rednote(+trend,+persona,+seo)、ugc_review(+persona)、hook_lab(+seo) 的 agents 序 |
| T3 | ✅ | lib/domain.js：新 flagship skill `viral_content_engine_v1`（brief→trend→strategy→hook→persona→copy→seo→qa→export，featured，图文链路 110 credits） |
| T4 | ✅ | lib/ai/workflow.js：`renderTrendGuidance`/`renderPersonaGuidance`/`renderSeoGuidance`（gated on skill.agents.includes，agent 缺省返回 ""，不含「创作技能」）+ 接入 buildCopyPrompt（trend→hook→persona→copyRules→seo→skill→brand 顺序） |
| T5 | ✅ | tests/domain.test.js +4（agent 契约 / 非 dead node / flagship / 流程接入）；tests/ai.test.js +1（3 guidance 注入 + copy-only 合成 skill 缺省双向） |
| T6 | ✅ | 回归 + build |

### 验证
- `node --test`：**182/182 pass**（177 既有 0 回归 + 5 新）
- `npm run build`：✓ 全路由预渲染成功
- 不变量回归（每 task 跑 invariant_tests = domain/ai/flow 三文件）：全绿
  - variants===3 / qa>=80 / hashtags 含 #platform / copy JSON {hook,caption,hashtags}：保持
  - KNOWN_AGENT_IDS 自动纳入新 agent；orderedAgentIds===skill.agents：保持
  - 「创作技能」仍仅 renderSkillClause 独占（ai.test:521/550 + 新 copy-only 合成 skill 断言）：保持

---

## Phase 4: 审查结果（Review — 6 视角）

| 视角 | 结论 |
|------|------|
| 架构 | 新 agent 走既有注册单点（push agents[] → KNOWN_AGENT_IDS/flowToSkill/getAgent 派生）；render* 复用 renderHookGuidance gated 模式；零新增耦合 |
| 安全 | 无 secret、无新用户输入路径、无网络（trend 为启发式 prompt 级，符合静态站边界） |
| 性能 | 多 3 个 buildAgentStep（同步、廉价）+ prompt 多 3 短行（≤ maxTokens 900）；无循环/N+1 |
| 代码质量 | render* 函数小且单一、注释解释 WHY、命名有语义、无 console.log；signature (brief,skill) 一致 |
| 测试覆盖 | agent 契约 + 非 dead node + flagship + 流程接入 + AI 注入双向（present/absent）；匹配 L2/L3 风险 |
| 集成连续性（第6视角） | ① 继承不变量全过（variants3/qa80/copyJSON/#platform/KNOWN_AGENT_IDS）② 无 dead code：3 agent 各接入≥1 skill + flagship featured 选择器自动显现 + render* 被 buildCopyPrompt 调用 ③ hook/Hook Lab 设计意图不破 ④⑤ 未碰 shared/api 边界，无半下沉漂移 |

**P0：无。 P1：无。**

**P2（记录，不阻塞，defer 下轮可选）：**
- P2-1：trend/persona/seo 当前为 **prompt 指令级**（注入生成指引），非独立候选生成 pass——与 hook MVP 边界一致（schema 焊死所致）。下轮可升级为独立 pass + 结构化产物。
- P2-2：trend 无真实趋势数据源（静态站边界，已在 non-scope 声明）。后续可在 platform preset 加 `trendHints` 让选题更具体。
- P2-3：估算（estimateCreditsForSkill 基于静态 estimatedCredits）与 per-agent event cost 是两套独立口径——既有设计，本轮未引入，无需处理。

→ P0/P1 无 → 'go' 进入 Compound

---

## Phase 5: 复利记录（Compound）

- **沉淀**：更新项目记忆 `aicrew-copy-engine.md`（新增「第二轮扩展」段），把 trend/persona/seo 三 agent + flagship + 流程优化纳入既有「注册单点 + gated render* 注入」模式，避免重复建档。
- **关键非显然点（复用价值）**：
  - 新 agent 的"真改输出"只能注入 `buildCopyPrompt`（无 buildStrategyPrompt，strategy/分镜全确定性）。
  - 往现有 skill 插 agent **只增不减**安全：credit 用静态 estimatedCredits 不汇总 agent cost；plan/events/flowToSkill 全派生。
  - render* 文本绝不含「创作技能」（renderSkillClause 独占）；已加 copy-only 合成 skill 缺省断言守门。
- **defer 下轮**（frontmatter 已记）：trend/persona/seo 升级为独立生成 pass（非 prompt 级）、platform preset 加 trendHints、新平台、variant 扩量、CTR 回流闭环。
