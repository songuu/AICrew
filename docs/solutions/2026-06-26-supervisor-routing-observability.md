---
title: "AICrew supervisor routing observability"
date: 2026-06-26
tags: [solution, agent-architecture, supervisor, routing, tests]
related_instincts: []
aliases: ["supervisor routing", "idea agent orchestration", "FlowPlan observability"]
---

# AICrew supervisor routing observability

## Problem

AICrew 的 agent 架构已有 Flow 到 Agent 的执行链路，但 supervisor 语义分散在 router、console 和 domain metadata 中；想法 agent 只是确定性路由，缺少可追溯的选择依据、风险提示和候选项。

## Root Cause

`routeIdeaToFlow` 只返回匹配技能、flow 和线性 rationale，扩展 agent 仍落到通用理由；director 命令 alias 也只覆盖旧 agent，导致 `trend`、`hook`、`persona`、`seo` 这类新增 agent 可编排但不易解释、不易手动调整。

## Solution

- 在 `lib/flow/router.js` 中把 idea 路由升级为可观测 FlowPlan：返回 `selectedSkill`、`confidence`、`assumptions`、`missingInputs`、`alternatives`、`riskFlags` 和 `rationaleByAgent`。
- 为 `trend`、`hook`、`persona`、`seo` 增加具体 rationale，避免审计时只能看到“执行该编排步骤”。
- 在 `lib/flow/director.js` 中补齐扩展 agent 的中文和英文 alias，让手动 director 命令可以追加趋势、钩子、人设和 SEO。
- 用 `tests/flow.test.js` 和 `tests/director-intent.test.js` 覆盖模糊输入兜底、扩展 agent rationale、FlowPlan 字段和 alias fallback。

## Prevention

- 新增 agent 时同步补三件事：domain 定义、router rationale、director alias。
- supervisor/idea-agent 输出不要只给结论；至少保留置信度、假设、缺失输入、备选候选和风险标记。
- 架构审计型修补要同时更新设计记录和回归测试，避免只靠文档描述“中枢存在”。

## Related

- [[2026-06-26-agent-architecture-supervisor-idea-agent-audit]] — architecture audit and patch record
