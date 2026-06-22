---
title: "正式接入 AI 平台（Claude + OpenAI，可配置 token）"
type: sprint
status: completed
created: "2026-06-22"
updated: "2026-06-22"
checkpoints: 0
tasks_total: 6
tasks_completed: 0
tags: [sprint, feature, ai-integration]
aliases: ["AI 接入", "token 配置"]

invariants:
  - "next.config.mjs 静态导出契约不变：output:export / basePath:/aicrew / trailingSlash"
  - "app/layout.jsx metadata.title 必须保持 'AICrew Studio'"
  - "domain.js 现有纯函数签名不变；13 个 domain.test.js 断言全绿"
  - "平台=元数据 / 交付物=skill 契约不破（findPlatformPreset / isVideoSkill）"
  - "AI token 仅存浏览器本地，永不进 git、永不写日志、永不硬编码"

invariant_tests:
  - tests/domain.test.js
  - tests/ai.test.js

deferred:
  - sprint: 后续
    item: "phone-preview 图文内容隐藏 .motion-bars 装饰（纯装饰 P2）"
    deadline: "2026-09-01"
    reason: "平台无关纯装饰，改动侵入性 > 价值；继续推迟"
---

# 正式接入 AI 平台（Claude + OpenAI）

## 需求分析（Phase 1 Think）

用户诉求：平台需正式接入 AI，**可直接配置 token**，**同时支持 Claude 和 OpenAI**。
决策（AskUserQuestion）：① 接入深度 = 配置层 + 接入真实生成；② 能力范围 = 文本(LLM) + OpenAI 图像。

硬约束：本项目是 **Next.js 静态导出站（无后端）** → token 只能存浏览器本地，浏览器直连厂商 API。
这与「直接配置 token」一致，但带来安全权衡（见风险）。

### Scope
- Settings「AI 接入」面板：provider(Claude/OpenAI) + token(掩码) + model + 可选 baseURL + OpenAI 图像开关 + 「测试连接」。
- Provider 适配层 `src/ai/`：统一 `generateText()` / `generateImage()`（OpenAI 限定），可注入 fetch（可测）。
- 把真实 LLM 接进文案/脚本生成；OpenAI 配置时生成封面图。**无 token → 回退现有确定性模拟。**

### Non-scope
- 后端代理 / serverless（违反静态导出契约）。
- Claude 图像（厂商无此能力）。
- 多用户密钥托管、真实计费用量对接。

### Success
- 配 token → 测试连接通过 → 生成走真实 LLM（+OpenAI 封面图）；无 token 照常跑模拟。
- 现有 13 测试不破 + 新增 ai.test.js 全绿；`npm run build` 静态导出通过（路由 +1）。

## 技术方案（Phase 2 Plan）

### 入场扫描 - Invariants 继承

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| 构建 | 静态导出 output:export / basePath /aicrew | 仅新增 client 模块与 1 个 page.jsx，不改 next.config |
| 文档元信息 | layout.jsx title "AICrew Studio" | 不触碰 layout.jsx |
| 领域层 | domain.js 纯函数 + 13 断言 | AI 层 import 并包装 runCreativeWorkflow，不改其签名 |
| 平台/交付物 | findPlatformPreset / isVideoSkill | AI 层只读这些，不旁路 |
| 安全 | 无硬编码 secret | token 走 localStorage 独立 key，不入主 state blob、不入 git |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| AI 配置保存 | Settings 表单 submit | saveAiConfig() | ✅ localStorage(aicrew-ai-config-v1) | ✅ 读回填表单 |
| 测试连接 | 「测试连接」按钮 | testConnection()→fetch 厂商 | ❌ 不持久化（即时反馈） | n/a |
| 真实生成 | Workbench 生成(async) | runCreativeWorkflowWithAI | ✅ 结果入主 state(不含 token) | ✅ 与现有 task 一致 |

token **独立 key 存储**，不混入 `aicrew-studio-next-state-v1`（避免被 reset/导出/序列化泄漏）。

### 入场扫描 - 债务清单

| 来源 | 议题 | 本 sprint 决策 | deadline |
|------|------|----------------|----------|
| sci-fi UI sprint | motion-bars 图文场景装饰 | ⏭ 继续推迟（纯装饰） | 2026-09-01 |

### 任务拆解

| # | 任务 | 风险 | 测试 |
|---|------|------|------|
| 1 | `src/ai/config.js`：配置 shape + 默认值 + 校验 + localStorage 读写（独立 key） | L3(凭据) | 校验/默认/读写单测(RED 先行) |
| 2 | `src/ai/providers.js`：generateText(Claude+OpenAI)/generateImage(OpenAI)/testConnection，注入 fetch，显式错误 | L3(凭据+边界) | 端点/header/body/解析/错误单测 |
| 3 | `src/ai/workflow.js`：runCreativeWorkflowWithAI(async)，合并 AI 文案/封面到 variant(不可变)，错误回退 + aiMeta | L3 | 注入 fetch：AI 合并/无配置回退/错误回退 |
| 4 | UI：新增 settings 视图 + nav 项 + `app/settings/page.jsx` + 面板(掩码 token/provider/model/baseURL/图像开关/测试/安全提示) | L2 | 冒烟 + build 路由 |
| 5 | UI：生成 handler 改 async，按配置走 AI/模拟，loading+error 态，渲染 imageUrl | L2 | 冒烟回退路径 |
| 6 | 验证：`npm test`(13+新) + `npm run build`(路由+1) + 回退路径手测 | — | 全量 |

### 验证策略
- L3 任务全部 TDD（注入假 fetch，不打真实网络、不用真实 key）。
- 每 task 完成跑不变量回归：`tests/domain.test.js` + `tests/ai.test.js`。
- 安全 review（Phase 4）重点：token 存储隔离、掩码、无日志、无硬编码、浏览器直连风险告知。

## 变更日志（Phase 3）

## 审查结果（Phase 4）

对抗式多视角 Workflow（4 视角 finder → 逐条对抗验证，17 agents）：提出 13，确认 6。
**0 P0 · 0 P1 · 3 P2（全修）· 3 P3。** ux_i18n 视角因连接中断未完成 → UX/i18n 改 inline 自审通过。

| 严重度 | 视角 | 问题 | 处理 |
|--------|------|------|------|
| P2 | 安全 | baseURL 未限定厂商域名 → key 可被发往任意 https 主机 | ✅ AI_PROVIDERS 加 `hosts` 白名单；`validateAiConfig` 校验 host；`providers.normalizeBase` 发送前再校验（防御纵深，拒发即不发请求） |
| P2 | 正确性 | AI 文案全回退时仍置 `aiGenerated:true`（误显 AI 徽标，copyApplied 虚高） | ✅ `applyAiCopy`→`mergeAiCopy` 返回 `{variant, applied}`；空壳 JSON 不计入、不打标 |
| P2 | 正确性 | OpenAI 封面 base64 写入主 blob + `setItem` 无 try/catch（配额溢出抛错） | ✅ 持久化前 `sanitizeStateForStorage` 剥离 `imageUrl`；`setItem` 包 try/catch 静默降级 |
| P3 | 安全 | 远程图 URL 留存主 blob | ✅ 同被 imageUrl 剥离覆盖 |
| P3 | 安全 | resetDemo 不清 token | 决策保留：token 生命周期由「AI 接入」面板「清除」显式掌管，demo reset 不应抹凭据 |
| P3 | 集成 | workflow.js dead `findSkill` | ✅ 删除导入与调用 |

回归测试 +3：baseURL 异域名拒绝、发送路径拒发、空壳 JSON 不打 AI 标。

## 复利记录（Phase 5）

- **核心架构契约**：静态导出站（无后端）下「正式接入 AI」= 客户端存 token + 浏览器直连厂商，必须配 host 白名单。沉淀为记忆 [[aicrew-ai-integration]]。
- **包装而非修改**：AI 层 import 并包装 `runCreativeWorkflow`，13 个 domain 测试零改动即保持绿 → 风险大的接入不污染既有纯函数契约。
- **对抗式审查再次拦截真实缺陷**：纯靠测试绿不够，多视角对抗审查在 0 P0/P1 的「看似干净」改动里仍挖出 3 个真实 P2（含 1 个 key 外发 footgun）。

状态：测试 32/32 · build 16 路由静态导出 · status → completed。
