---
title: "小红书内容层缺口补全：图片配文 / 首评互动 / 发布优化（对标小鸡AI 全生态）"
type: plan
status: completed
created: "2026-06-29"
updated: "2026-06-29"
tags: [plan, rednote, 获客, 内容层, 图片配文, 首评, 发布优化, 小鸡AI]
related: ["2026-06-29-xiaoji-rednote-full-ecosystem-integration"]
invariants:
  - "rednotePromotionStages 9 阶段顺序 deepEqual 焊死，不增减阶段"
  - "新 skill 只走内容层，零自动化/爬虫/批量发布/自动评论点赞"
  - "新 skill group:rednote → 经 PROMOTION_REGISTRY 自动入 skillsInGroup/funnel/recommend，UI 零改动"
  - "每个 rednote skill：platform=小红书 + rednoteStage + recommendTags≥4 + formats≥4 + agents含qa+export"
invariant_tests:
  - tests/domain.test.js
---

# 小红书内容层缺口补全

> 研究（`2026-06-29-xiaoji-rednote-full-ecosystem-integration.md`）结论：小鸡AI 全生态 = 内容层 + RPA 自动化层。AICrew 已强覆盖内容层，净缺口 3 个。本 sprint 补这 3 个内容层技能，自动化层明确不做。

## Phase 2: 技术方案

### 入场扫描 - Invariants 继承

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| rednote 漏斗 | `rednotePromotionStages` 9 阶段 deepEqual 焊死 | 新技能入既有 `content_production` 阶段，不增减阶段 |
| 通用内核 | `recommendPromotionSkills` + `PROMOTION_REGISTRY` 单点 | 新技能自动被路由/分组，不复制评分逻辑 |
| skill 契约 | platform/stage/tags≥4/formats≥4/qa+export | 3 新技能逐项满足，production-ready 测试遍历守住 |
| 合规红线 | 只产内容/话术/策略，不碰自动化 | 3 新技能均为内容产物；注释标注"对标小鸡AI X 但不自动化" |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| 3 新 rednote skill | 用户在 小红书 tab 选 | PROMOTION_REGISTRY → funnel 分段 | ✅ 静态 catalog | ✅ 自动渲染 |
| flowToSkill → domain 管线 | 选 skill 跑创作 | runCreativeWorkflow | ✅ 既有 | ✅ 出图文产物 |

全链路无"❌"——新技能复用既有 UI/管线，零新增接线。

### 入场扫描 - 债务清单

无前序 sprint 遗留待办项。

### 改动清单

1. `lib/ai/workflow.js`：`HOOK_FRAMEWORKS` += `互动提问钩`（首评互动技能的签名钩，wired，非死代码）。
2. `lib/domain.js`：`skills[]` += 3 技能（均 group:rednote / platform:小红书 / rednoteStage:content_production）：
   - `rednote_image_caption_v1` 图片智能配文（对标小鸡AI 图片智能配文）
   - `rednote_first_comment_v1` 首评氛围与互动引导（对标 AI 氛围评论+自动点赞，只产自己笔记的引导内容）
   - `rednote_publish_optimizer_v1` 发布优化清单（对标定时/批量发布，只产发布前自检清单）
3. `tests/domain.test.js`：`rednoteSystemSkillIds` += 3 id（获执行覆盖）；路由断言 += 3（空格关键词 query）。

## 任务拆解

| # | Task | 风险 | 测试 |
|---|------|------|------|
| 1 | workflow.js 加 `互动提问钩` 框架 | L2 | 既有 workflow 测试回归 |
| 2 | domain.js 加 3 技能 | L2 | production-ready + funnel + skillsInGroup 遍历守住 |
| 3 | test 加 3 id + 3 路由断言 | L2 | `node --test` 全绿 |

## 验证策略

- `node --test`：全绿（新增 3 路由断言 + 3 执行覆盖）。
- node sanity：逐个验证 3 新 skill 的 query 唯一命中（避免与既有技能评分冲突）。
- `npm run build`：编译通过（UI 未改，应稳过）。

## Phase 4-5: 审查 + 复利

- Review：P0/P1 无。第 6 视角全过（9 阶段 invariant 未动；互动提问钩已接 first_comment、3 技能经 PROMOTION_REGISTRY 自动入 funnel/UI，无 dead code；自动化层明确排除无 scope creep）。
- 验证：`node --test` 285 pass/0 fail/2 skipped；`npm run build` 编译通过。
- Compound：研究 1（小鸡AI 全生态拆解 + 边界矩阵）；记忆更新 `aicrew-rednote-acquisition`（映射法则：自动化功能取内容产物半）+ MEMORY.md 索引钩。

