---
title: "AICrew Agent PRD Compliance Audit"
type: sprint
status: completed
created: "2026-06-22"
updated: "2026-06-22"
tags: [sprint, audit, agent, prd]
goal: "检测是否按照 docs/AICrew_Studio_RoboNeo_Product_PRD.md 实现，特别是 agent 相关设置和操作"
tasks_total: 4
tasks_completed: 4
invariant_tests:
  - npm test
  - npm run build
---

# AICrew Agent PRD Compliance Audit

## Phase 1: 需求分析

目标：对照 docs/AICrew_Studio_RoboNeo_Product_PRD.md 核查当前实现是否满足 agent 相关要求，特别是设置与操作。

范围：
- Agent Team 核心原则：任务单元、输入、输出、工具、评价标准、结构化交接、Orchestrator、可回溯、可重试、可计费。
- AI 创作工作台：Agent 状态展示、结果展开、局部修改、多版本、导出、素材引用。
- Agent 设置：运行时/模型配置、agent 执行契约可见。

非范围：
- 真实后端队列、真实 SSE、真实视频模型接入。
- 完整移动端原生实现。
- 企业权限/SSO/投放平台集成。

## Phase 2: 对照结论

| PRD 要求 | 当前证据 | 结论 |
|---|---|---|
| 每个 Agent 必须有输入、输出、工具、评价标准 | src/domain.js 的 agents 已含 input/output/tools/evaluation/cost/responsibility | 已补齐 |
| Orchestrator 统一调度 | runCreativeWorkflow 生成 orchestrator，记录 plan 与 summary | 已补齐 |
| Agent 间结构化交接、可回溯 | task 生成 events，每步有 artifact、事件、progress、credits | 已补齐 |
| 每一步可重试、可计费 | retryAgentStep(task, agentId) + UI Retry 按 agent cost 追加事件与积分流水 | 已补齐 |
| 工作台展示 Agent 状态 | AgentTimeline 展示 Orchestrator、步骤、时长、状态、最近事件 | 已实现 |
| Agent 结果展开 | details.agent-details 展开 Input/Tools/Output/Eval | 已补齐 |
| Agent 设置 | Settings -> Agent Runtime 展示每个 agent 的职责、输入、工具、评价、重试成本 | 已补齐 |
| 局部修改 | reviseVariantHook 与 Workbench Hook 修改表单 | 已实现 |
| 多版本/导出/保存 Skill | 变体 tabs、Export、Save Skill 已存在 | 已实现 |
| 真实后端 SSE/API | 当前仍为前端模拟 + 本地事件，不是服务端 SSE | MVP 模拟，未做后端 |

## Phase 3: 变更记录

- src/domain.js
  - 扩展 agent catalog：职责、输入、输出、工具、评价标准、成本。
  - 新增 orchestratorAgent 与 task-level orchestrator。
  - 新增 task events，记录 agent_completed。
  - 新增 retryAgentStep，单 Agent 重试、追加事件、增加实际积分。
- src/AICrewStudio.jsx
  - Dashboard / Workbench 的 Agent Timeline 支持 Retry。
  - Timeline 支持展开 Input / Tools / Output / Eval。
  - Settings 增加 Agent Runtime 设置与执行契约区。
- src/styles.css
  - 增加 Orchestrator、Agent details、Agent events、Agent settings 样式。
- src/ai/config.js、src/ai/providers.js
  - 保留系统模型选择接口，同时恢复旧 Claude/OpenAI token 兼容导出与官方 host 校验，修复 build 导入契约。
- tests/domain.test.js
  - 增加 agent contract、orchestrator/events、single-agent retry billing 回归测试。

## Phase 4: Review

风险等级：L2。触及领域模型、UI 状态更新、AI 配置兼容层；无后端数据迁移，无真实扣费。

审查结果：
- P0：无。
- P1：构建初次发现 AI config 导出契约漂移，已通过兼容层修复。
- 剩余风险：真实服务端 Agent 队列 / SSE / 后端重试 API 未实现，目前为 MVP 前端模拟。

## Phase 5: 验证

- npm test：61/61 pass。
- npm run build：pass，17 static pages + 2 dynamic API routes。

## Completion Audit

结论：agent 相关 MVP 实现已从“展示型时间线”提升到“具备结构化执行契约 + 展开 + 单步重试 + 计费记录”的 PRD 对齐状态。完整生产级后端 Agent Runtime 仍是后续范围，不属于当前静态 MVP 的完成声明。
