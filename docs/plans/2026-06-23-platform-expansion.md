---
title: "跨境平台扩容（IG Reels / YouTube Shorts / Shopify PDP）"
type: sprint
status: completed
created: "2026-06-23"
updated: "2026-06-23"
checkpoints: 0
tasks_total: 4
tasks_completed: 4
blocked_by: "（已解除）并行会话曾占用 lib/domain.js 并还原 T1/T2；其提交 13013e1/019d8af 后在干净基线重应用完成"
tags: [sprint, feature, platform]
aliases: ["平台扩容", "跨境平台"]

# === 继承前两轮（copy-engine / agent-expansion）的不变量 ===
invariants:
  - "每个 active platform preset 必须带结构化 DNA：hookPatterns(∈HOOK_FRAMEWORKS) + copyRules{hookMaxChars,captionRange,emoji,lineBreaks,ctaStyle,ctaExamples}"
  - "平台行为一律经 findPlatformPreset 取数，不在业务逻辑散落 platform===X 硬编码分支"
  - "variants.length===3 / copyApplied===3 / imageAppliedCount===3（提质不增量）"
  - "qa.overallScore >= 80；copy JSON 恒 {hook,caption,hashtags}；hashtags 含 #${platform}"
  - "renderSkillClause 独占「创作技能」字面量；新文本不得含该字面量"
  - "交付物形态由 isVideoSkill 决定（视频/图文两套），与平台正交"

invariant_tests:
  - tests/domain.test.js
  - tests/ai.test.js
  - tests/flow.test.js

deferred:
  - sprint: next
    item: "文案 i18n：Western 平台输出英文（preset.lang + COPY_SYSTEM 分支）"
    deadline: "2026-08-15"
    reason: "本轮平台 DNA 基建先行；i18n 是独立轴，铺好后下轮 trivial"
  - sprint: next
    item: "trend/persona/seo 升级为独立生成 pass + platform trendHints"
    deadline: "2026-08-15"
    reason: "上轮 prompt 级 MVP，独立 pass 需扩 copy JSON schema"
  - sprint: next
    item: "variant 扩量>3 + A/B pack"
    deadline: "2026-08-01"
    reason: "需先重构 variants===3 契约"
  - sprint: next
    item: "publish/CTR learning loop"
    deadline: "2026-09-01"
    reason: "需后端 + 数据管线"
---

# Sprint: 跨境平台扩容

> 承接 cac0ba8（文案引擎）/ 03a4dfd（agent 扩容+流程优化）。原始 4 线程已全覆盖，本轮从 deferred 池开「平台扩容」新方向。

## Phase 1: 需求分析（Think — CEO/产品视角）

### 背景
当前仅 抖音 + 小红书 两个 active 平台；`platformPresets` 注释里留了 reels/shorts/shopify 三个**旧浅 stub**（copy-engine 升级前的形态，只有单句 tone，缺 hookPatterns/copyRules）。跨境卖家（bestFor 已含「跨境卖家」）无法选 IG Reels / YouTube Shorts / Shopify PDP。

### Scope（做什么）
- 恢复并**现代化** 3 个平台预设，补齐结构化 DNA（与 抖音/小红书 同构）：
  - `reels` Instagram Reels（9:16，hook 3s，视觉情绪化、轻 CTA）
  - `shorts` YouTube Shorts（9:16，hook 5s，问题驱动、信息密度高、强保留）
  - `shopify` Shopify PDP（1:1，hook 4s，卖点清晰、信任背书、促销明确）
- 每个预设带：hookPatterns(∈HOOK_FRAMEWORKS) + copyRules{hookMaxChars/captionRange/emoji/lineBreaks/ctaStyle/ctaExamples} + creditMultiplier + platformFit。
- `detectPlatform` 加新平台名/关键词路由（reels/instagram、shorts/youtube、shopify/pdp）。
- 找到并接通 UI 平台选择器来源（确保新平台可选，不留 dead 数据）。
- 验证全链路：新平台经 findPlatformPreset 自动驱动 ratio（画幅/出图尺寸）、hookSeconds（钩子指引）、copyRules（prompt 注入）、creditMultiplier/platformFit（报价/质检）——无需任何 platform===X 分支。

### Non-scope（不做什么）
- ❌ 文案 i18n（Western 平台输出英文）—— defer 下轮；本轮新平台沿用现有 zh 文案引擎 + 平台专属 DNA（zh-first 跨境草稿工作流），基建铺好让 i18n 下轮 trivial。
- ❌ 新增平台专属 skill —— 现有 skill 平台中性（platform 来自 brief），自动适配新平台。
- ❌ 改 variants 数 / copy JSON 形状 / 核心管线契约。
- ❌ 真实平台 API（发布/拉数据）。

### Success（成功标准）
- 3 个新平台预设全带结构化 DNA，通过「每个 active preset 必有 hookPatterns+copyRules」契约（扩展 domain.test 遍历全 presets，不再硬编码 2 个）。
- detectPlatform 正确路由 3 个新平台名；findPlatformPreset 命中。
- UI 平台选择器列出全部 active 平台（数据驱动，新平台自动显现，非硬编码）。
- 全链路 per-platform 验证：ratio 进 variant.aspectRatio + 出图尺寸；copyRules 进 copy prompt；qa>=80；credits 正常。
- 继承不变量全保持；既有 182 测试 0 回归 + 新增平台测试。

### Risks（风险）
- R1 恢复浅 stub 若不补 DNA → 新平台文案引擎注入静默退化（renderHookGuidance/renderCopyRules 返回空）。本轮强制补全。
- R2 Western 平台 zh 文案的预期落差 → 已在 non-scope 显式声明 i18n 推迟，文档化避免误解。
- R3 detectPlatform 不加路由 → parseBriefText 把新平台误判回抖音。
- R4 UI 平台列表若硬编码 [抖音,小红书] → 新平台不可选成 dead 数据。Phase 2 集成路径必须定位并改为数据驱动。
- R5 domain.test:335 硬编码遍历 2 平台 → 扩为遍历全 active presets，否则新平台 DNA 无契约守护。

→ 'go' 进入 Plan | 调整范围（如改 Chinese 平台集 视频号/快手/B站，或本轮就做 i18n）| 'skip'

---

## Phase 2: 技术方案（Plan — 架构师视角）

### 入场扫描 - Invariants 继承（回归扫描）

| 子系统 | 继承 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| 平台 DNA | 每 active preset 必带 hookPatterns(∈HOOK_FRAMEWORKS)+copyRules | 3 新 preset 全补结构化 DNA；测试改为遍历全 presets |
| 平台取数 | 一律经 findPlatformPreset，无 platform===X 分支 | findPlatformPreset 已通用（按 name/id 匹配）；新平台零分支自动驱动 ratio/hookSeconds/copyRules/credit |
| 文案引擎 | copy JSON {hook,caption,hashtags}；hashtags 含 #platform；「创作技能」独占 | 不碰 buildCopyPrompt 结构；新平台仅经 preset 数据流入；不加任何文本 |
| variants | variants/copyApplied/imageApplied===3 | 不碰 buildVariants 角度数组 |
| 交付物 | isVideoSkill 决定视频/图文，与平台正交 | 不碰；shopify 1:1 经 imageSizeFor 通用处理 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 产出可见 | 刷新后 |
|--------|----------|--------|----------|--------|
| platformPresets 加 3 preset | 用户点平台 chip | OrchestratorConsole:548 `platformPresets.map`（数据驱动） | ✅ chip 自动显现(name+ratio+tone) | ✅ params.platform 即事实 |
| detectPlatform 加路由 | 自由文本 idea 描述 | parseBriefText → detectPlatform → brief.platform | ✅ 自由文本能识别新平台 | ✅ |
| 新平台全链路 | 选中新平台运行 | findPlatformPreset → ratio/copyRules/credit/qa | ✅ 出图尺寸/aspectRatio/文案 DNA/报价 per-platform | ✅（内存态，同所有平台） |

> 全链路收口，无 ❌：UI 选择器与文本检测两条入口都接通；新平台经既有通用取数自动驱动。

### 入场扫描 - 债务清单（前轮 deferred）

| 来源 | 议题 | 本 sprint 决策 | deadline |
|------|------|----------------|----------|
| agent-expansion | 文案 i18n（Western 出英文） | ⏭ 推迟（本轮铺平台 DNA 基建，i18n 下轮 trivial） | 2026-08-15 |
| agent-expansion | trend/persona/seo 独立 pass + trendHints | ⏭ 推迟 | 2026-08-15 |
| tweet-copy-engine | variant 扩量>3 + A/B pack | ⏭ 推迟 | 2026-08-01 |
| tweet-copy-engine | CTR 回流闭环 | ⏭ 推迟 | 2026-09-01 |

### 设计要点（3 平台结构化 DNA）

| 平台 | id | ratio | hookSeconds | hookPatterns | copyRules 要点 | credit/fit |
|------|----|----|----|----|----|----|
| Instagram Reels | reels | 9:16 | 3 | 真实自白/社会证明/好奇缺口/具体数字 | hook≤16，情绪 emoji，轻 CTA（收藏/follow） | 0.92 / 86 |
| YouTube Shorts | shorts | 9:16 | 5 | 好奇缺口/具体数字/痛点开场/反共识 | hook≤24，克制 emoji，强保留 CTA（关注看完整） | 0.95 / 85 |
| Shopify PDP | shopify | 1:1 | 4 | 社会证明/具体数字/痛点开场/紧迫 | hook≤28，专业克制，促销+信任 CTA | 0.90 / 87 |

- detectPlatform 新路由：reels/instagram → "Instagram Reels"；shorts/youtube → "YouTube Shorts"；shopify/pdp/独立站 → "Shopify PDP"。
- 文案语言本轮仍 zh（i18n defer）；平台差异体现在 hook 节奏/框架/字数/emoji/CTA 风格——经 copyRules 真实流入 prompt，非装饰。

### 任务拆解

| # | Task | 风险 | 验证 |
|---|------|------|------|
| T1 | platformPresets 恢复+现代化 reels/shorts/shopify（全结构化 DNA） | L2 | domain.test 遍历全 presets DNA 契约 |
| T2 | detectPlatform 加 3 平台名/关键词路由 | L1 | domain.test 路由断言 |
| T3 | 测试：DNA 契约遍历全 presets + detectPlatform 路由 + per-platform 全链路(ratio/copyRules/qa) + ai.test 新平台 copy prompt DNA 注入 | L3 | node --test 新增全绿 |
| T4 | 回归(182+新) + build + 文档 changelog | L2 | 全绿 + build ✓ |

4 个 task，无 L4、无 destructive、无跨用户副作用。

→ 'go' 进入 Work | 调整计划

---

## Phase 3: Work（⏸ PAUSED — 并发冲突）

**暂停原因**：Work 期间发现另一会话（`docs/plans/2026-06-23-manual-canvas-roboneo-parity.md`，含 `lib/flow/overlay.js`、`components/canvas/CanvasStudio.jsx`、handoff-2/3）正在并行改 `lib/domain.js`，把本轮已写的 T1（reels/shorts/shopify 结构化 DNA 预设）+ T2（detectPlatform 路由）**还原**了；我的 T3 测试残留 → 4 个平台测试失败。

经用户确认：**暂停本轮，等对方会话提交后在干净基线重应用**。

**已做的干净退出**（避免与对方编辑互相覆盖、不替对方提交未完成工作）：
- 回退我加到 tests/ai.test.js / tests/domain.test.js 的平台测试 → 这两个文件不再有我的残留（ai.test.js 已回 HEAD）。
- 我的 domain.js T1/T2 已被对方还原（git 确认 marker=0），无需再动。
- 唯一属于本轮的未提交文件 = 本 sprint doc（untracked），未提交。

**当前仓库状态（非本轮造成）**：对方会话的 in-flight 改动使套件红 1 项——其新增 skill `rednote_account_diagnostic_v1` 用了非法 group `"rednote"`（合法 group：featured/ecom/beauty/shortvideo）。留给对方修，本轮不碰。

**resume 清单（对方提交、基线干净后重应用，全部设计已在 Phase 1/2）**：
1. T1：platformPresets 取消注释 reels/shorts/shopify，按 Phase 2 DNA 表补全 hookPatterns+copyRules+creditMultiplier+platformFit。
2. T2：detectPlatform 加 reels/instagram、shorts/youtube、shopify/pdp/独立站 路由（避开 ig/yt 等过短 token）。
3. T3：DNA 契约测试改为遍历全 platformPresets；加 detectPlatform 路由测试 + per-platform 全链路测试 + ai.test 新平台 copy DNA 注入测试。
4. T4：回归 + build + changelog。

### ✅ RESUMED & 完成（并行会话已提交 13013e1/019d8af，domain.js 干净基线）

| Task | 状态 | 改动 |
|------|------|------|
| T1 | ✅ | lib/domain.js：reels/shorts/shopify 取消注释 + 补全结构化 DNA（hookPatterns∈HOOK_FRAMEWORKS + copyRules{hookMaxChars/captionRange/emoji/lineBreaks/ctaStyle/ctaExamples} + creditMultiplier/platformFit）。active 平台 2→5 |
| T2 | ✅ | lib/domain.js：detectPlatform 加 reels/instagram、shorts/youtube、shopify/pdp/独立站 路由（避开 ig/yt/ins 过短 token） |
| T3 | ✅ | tests/domain.test.js：import platformPresets；DNA 契约测试改遍历全 presets（+captionRange/credit/fit 校验）；+3 测试（跨境平台 active+差异化 / detectPlatform 路由 / per-platform 全链路 ratio+#platform+qa）。tests/ai.test.js：+1 新平台 copy prompt DNA 注入（平台名+5秒+专属 CTA） |
| T4 | ✅ | 回归 + build |

### 验证
- 平台不变量三件套 `node --test domain/ai/flow`：120/120 pass（含 4 个新平台测试）。
- 全套 `node --test`：201 tests / 200 pass / 0 fail（1 个 db.integration 无 DB 时自跳过，属并行会话）。
- `npm run build`：✓ Compiled successfully。
- UI：OrchestratorConsole 平台 chip 数据驱动（platformPresets.map），新平台自动显现，无需改 UI。

---

## Phase 4: 审查结果（Review — 6 视角）

| 视角 | 结论 |
|------|------|
| 架构 | 平台行为全经 findPlatformPreset 取数，零 platform===X 分支；新平台只是数据，自动驱动 ratio/hookSeconds/copyRules/credit |
| 安全 | 无 secret、无网络、detectPlatform 仅字符串匹配 |
| 性能 | 平台数据扩容，无新循环/请求；prompt 长度不变（每平台同结构 DNA） |
| 代码质量 | DNA 结构与既有 抖音/小红书 同构；注释解释 WHY；detectPlatform 避开过短歧义 token |
| 测试覆盖 | DNA 契约改遍历全 presets（守新平台）+ 路由 + 全链路 + AI 注入，匹配 L1/L2/L3 |
| 集成连续性（第6视角） | ① 继承不变量全过（variants3/qa80/copyJSON/#platform）② 无 dead code：5 平台经 UI chip 数据驱动可选 + 全链路验证 ③ 未破并行会话的 19 skill / canvas / db 工作 ④⑤ 未碰 shared/api 边界 |

**P0/P1：无。**

P2（记录，已 defer）：文案 i18n（Western 平台输出英文）——本轮平台 DNA 基建已铺好，i18n 下轮经 preset.lang + COPY_SYSTEM 分支 trivial（见 frontmatter deferred）。

## Phase 5: 复利记录（Compound）

- **沉淀**：更新项目记忆 [[aicrew-platform-ecosystem]] —— 加平台 = platformPresets 加全结构化 DNA（hookPatterns+copyRules，缺则文案引擎注入静默退化）+ detectPlatform 路由；UI chip 数据驱动无需改；平台行为单源 findPlatformPreset（这也是 i18n 不能为避并发冲突而散落 platform===X 的原因）。
- **并发协作经验**：多会话改同仓库——先 `git status`/`git log` 摸清对方占用与提交节奏；本轮被对方还原后选择「暂停+干净退出」，待其提交干净基线再重应用，避免编辑战（详见暂停记录 + collision-safe 改做 [[2026-06-23-ai-copy-layer-hardening]]）。
- **未提交**：本轮 domain.js/tests 改动 + AI 层加固（上一步）均待提交；建议分两个 commit（平台扩容 / AI 层加固）。
