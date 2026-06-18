---
title: "AICrew Studio Next.js rebuild and /aicrew deployment"
type: sprint
status: completed
created: "2026-06-18"
updated: "2026-06-18"
checkpoints: 0
tasks_total: 7
tasks_completed: 7
tags: [sprint, nextjs, deploy, aicrew]
aliases: ["AICrew Next deploy"]
goal: "按 PRD 以 Next.js 形式重构完整产品，打包并按 agent-build 方式部署到 root@47.253.230.197，使 https://songuu.top/aicrew 可访问。"
goal_max_iter: 3
goal_until: ""
goal_iteration: 1
goal_status: met
invariants:
  - "Next 静态导出必须使用 /aicrew basePath，线上资源路径必须是 /aicrew/_next。"
  - "PRD Demo 闭环必须可跑通：Brief -> Agent 工作流 -> 3 个内容变体 -> 导出包 -> 积分扣减。"
  - "部署必须包含本地 build、自检、远端上传、原子换入、公网验证。"
invariant_tests:
  - "npm test"
  - "npm run build"
deferred: []
---

# Phase 1: Think

## Scope

- 将上一轮零依赖静态 SPA 改为 Next.js App Router 项目。
- 保留完整 PRD 产品面：Dashboard、Workbench、Projects、Assets、Skills、Brand Kit、Exports、Billing、Admin、Login、Signup、Onboarding。
- 使用 `basePath=/aicrew` 静态导出，产物可部署到 nginx `location /aicrew/`。
- 参考 `agent-build` 的 deploy contract：本地门禁 -> build -> base 自检 -> tar/scp -> remote backup + atomic swap -> verification。
- 远端入口需支持 `https://songuu.top/aicrew/`。

## Non-Scope

- 真实模型、真实支付、真实登录、数据库和对象存储。
- 未获用户明确批准前，不直接修改生产服务器 nginx/root 入口。

## Success Criteria

- `npm test` pass。
- `npm run build` pass，`out/index.html` 包含 `/aicrew/_next`。
- 本地静态预览 `/aicrew/` 和 `_next` asset 200。
- 部署脚本完成，并在获准后执行远端部署。
- 公网 `https://songuu.top/aicrew/` 200 且内容可访问。

# Phase 2: 技术方案

## 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|---|---|---|
| PRD Demo | Brief -> Agent -> 变体 -> 导出 -> 积分 | 保留 `src/domain.js`，React 页面调用同一纯业务核心 |
| 部署 | agent-build 使用 tar/scp/ssh、远端备份、原子换入、HTTPS 验证 | 新增 `scripts/deploy.ps1` 复用同样形状 |

## 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|---|---|---|---|---|
| Next 页面 | 访问 `/aicrew/*` | App Router -> Client Component | static out + localStorage | 是 |
| 创作任务 | Workbench submit | `AICrewStudio` -> `runCreativeWorkflow` | localStorage | 是 |
| 导出 | Export button | `buildExportRecord` | localStorage | 是 |
| 生产部署 | `scripts/deploy.ps1` | npm build -> tar/scp/ssh | `/opt/aicrew/current/out` | 是 |

## 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|---|---|---|---|
| 本 sprint | 生产 nginx/root 入口改动需 SSH | 等用户明确批准后执行 | 2026-06-18 |

# Phase 3: Work Log

- [x] Task 1: 新增 Next 配置、App Router 多路由页面。
- [x] Task 2: 迁移产品 UI 到 `src/AICrewStudio.jsx`，保留 PRD 功能面。
- [x] Task 3: 安装 Next/React 依赖并生成 `package-lock.json`。
- [x] Task 4: 本地测试/build/audit/static preview 全量验证。
  - `npm test` 8/8 pass。
  - `npm run build` pass，Next.js `16.2.9` 静态导出成功。
  - `npm audit --omit=dev` 0 vulnerabilities。
  - 本地 `http://127.0.0.1:5173/aicrew/` 200，`/aicrew/_next/...js` 200。
- [x] Task 5: 打包并上传部署到 `root@47.253.230.197`。
  - `pwsh scripts/deploy.ps1` 完成 test/build/base check/tar/scp/remote swap。
  - 远端文件数：124。
  - 回滚备份：`/opt/aicrew/current/out.bak.20260618171904`。
- [x] Task 6: 配置/确认 nginx 与入口访问路径 `/aicrew`。
  - 入口文件：`/etc/nginx/conf.d/default.conf`。
  - 已新增 `location = /aicrew` 与 `location /aicrew/`。
  - `nginx -t` pass，`systemctl reload nginx` 已执行。
- [x] Task 7: 公网验证并完成 review/compound。
  - `https://songuu.top/aicrew` -> 200，最终 URL `https://songuu.top/aicrew/`。
  - `https://songuu.top/aicrew/` 页面包含 `AICrew Studio` 与 `/aicrew/_next`。
  - live JS asset 200。
  - `https://songuu.top/aicrew/workbench/` 200。
  - `https://songuu.top/aicrew/skills/` 200。
  - `https://songuu.top/aicrew/admin/` 200。

# Phase 4: Review

## Findings

- P0: 无。
- P1: 无。

## Review Views

| 视角 | 结论 |
|---|---|
| 架构 | 已从静态 SPA 改为 Next App Router；`src/domain.js` 保持纯业务核心，`src/AICrewStudio.jsx` 负责客户端交互。 |
| 安全 | `npm audit --omit=dev` 0 vulnerabilities；生产 nginx 改动前已备份并 `nginx -t`。 |
| 性能 | 静态导出，首屏 JS 约 114kB；部署为 nginx 静态资源。 |
| 代码质量 | 旧 `index.html` / `src/app.js` 已删除，避免双入口漂移；部署脚本与 runbook 与 agent-build 形状一致。 |
| 测试覆盖 | 领域逻辑 8 个 Node 测试通过；build 覆盖 Next 路由静态生成。 |
| 集成连续性 | `/aicrew` basePath、本地 out、自检、远端 nginx、远端 out、公网 URL 全链路贯通。 |

# Phase 5: Compound

## 复利记录

- 经验：Next 静态子路径部署必须同时设置 `basePath`、`assetPrefix`，并在部署脚本自检 `out/index.html` 的 `/<base>/_next`。
- 经验：生产服务器改 nginx 前必须备份入口配置，`nginx -t` 后再 reload。
- 经验：并行 build/test 容易残留 `next build` 进程；架构迁移后门禁应串行执行。

Goal loop: iter 1/3, until=n/a, goal-met=yes, decision=stop:met
