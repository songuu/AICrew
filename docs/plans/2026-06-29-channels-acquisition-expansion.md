---
title: "微信视频号获客生态扩展（参照视频号商业化矩阵与公私域闭环）"
type: plan
status: done
created: "2026-06-29"
updated: "2026-06-29"
tags: [plan, channels, 视频号, 微信, 获客, 公私域, skills, funnel, platform]
related: ["2026-06-29-channels-acquisition-ecosystem-wechat-benchmark", "2026-06-29-douyin-acquisition-expansion"]
---

# 微信视频号获客生态扩展

> 研究依据见 `docs/research/2026-06-29-channels-acquisition-ecosystem-wechat-benchmark.md`。
> 第 3 个平台获客体系（rednote→douyin→channels），第 3 次复用通用推荐内核。

## 目标

为微信视频号建一套与小红书/抖音对等的「获客漏斗 + 技能矩阵」，并把视频号升级为一等平台（platformPreset + detectPlatform），对标视频号商业化矩阵中 AICrew 可合规映射的内容/话术/策略产物层。

## 范围

- ✅ **新平台**：`视频号` platformPreset（完整 DNA：ratio 9:16 / hookSeconds 3 / lang zh / hookPatterns / copyRules / creditMultiplier / platformFit）+ detectPlatform 识别（视频号 / shipinhao / wechat·weixin·wx channels）
- ✅ 12 个视频号获客技能（group=channels, platform=视频号, channelsStage）；3 个含 video，9 个图文/文本
- ✅ 9 阶段全新漏斗 `channelsPromotionStages`
- ✅ 2 个视频号钩子框架（社交转发钩 / 直播预约钩）
- ✅ 第 3 次复用通用 `recommendPromotionSkills` 内核（零新增评分代码）
- ❌ 不做：账号自动化 / 自动私信 / SCRM / 爬虫 / 投放实操（越界 + 微信诱导分享/硬导流红线）

## 漏斗（9 阶段，greenfield）

```
定位诊断 → 搜一搜卡位 → 内容引流 → 社交裂变 → 直播获客 → 小店带货 → 生态联动 → 线索留资 → 私域承接
```

视频号特有支柱（区别小红书/抖音）：**社交裂变 / 小店带货 / 生态联动（公众号×视频号×小程序×企微闭环）**。

## 新增技能（12）

| id | 名称 | channelsStage | video |
|----|------|---------------|:---:|
| channels_account_positioning_v1 | 视频号账号定位诊断 | positioning | — |
| channels_search_seo_v1 | 视频号搜一搜SEO卡位 | search_seo | — |
| channels_lead_gen_shortvideo_v1 | 视频号引流短视频脚本 | content_engine | ✅ |
| channels_viral_rewrite_v1 | 视频号爆款对标改写 | content_engine | — |
| channels_matrix_warmup_v1 | 视频号矩阵起号养号计划 | content_engine | — |
| channels_social_fission_pack_v1 | 视频号社交裂变玩法包 | social_fission | — |
| channels_live_acquisition_script_v1 | 视频号直播获客脚本SOP | live_acquisition | ✅ |
| channels_shop_product_material_v1 | 视频号小店带货素材包 | wechat_commerce | ✅ |
| channels_official_account_linkage_v1 | 公众号×视频号联动涨粉 | ecosystem_linkage | — |
| channels_lead_magnet_funnel_v1 | 视频号引流诱饵留资漏斗 | lead_capture | — |
| channels_compliance_guard_v1 | 视频号导流合规红线校验改写 | social_fission | — |
| channels_private_domain_handoff_v1 | 企微社群私域承接SOP | private_domain | — |

## 架构（DRY 复用第 3 次）

- 复用通用 `recommendPromotionSkills({ skillset, stages, stageKey, input })`，新增仅：`channelsPromotionStages` 常量 + `channelsPromotionSkills()`(group/id 前缀过滤) + `recommendChannelsSkills` 委托(stageKey="channelsStage") + `skillsInGroup("channels")` 接线 + `channels` skillGroup。
- 新平台需额外：`platformPresets` += 视频号 preset；`detectPlatform` += 视频号 token。
- 社交转发钩 / 直播预约钩 加入 `HOOK_FRAMEWORKS`，挂在 social_fission / live 技能的 skill.hookPatterns（renderHookGuidance skill 级覆盖）。

## 关键约束（源码核验）

- `skillGroups` deepEqual 加 "channels" → `["featured","rednote","douyin","channels","ecom","beauty","shortvideo"]`。
- test「active platform presets carry structured copy DNA」遍历**所有** presets → 视频号 preset 须 hookPatterns≥2 + copyRules{hookMaxChars/captionRange/ctaExamples} + creditMultiplier/platformFit。
- 每个 channelsStage 必须 ≥1 skill（coveredStages deepEqual）。
- 视频技能 → isVideoSkill=true → 导出 video.mp4 + 计 video credits。

## 测试

- `tests/domain.test.js`：skillGroups deepEqual；channels funnel(9)+coverage/production-ready/skillsInGroup；12 条 recommendChannels 路由断言；视频/图文 workflow 契约；detectPlatform 视频号；视频号 preset 驱动 ratio+qa。
- 结果：`node --test` 185/185 通过；总技能 72、视频号技能 12、平台 6、9 阶段全覆盖、3 视频技能。

## 验证摘要

```
total skills: 72 | channels skills: 12 | platforms: 6
channels stages: positioning → search_seo → content_engine → social_fission
            → live_acquisition → wechat_commerce → ecosystem_linkage → lead_capture → private_domain
uncovered: NONE | video skills: 引流短视频/直播脚本/小店带货
detect 视频号 ✓ + WeChat Channels ✓ | 通用内核第 3 次复用 ✓
```
