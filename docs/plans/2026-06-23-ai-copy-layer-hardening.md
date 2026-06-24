---
title: "AI 文案层加固（collision-safe）"
type: sprint
status: completed
created: "2026-06-23"
updated: "2026-06-23"
checkpoints: 0
tasks_total: 4
tasks_completed: 4
tags: [sprint, ai, copy, quality]
aliases: ["文案层加固"]

invariants:
  - "copy JSON 恒 {hook,caption,hashtags}；mergeAiCopy 只读三键"
  - "renderSkillClause 独占「创作技能」；新 render* 文本不得含该字面量"
  - "无 system AI 配置 / 解析失败 → 优雅回退确定性文案，整体不抛错"
invariant_tests:
  - tests/ai.test.js
  - tests/domain.test.js
deferred:
  - sprint: blocked
    item: "platform-expansion / i18n / trend深化 / variant扩量 —— 均改 lib/domain.js"
    deadline: "2026-08-15"
    reason: "lib/domain.js 被并行会话(manual-canvas-roboneo-parity + supabase 后端)占用，等其提交后再做"
---

# Sprint: AI 文案层加固（collision-safe）

> 背景：本轮原计划做 platform-expansion，Work 中发现**并行会话**正大改 `lib/domain.js`（+ 新增 supabase/db 后端、components、package.json），还原了平台预设。用户选择暂停平台轮、改做别的 defer。但**所有已记录 defer（i18n/trend深化/variant扩量）都触 `lib/domain.js`**，被同一冲突阻塞；i18n 的正确实现还会撞「平台行为单源 findPlatformPreset」不变量（不能为避撞把 platform===X 散落 workflow.js）。
>
> 故选 collision-safe 落点：**AI 文案层（lib/ai/workflow.js）**，对方未触及。直击原始痛点「推文吸引力」，零 domain.js 接触。

## Phase 1-2: Think + Plan
- Scope：仅 `lib/ai/workflow.js` + `tests/ai.test.js`。
- 两个高价值改动：
  1. 每条 variant 锁定专属钩子框架（当前 3 条共享平台 hookPatterns，差异仅靠 angle 字符串 → 真差异化）。
  2. AI JSON 提取容错（去 ```fence / 去尾逗号）→ 让更强的 AI 文案真正落地，而非解析失败静默回退弱兜底。
- Non-scope：任何 domain.js 改动（平台/skill/variants/copy schema）、i18n、对方在做的 canvas/db。

## Phase 3: Work
| Task | 状态 | 改动 |
|------|------|------|
| T1 | ✅ | workflow.js：`ANGLE_FRAMEWORK`(痛点开场/好奇缺口/促销冲刺→紧迫) + `renderAngleFramework(variant)`，接入 buildCopyPrompt（平台框架池后锁定本条专属框架）；无匹配角度返回 "" 向后兼容 |
| T2 | ✅ | workflow.js：`stripJsonNoise`(去 ```json 围栏 + 去对象/数组尾逗号) + `extractJson` 改为「原文→去噪全文→去噪 {…} 切片」依次尝试取首个可解析 |
| T3 | ✅ | ai.test.js +2：每条 variant 锁定不同框架（3 个框架名互异）；脏 JSON(围栏+尾逗号) 仍 copyApplied===variants.length |
| T4 | ✅ | 回归 + build |

### 验证
- `node --test`：191 pass / 0 fail（测试总数 192，含并行会话并发新增项）；我的 2 个新 AI 测试通过。
- `npm run build`：✓ Compiled successfully。
- 不变量：copy JSON 形状不变、「创作技能」仍 renderSkillClause 独占、解析失败仍优雅回退——全保持。

## Phase 4: Review（6 视角）
- 架构：复用 HOOK_FRAMEWORKS 单源；renderAngleFramework 与既有 render* gated 同构。
- 安全：无 secret / 无新输入路径。
- 性能：纯字符串处理，无新网络/循环。
- 代码质量：函数小、注释解释 WHY、命名有语义。
- 测试覆盖：per-angle 差异化 + JSON 容错双向覆盖。
- 集成连续性：零 domain.js 接触，未碰并行会话文件；继承不变量全过；无 dead code（renderAngleFramework 被 buildCopyPrompt 调用，stripJsonNoise 被 extractJson 调用）。
- **P0/P1：无。**

## Phase 5: Compound
- 关键经验：多会话并发改同仓库时，**先 git status 摸清对方占用的文件**，把本轮 scope 收敛到对方未触及的模块（此处 lib/ai/*），即可 collision-safe 推进而不打编辑战。
- 本轮仅改 `lib/ai/workflow.js` + `tests/ai.test.js`，可与并行会话独立提交。
- platform-expansion 仍 paused，等并行会话提交 domain.js 后在干净基线重应用（设计见 `2026-06-23-platform-expansion.md`）。
