---
title: "三模式创作参数：平台/受众/素材/Skill"
type: sprint
status: completed
created: "2026-06-23"
updated: "2026-06-23"
checkpoints: 0
tasks_total: 8
tasks_completed: 8
tags: [sprint, feature, orchestration, brief]
aliases: ["创作参数条", "mode-creative-params"]

# 本 sprint 立的不变量，后续 sprint 必须保持
invariants:
  - "三模式（auto/semi/manual）仍只产出合法 Flow，经 onRun(brief, flow, meta) → flowToSkill → domain 管线（单桥不变量）"
  - "brief 是唯一事实来源：4 个创作参数一律 merge 进 brief，不另开旁路 prop"
  - "lib/flow 纯层零 import lib/ai；素材文件读取在组件，纯校验/归一在 lib"
  - "平台恒为 {小红书, 抖音} 两个 preset；skill 从 domain.skills 取"
  - "剔除控制字符走 codePointAt 过滤，不写字面量控制字符正则（见 tooling-write-controlchar-regex）"

# 本 sprint 不变量回归测试入口（每 task 必跑）
invariant_tests:
  - tests/domain.test.js
  - tests/flow.test.js
  - tests/ai.test.js

deferred:
  - sprint: next
    item: "独立 Quick/结构化 brief 表单复用同一参数条"
    deadline: "2026-07-15"
    reason: "本期聚焦用户明指的「三模式」编排台"
  - sprint: next
    item: "素材 AI 识别/自动打标 + 服务端素材库持久化"
    deadline: "2026-07-15"
    reason: "本期仅做引用 + 提示注入，客户端 data-URL"
---

# 三模式创作参数：平台 / 受众 / 素材 / Skill

> 需求原文：「每种模式都需要支持设置具体的平台（小红书和抖音）、设置具体的受众、上传素材、指定具体的 skill」。结合 `docs/AICrew_Studio_RoboNeo_Product_PRD.md`（§8.2 Skill required_inputs、§10.6 Brief Agent）重新分解当前参数。

## Phase 1: 需求分析

### 现状（当前「参数」）
三模式共用单个 `idea` textarea（`OrchestratorConsole.jsx:317`），brief 由 `parseBriefText(idea)` 派生：
- **平台**：靠 `detectPlatform(text)` 文本检测（命中小红书 token → 小红书，否则抖音）。无显式选择器。
- **受众**：靠正则 `/(?:受众|人群|audience)[:：]?\s*(...)/` 从文本抓，抓不到给默认。无显式字段。
- **素材**：`addAsset()` 造占位资产，**未进 brief**、不参与生成。
- **Skill**：auto/semi 由 `routeIdeaToFlow(idea, mode)` 自动匹配；manual 靠对话搭 flow。**无显式选择器**。

brief 形状（`normalizeBrief`，domain.js:382）：`productName / sellingPoints / targetAudience / platform / goal / style / productCategory / promotion / locale`。已含 platform/targetAudience，缺 materials。

### 目标（PRD 对齐）
PRD §8.2 Skill `required_inputs` 含 `product_images / target_audience / platform / language / selling_points`；§10.6 Brief 是「后续所有 Agent 的唯一事实来源」。本 sprint 把这 4 个 required input 在三模式 UI 显式可设，并真正 merge 进 brief。

### 范围
**做**：三模式共享创作参数条（平台选择器 / 受众输入 / 素材上传 / skill 选择）→ merge 进 brief → 经单桥 `onRun` 执行；指定 skill 时用 `skill.agents → linearFlow` 统一播种 flow。
**不做**：视频接入；独立 Quick/结构化 brief 表单参数化（deferred）；素材 AI 识别/打标 + 服务端持久化（deferred）。

### 成功标准
1. auto/semi/manual 每个模式都能选平台、填受众、传素材、选 skill，且真实影响生成的 brief/flow/出图。
2. `npm test` 全绿；`next build` 通过。
3. 单桥不变量与 flow↔preset 等价不变量不破。

### 风险 / 假设
- `[Image #4]` 未附实际图 → 参数条视觉布局自设计，**待用户视觉确认**（Work UI task 标注）。
- 素材上传 = 真 `<input type=file>` + MIME 白名单 + 8MB 上限（复用画布导入守卫）。
- 指定 skill = 可选覆盖：留空→router 自动匹配（现状）；选定→播种该 skill flow。

---

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| Flow 编排（[[aicrew-flow-orchestration]]） | 三模式只产合法 Flow，经 `flowToSkill` 单桥复用 domain 管线 | 4 参数 merge 进 brief；skill 选择经 `skillToFlow→linearFlow` 仍产合法 Flow，不绕 onRun |
| 平台生态（[[aicrew-platform-ecosystem]]） | 加平台=改 platformPresets；交付物由 isVideoSkill 决定 | 平台选择器只从 `platformPresets` 取（小红书/抖音），不新增硬编码分支 |
| AI 真实化（[[aicrew-make-it-real]]） | brief 流入 buildCopyPrompt/buildImagePrompt；图文真出图 | 素材作为 image prompt 引用提示注入，复用现有 prompt 注入点 |
| 纯层隔离（[[aicrew-canvas-runtime]]） | lib/flow、lib/canvas 零 import lib/ai | skillToFlow 放 lib/flow 纯函数；素材读取在组件，纯校验在 lib/storage |
| 工具 gotcha（[[tooling-write-controlchar-regex]]） | 控制字符过滤用 codePointAt | 素材文件名/校验沿用 codePointAt sanitize |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| 平台选择器 | onChange params.platform | merge 进 brief.platform | 随 task（内存+主 state） | ✅ task 已存 |
| 受众输入 | onChange params.audience | merge 进 brief.targetAudience | 随 task | ✅ |
| 指定 skill | onChange params.skillId | skillToFlow 播种 flow + flowToSkill 物化 | 随 task.skillId | ✅ |
| 上传素材 | file input → FileReader dataURL | validateMaterial → brief.materials + 真实 asset | brief 随 task；asset 进 state.assets | ✅ asset 列表可见 |

> 素材 dataURL 本期不进独立 storage key（随 task brief 即可）；大体量持久化已 deferred。素材→真实 asset 入 `state.assets` 保证「上传后素材库可见」链路闭合，不留静默丢失。

### 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|-------------|------|----------------|----------|
| make-it-real | P2-T4 服务端下载端点 | ⏭ 维持 deferred（与本 sprint 无关） | 2026-07-15 |
| make-it-real | P6-T4 editImage | ⏭ 维持 deferred | 独立 sprint |

### 技术方案概要
1. **brief 扩展**：`normalizeBrief` 增 `materials`（`[{name, type, ref}]`）passthrough；新增纯函数 `mergeCreativeParams(brief, {platform, audience, skillId, materials})` 把参数覆盖进 brief（platform→preset 名、audience→targetAudience）。
2. **skill→flow 桥**：`lib/flow/model.js` 增 `skillToFlow(skillId, mode, brief)` = `linearFlow(findSkill(skillId).agents, mode, brief)`，三模式统一播种。
3. **素材校验**：`lib/storage/materialStore.js` 纯函数 `validateMaterial({name,type,size})`（MIME 白名单 image/*、≤8MB、codePointAt 清洗文件名）+ `normalizeMaterials(list)`。FileReader 在组件。
4. **prompt 注入**：`lib/ai/workflow.js` 的 `buildImagePrompt` 读取 `brief.materials` 名称作为 reference hint（best-effort，无材料则不变）。
5. **UI 参数条**：`OrchestratorConsole` 共享区（modeBlock 下、ideaField 上）渲染参数条，本地 `params` state；三模式共用。`triggerRun` 合并 `mergeCreativeParams(parseBriefText(idea) | route.brief, params)`；`params.skillId` 非空→`skillToFlow` 覆盖 targetFlow。
6. **AICrewStudio 集成**：`onRunFlow`/`runFlowAndCommit` 已收 brief；上传素材额外 `createAsset` 真入 `state.assets`。

### 任务拆解

| # | Task | 层 | 风险 | 测试 |
|---|------|----|----|----|
| T1 | `normalizeBrief` 增 materials + `mergeCreativeParams` 纯函数 | lib/domain | L2 | domain.test：merge 覆盖 platform/audience/materials |
| T2 | `skillToFlow(skillId, mode, brief)` 桥（linearFlow 复用） | lib/flow | L2 | flow.test：skill→合法 flow，agents 同源 |
| T3 | `lib/storage/materialStore.js` validateMaterial/normalizeMaterials | lib/storage | L2 | material-store.test：MIME 拒非 image、超限拒、文件名清洗 |
| T4 | `buildImagePrompt` 注入 brief.materials reference hint | lib/ai | L2 | ai.test：含材料时 prompt 带引用、无材料不变 |
| T5 | OrchestratorConsole 参数条 UI（平台/受众/skill/素材）+ params state | component | L2 | 手验 + build（无 DOM 测试框架） |
| T6 | `triggerRun` 合并 params→brief + skillId→skillToFlow 播种（三模式） | component | L3 | flow.test 覆盖 skillToFlow；手验三模式 |
| T7 | AICrewStudio：上传素材→真实 asset 入 state + brief 透传持久化 | component | L2 | 手验 + build |
| T8 | 参数条 CSS（.oc-params 等） | styles | L1 | build |

> Task 数 = 8（≤8），无 L4。auto-mode 入场 checklist 三项已填。

✓ auto: phase 2 → 3 — 任务数 8、无 L3 阻塞性风险（T6 L3 但范围窄且有 flow.test 守）、入场 checklist 三项齐全、与原始需求零 scope creep

---

## Phase 3: 变更日志

全 8 task 实施完成。`node --test` 148→162 全绿（+14），`next build` 通过（17 路由）。

| Task | 改动 | 测试 |
|------|------|------|
| T1 | `lib/domain.js`：`normalizeBrief` 增 `materials` passthrough；新增纯函数 `mergeCreativeParams(brief, params)`（平台/受众/素材覆盖进 brief，skillId 不入 brief） | domain.test +3 |
| T2 | `lib/flow/model.js`：import `findSkill`；新增 `skillToFlow(skillId, mode, brief)` = `linearFlow(skill.agents)` | flow.test +2（含 skill→flow→skill 往返） |
| T3 | 新建 `lib/storage/materialStore.js`：`validateMaterial`（MIME 白名单 image/* + ≤8MB）、`sanitizeMaterialName`（codePointAt 非正则）、`normalizeMaterial(s)`、`materialNames` | material-store.test +8（新文件） |
| T4 | `lib/ai/workflow.js`：`buildImagePrompt` 注入 `brief.materials` 引用（无素材时 prompt 不变） | ai.test +2 |
| T5 | `OrchestratorConsole.jsx`：共享 `paramsBar`（平台 chips / 受众输入 / skill select / 素材上传），三模式（auto/semi/manual）均渲染；`params` state + FileReader 上传 + 校验错误内联 | 手验 + build |
| T6 | `triggerRun`/`runRouter`/`switchMode` 接线：`mergeCreativeParams` 合并参数进 brief；`params.skillId` 非空→`skillToFlow` 播种 flow（三模式统一，跨模式保留），仍经 `onRun(brief,flow,meta)` 单桥 | flow.test 覆盖 skillToFlow |
| T7 | `AICrewStudio.jsx`：`ingestBriefMaterials` 把上传素材按 name 去重登记进 `state.assets`（ref 存 dataURL），闭合「上传→素材库可见」；接入 `runFlowAndCommit` | 手验 + build |
| T8 | `styles/globals.css`：`.oc-params` 等参数条样式（平台 chip / 输入 / select / 素材 chip 缩略图 + 移除） | build |

### auto-mode gate 记录
- ✓ auto: phase 1 → 2（scope 明确、无 L4/destructive、无 scope creep）
- ✓ auto: phase 2 → 3（8 task、入场 checklist 三项齐、无 L3 阻塞）
- ⚠ 强制保留：`[Image #4]` 视觉布局待用户确认（信息缺口，非 gate 但已标注）

---

## Phase 4: 审查结果

5+1 视角 inline 审查（无 DOM 框架，UI 走 build + 手验；lib 核心有自动测试）。

| 视角 | 结论 |
|------|------|
| 架构 | ✓ 单桥不变量保持：4 参数→brief（mergeCreativeParams）、skill→flow（skillToFlow）→onRun→flowToSkill→domain 管线 |
| 安全 | 素材 image/* + ≤8MB + 文件名 codePointAt 清洗；dataURL `<img>` 无 XSS。⚠ 素材名进 image prompt 有理论 prompt-injection（用户自有会话/自有上传，低危）→ 记 backlog |
| 性能 | FileReader 异步、materials 体量小、无重渲染热点 |
| 代码质量 | 纯函数下沉、注释解释 WHY、全程 immutable |
| 测试覆盖 | lib 核心（merge / skillToFlow / 素材校验 / prompt 注入）有测试（+14）；UI build + 手验 |
| 集成连续性(6th) | 5 条 invariant 全保持；新 export 均被消费（`normalizeMaterials` 仅测试引用——对称 API，记为可接受） |

**P0**：无。
**P1（已修）**：`triggerRun` 对 `params.skillId` 冗余再 `skillToFlow` 播种，会覆盖 semi 勾选 / manual 对话对已播种 flow 的微调 → 改为直接用 live `targetFlow`（onPickSkill/switchMode/runRouter 已保证其为 skill 播种态）。
**P2（已修/记录）**：① `.oc-material-remove` 用了不存在的 `--surface-1` → 改 `--surface`；② 素材名 prompt-injection（低危，backlog）；③ `normalizeMaterials` 应用层未接线（测试覆盖，保留对称 API）。

### 已知限制 / 待确认
- `[Image #4]` 未附实际图 → 参数条视觉布局为自设计，**待用户视觉确认**。
- 手动模式选「含 video 的 skill」（抖音商品广告/短剧）会在画布引入 video 节点，输出仍走 video placeholder（沿用 [[aicrew-make-it-real]] 的 video 恒 placeholder 约束）；与「手动 chat 加 video 被硬拒」是两条不同路径，preset 路径合法。

---

## Phase 5: 复利记录

- **新增能力**：三模式（auto/semi/manual）共享创作参数条，PRD §8.2 的 4 个 required_inputs（平台/受众/素材/skill）显式可设并真实影响 brief/flow/出图。
- **关键决策沉淀**：
  1. 4 参数全部收敛进 brief（唯一事实来源），skillId 例外（驱动 flow 而非内容事实，经 skillToFlow 单桥）——守 [[aicrew-flow-orchestration]] 单桥 + flow↔preset 等价不变量。
  2. `skillToFlow = linearFlow(skill.agents)` 复用既有线性链构造，三模式统一播种；skill 播种态由 onPickSkill/switchMode/runRouter 维护，triggerRun 只读不再播种（避免覆盖用户微调）。
  3. 素材：FileReader 在组件、纯校验（MIME/体量/文件名 codePointAt）下沉 lib/storage/materialStore；上传经 ingestBriefMaterials 去重登记进 state.assets 闭合「素材库可见」。
- **测试**：148→162（+14）。**Build**：17 路由通过。
- **记忆更新**：[[aicrew-flow-orchestration]]（创作参数条 + skillToFlow + mergeCreativeParams 段）。
- **deferred 顺延**：独立 Quick/结构化表单参数化、素材 AI 识别/服务端持久化（见 frontmatter）。
