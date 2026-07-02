---
title: "AICrew credit wallet full integration"
date: 2026-07-02
tags: [solution, credits, billing, wallet, catalog]
related_instincts: []
aliases: ["AICrew full credit system", "积分系统全量接入"]
---

# AICrew credit wallet full integration

## Problem

AICrew 之前已经有 generation/retry 的本地 reserve-settle 和一个服务端 consume endpoint，但 Billing 仍是静态套餐卡，服务端也只有单余额标量，无法表达积分桶、每日权益、会员/充值目录、过期、部分结算和可对账账本。

## Root Cause

旧实现把 `aicrew_workspaces.credits` 当作服务端标量镜像，`creditLedger` 主要服务展示；它能阻止客户端 snapshot 直接覆盖余额，但不能支撑完整钱包模型。若继续在 UI 硬编码套餐和价格，也会让 RoboNeo 对标规则、真实扣费规则和用户看到的 Billing 页面漂移。

## Solution

- 新增 `lib/credit-system.js`：会员计划、单购包、价格目录全部数据化；钱包支持 bucket grant、signup/daily refresh、reserve、partial settle、release、expire、admin adjustment 和 reconcile。
- 服务端 credits repository 改为 row lock + `workspace.payload.creditSystemWallet` 的 server-owned wallet snapshot，并继续镜像 `aicrew_workspaces.credits` 和 `aicrew_credit_ledger` 给旧读取路径。
- 新增 `/api/credits/wallet|quote|grant|reserve|settle|release`，并硬化公共写入口：`/transaction` 只接受负向 consume，`/grant` 只允许 daily/signup 免费权益，充值/调账等真钱路径等真实 auth/payment 后再打开。
- State GET 合并 server wallet 为 `creditWallet`/`creditCatalog` 展示缓存；State PUT 继续丢弃客户端余额、账本和 wallet 字段。
- Billing UI 展示可用/冻结/今日到期/永久积分、bucket 明细、会员计划、单购包、功能价格目录、Received/Used 流水。
- 新增幂等 migration 表结构，为后续把 payload wallet 下沉到关系表提供 `aicrew_wallets`、buckets、reservations、allocations、transactions、orders、subscriptions、redeem、audit 表。

## Prevention

- 公共 credit API 默认不能 mint：任何正向发放、充值、调账都必须走受信服务端路径或真实支付/auth 后启用。
- Billing UI 不再维护价格数字；只渲染 catalog，避免产品目录和展示漂移。
- 高风险 credit work 至少跑 `tests/credits.test.js`、`tests/state-repository.test.js`、`npm test` 和 `npm run build`。

## Related

- [[2026-07-02-credit-system-full-integration]] — sprint implementation plan
- [[2026-06-25-agent-credit-reserve-settle-hardening]] — previous reserve-settle hardening
