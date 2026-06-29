---
title: "小红书获客生态扩展（参照小鸡AI 产品矩阵）"
type: plan
status: done
created: "2026-06-29"
updated: "2026-06-29"
tags: [plan, rednote, 获客, 小鸡AI, skills, funnel]
related: ["2026-06-29-xiaohongshu-acquisition-ecosystem-xiaoji-benchmark", "2026-06-23-platform-expansion"]
---

# 小红书获客生态扩展

> 研究依据见 `docs/research/2026-06-29-xiaohongshu-acquisition-ecosystem-xiaoji-benchmark.md`。

## 目标

把小红书技能体系从「内容生产 + 投放 + 复盘」补齐到完整**获客漏斗**，对标小鸡AI 产品矩阵中 AICrew 可合规映射的「内容/话术/策略产物」层。

## 范围

- ✅ 12 个获客类图文/文本技能（话术/SOP/策略产物，`agents` 不含 `video` → 图文链路）
- ✅ 2 个新漏斗阶段：`lead_capture` 线索捕捉、`private_domain` 私域承接
- ✅ 3 个获客专属钩子框架 + skill 级 `hookPatterns` 覆盖机制
- ❌ 不做：爬虫/实时数据、自动私信评论、自动养号、多账号批量发布、客资 CRM（越界 + 踩平台合规红线）

## 漏斗演进（7 → 9）

```
诊断定位 → 搜索策略 → 内容生产 → 达人种草 → 投放放大
        → 线索捕捉(新) → 转化承接 → 私域承接(新) → 复盘优化
```

- `lead_capture` 线索捕捉：主动把公域曝光收口成线索（截流/钩子/触发），与下游被动「转化承接」正交。
- `private_domain` 私域承接：线索沉淀进站内外私域（私信 SOP/群聊/企业号），与公域「转化承接」分层。

## 新增技能（12）

| id | 名称 | rednoteStage | 对标小鸡AI |
|----|------|--------------|-----------|
| rednote_comment_intercept_v1 | 评论区截流话术 | lead_capture | 评论区截流（话术层）|
| rednote_lead_magnet_hook_v1 | 引流钩子诱饵库 | lead_capture | 引流钩子/诱饵库 |
| rednote_dm_funnel_sop_v1 | 私信获客 SOP 漏斗 | private_domain | 私信 SOP/智能话术库 |
| rednote_pro_account_setup_v1 | 企业号主页与私信菜单 | private_domain | 企业号代运营+私信菜单 |
| rednote_group_chat_ops_v1 | 群聊运营 SOP | private_domain | 群聊运营/私域社群 |
| rednote_viral_rewrite_v1 | 爆文对标改写 | content_production | 爆文改写/一键仿写 |
| rednote_account_matrix_warmup_v1 | 账号矩阵起号养号 | content_production | 矩阵账号（内容计划层）|
| rednote_compliance_check_v1 | 合规违禁词体检改写 | content_production | 违禁词检测/合规改写 |
| rednote_data_topic_mining_v1 | 数据选题库 | search_strategy | 爆文选题库/数据选题 |
| rednote_audience_persona_profile_v1 | 目标人群画像与人设定位 | diagnosis | 灵犀/千瓜人群画像 |
| rednote_selling_point_diagnosis_v1 | 卖点洞察与产品力诊断 | diagnosis | 灵犀 SPU 诊断 |
| rednote_anti_funnel_targeting_v1 | 人群反漏斗投放策略 | paid_amplification | 灵犀人群反漏斗 |

## 钩子框架增强

- `HOOK_FRAMEWORKS` 新增：**诱饵留白钩 / 截流神评钩 / 痛点筛选钩**（`lib/ai/workflow.js`）。
- `renderHookGuidance` 支持 `skill.hookPatterns` 覆盖平台默认（无声明 → 回退 preset，向后兼容）。
- 4 个获客技能（评论截流/引流钩子/私信 SOP/群聊）声明专属获客框架，让获客文案真正有套路。

## 关键约束（源码核验）

- `skillGroups` ids 被测试 deepEqual 焊死 → **不新增 group**，全部归入 `rednote`。
- `rednotePromotionStages` ids deepEqual + 每 stage 必须 ≥1 skill → 加阶段同步改测试且配技能（lead_capture×2、private_domain×3）。
- `recommendRednoteSkills` 4 条焊死路由（搜索排名/KOC/评论私信/投后数据）→ 新 `recommendTags` 逐条核验避让；新增技能放对 stage 避免 +30 抢分（如数据选题放 search_strategy 而非 measurement）。
- 每个 rednote 技能必须 `platform=小红书` + `rednoteStage` + `recommendTags≥4` + `formats≥4` + `agents` 含 `qa`+`export`。

## 测试

- `tests/domain.test.js`：funnel deepEqual（9 阶段）、`rednoteSystemSkillIds` +12、新增 12 条获客路由断言。
- `tests/ai.test.js`：skill 级 `hookPatterns` 覆盖测试（获客框架只进获客技能、不污染种草技能）。
- 结果：`node --test` 174/174 通过；总技能 46、小红书技能 31、9 阶段全覆盖。

## 验证摘要

```
total skills: 46 | rednote skills: 31
stages: diagnosis → search_strategy → content_production → creator_seeding
      → paid_amplification → lead_capture → conversion → private_domain → measurement
uncovered stages: NONE
4 条焊死路由全部保持 + 新路由命中
```
