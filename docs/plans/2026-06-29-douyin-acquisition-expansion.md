---
title: "抖音获客生态扩展（参照巨量引擎/抖音电商产品矩阵）"
type: plan
status: done
created: "2026-06-29"
updated: "2026-06-29"
tags: [plan, douyin, 抖音, 获客, 巨量, skills, funnel]
related: ["2026-06-29-douyin-acquisition-ecosystem-juliang-benchmark", "2026-06-29-rednote-acquisition-expansion"]
---

# 抖音获客生态扩展

> 研究依据见 `docs/research/2026-06-29-douyin-acquisition-ecosystem-juliang-benchmark.md`。
> 镜像小红书 rednote 获客体系，并借此把推荐内核抽象为通用模块（DRY）。

## 目标

为抖音建一套与小红书对等的「获客漏斗 + 技能矩阵」，对标巨量引擎/千川/星图/抖音来客/企业号等官方矩阵中 AICrew 可合规映射的内容/话术/策略产物层。

## 范围

- ✅ 14 个抖音获客技能（group=douyin, platform=抖音, douyinStage）；4 个含 video（视频链路），10 个图文/文本链路
- ✅ 9 阶段全新漏斗 `douyinPromotionStages`
- ✅ 3 个抖音钩子框架（完播钩 / 直播憋单钩 / 直播逼单钩）
- ✅ DRY 重构：抽出通用 `recommendPromotionSkills` 内核，rednote 与 douyin 共用（评分数学单源）
- ❌ 不做：投放出价、账号自动化、平台配置、爬虫采集、CRM/SCRM（越界 + 平台合规红线）

## 漏斗（9 阶段，greenfield）

```
定位诊断 → 搜索卡位 → 内容引流 → 直播获客 → 本地到店 → 投流放大 → 线索留资 → 私域承接 → 数据复盘
```

抖音特有支柱（区别小红书图文种草）：**直播获客 / 本地到店 / 投流放大**。

## 新增技能（14）

| id | 名称 | douyinStage | video |
|----|------|-------------|:---:|
| douyin_account_positioning_v1 | 抖音账号定位诊断 | positioning | — |
| douyin_search_seo_v1 | 抖音搜索SEO卡位 | search_seo | — |
| douyin_lead_gen_shortvideo_v1 | 抖音引流短视频脚本 | content_engine | ✅ |
| douyin_viral_rewrite_v1 | 抖音爆款对标改写 | content_engine | — |
| douyin_matrix_warmup_v1 | 抖音矩阵起号养号计划 | content_engine | — |
| douyin_live_acquisition_script_v1 | 抖音直播获客脚本SOP | live_commerce | ✅ |
| douyin_local_store_acquisition_v1 | 抖音探店到店获客 | local_life | ✅ |
| douyin_local_group_buy_v1 | 抖音团购转化包 | local_life | — |
| douyin_qianchuan_creative_v1 | 千川DOU+投流素材包 | paid_traffic | ✅ |
| douyin_anti_funnel_targeting_v1 | 抖音人群反漏斗策略 | paid_traffic | — |
| douyin_comment_intercept_v1 | 抖音评论区截流话术 | lead_capture | — |
| douyin_lead_capture_funnel_v1 | 抖音线索留资漏斗 | lead_capture | — |
| douyin_private_domain_handoff_v1 | 抖音企业号私域承接 | private_domain | — |
| douyin_campaign_review_v1 | 抖音数据复盘诊断 | review | — |

## 架构（DRY 复用）

- 抽出通用 `recommendPromotionSkills({ skillset, stages, stageKey, input })` + `promotionRecommendationScore(skill, query, stageId, stages, stageKey)` + `resolvePromotionStage(stages, stage)`。
- `recommendRednoteSkills` / `recommendDouyinSkills` 各自委托内核，仅传 skillset/stages/stageKey 差异。
- `douyinPromotionSkills()` = group==="douyin" || id 前缀 "douyin_"；`skillsInGroup("douyin")` 接线。
- 新 `douyin` skillGroup 插在 rednote 之后；现有抖音技能（ecom/shortvideo）group 不变，不折叠（守 realDemand 测试）。

## 关键约束（源码核验）

- `skillGroups` deepEqual 加 "douyin" → 更新测试为 `["featured","rednote","douyin","ecom","beauty","shortvideo"]`。
- 每个 douyinStage 必须 ≥1 skill（coveredStages deepEqual）。
- 视频技能（含 video agent）→ isVideoSkill=true → 导出 video.mp4 + 计 video credits；图文技能反之。
- DRY 重构必须保持 rednote 评分数学逐字等价（已用 rednote 全套路由断言验证）。

## 测试

- `tests/domain.test.js`：skillGroups deepEqual；douyin funnel deepEqual(9)+coverage；production-ready；skillsInGroup(douyin)；14 条 recommendDouyin 路由断言；workflow 契约（video/text 双分支）。
- 结果：`node --test` 179/179 通过；总技能 60、抖音技能 14、9 阶段全覆盖、4 视频技能。

## 验证摘要

```
total skills: 60 | douyin skills: 14
douyin stages: positioning → search_seo → content_engine → live_commerce
            → local_life → paid_traffic → lead_capture → private_domain → review
uncovered: NONE | video skills: 引流短视频/直播脚本/探店/千川素材
跨系统路由隔离 ✓ | DRY 内核 rednote 等价 ✓
```
