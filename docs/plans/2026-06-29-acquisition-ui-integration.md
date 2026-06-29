---
title: "三平台获客体系横向打磨：接入技能选择器（漏斗分组 + 意图推荐）"
type: plan
status: done
created: "2026-06-29"
updated: "2026-06-29"
tags: [plan, ui, 获客, 选择器, 漏斗, recommend, rednote, douyin, channels]
related: ["2026-06-29-channels-acquisition-expansion"]
---

# 三平台获客体系横向打磨

> 小红书/抖音/视频号三套获客体系已建（domain 层），但 `recommend*` 与 `*PromotionStages` 在 UI 中未用、漏斗未可视化、平台 tab 是扁平长列表（小红书 31 个）。本次把能力接入技能选择器，让它们真正可用。

## 目标

把三套获客漏斗 + 推荐路由接入 RoboNeo 式技能选择器：平台 tab 内按获客阶段分组，并按用户创意文本推荐技能。

## 范围

- ✅ domain：平台获客**注册表** `PROMOTION_REGISTRY`（group → {stages, skills, stageKey, recommend} 单点）+ 3 个访问器：`isPromotionGroup` / `promotionFunnelForGroup` / `recommendForGroup`；`skillsInGroup` 改为派生（消除 rednote/douyin/channels 三处重复判断）
- ✅ UI（OrchestratorConsole）：`SkillPickerPanel` 平台 tab → 「✨ 为你的创意推荐」行（idea→recommendForGroup）+ 按漏斗阶段分段（stage 标题/计数/desc + 卡片）；非平台 tab 保持扁平。抽出 `SkillCard` 三处复用
- ✅ CSS：阶段分段 / 推荐行样式（globals.css）
- ❌ 不改：domain 既有 recommend*/funnel 数据与契约（纯增访问器 + 派生 skillsInGroup）

## 架构

- 注册表是「加平台获客漏斗」的唯一登记点：新增平台在此加一行即同时获得 skillsInGroup / 漏斗分组 / 意图推荐。
- UI 零硬编码平台判断：`isPromotionGroup(tab)` 决定走漏斗视图还是扁平视图；分段与推荐数据来自 domain。

## 测试

- `tests/domain.test.js`：
  - 注册表统一性（isPromotionGroup 只认三获客 group；promotionFunnelForGroup 阶段顺序=漏斗序、技能桶分无遗漏无重复、每段≥1、非获客 group 返回 null）
  - recommendForGroup 委托路由（rednote/douyin/channels 各命中代表技能，非获客 group 返回 []）
- `node --test` 187/187 通过；`npm run build` 编译通过。

## 验证摘要

```
node --test: 187/187
next build: 编译通过（无错误）
平台 tab：小红书/抖音/视频号 → 漏斗阶段分段 + 推荐行
其余 tab：推荐/电商/美妆/短视频 → 扁平列表（行为不变）
```
