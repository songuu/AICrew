---
title: "AICrew agent credit reserve-settle hardening"
date: 2026-06-25
tags: [solution, credits, billing, ai, audit]
related_instincts: []
aliases: ["agent credit reserve settle", "AICrew credit ledger audit"]
---

# AICrew agent credit reserve-settle hardening

## Problem

Agent executor 路由和 credit reserve/settle 接入后，多 agent 审计发现本地 UI 结算、远端状态持久化、AI 路由防护之间存在权威边界不清的问题。

## Root Cause

旧流程允许缺失 reservation 时隐式 settle，且 snapshot PUT 会信任客户端 credit 字段。这样会让 UI 看起来扣费成功，但服务端 ledger、刷新后状态和并发写入结果不一定一致。

## Solution

- 将 credit reserve/settle 变成显式状态机：settle/release 必须引用已存在 reservation，actual 超过 reserved 直接报错。
- 新增服务端 /api/credits/transaction：使用 workspace row lock + ledger transaction id 做幂等扣费，客户端只提交结算意图。
- 将 snapshot 持久化里的 credits、reservedCredits、creditLedger、creditReservations 标记为 server-owned，避免客户端覆盖服务端账本。
- 给 /api/ai/generate 增加 route guard：限制 body/prompt/model/image size、统一全局限流 key、隐藏 provider 原始错误。
- 在 Flow/Studio 中统一使用 domain credit quote，并在 AI variants 更新后重建 exports，避免展示价、实际扣费和导出内容漂移。

## Prevention

- 对余额、ledger、reservation 这类资金语义状态，测试必须覆盖 idempotency、missing reservation、overage 和 snapshot overwrite。
- UI 乐观更新只能是交互反馈，不能作为结算权威；远端同步失败必须在 billing 层显式暴露。
- 多 agent audit 要同时看 domain、server repository、UI workflow 三层，否则容易只证明单层测试通过。

## Related

- [[2026-06-25-agent-executor-credit-reserve-settle]] — sprint implementation plan
