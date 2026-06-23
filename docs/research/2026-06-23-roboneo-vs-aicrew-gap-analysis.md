---
title: "RoboNeo vs AICrew Studio 差距分析"
type: research
status: baseline
created: "2026-06-23"
updated: "2026-06-23"
tags: [research, competitive-analysis, roboneo, gap]
aliases: ["RoboNeo 对标", "差距分析"]
---

# RoboNeo vs AICrew Studio — 全面差距分析

> 基线说明：本文基于对 roboneo.com 公开信息的核验，以及对当前仓库**源码的逐文件核验**（非 PRD 愿景）。
> 结论代表 2026-06-23 仓库状态。

## 一句话结论

**RoboNeo 是「真生产」，AICrew 当前是「高保真编排外壳 + 局部真生成」。**
架构思想（一图三模式、Agent 协作、Skill、Brand Memory）AICrew 已对齐甚至更干净；
真正的鸿沟是**真实媒体产出能力**——尤其视频——基本为零。差距的本质不在「想法/结构」，在「引擎/交付」。

---

## 一、RoboNeo 真实画像（公开信息核验）

| 维度 | RoboNeo（Meitu 出品） |
|------|----------------------|
| 定位 | Chat 驱动的 AI 创意 Agent，捆绑多个一线引擎（Kling / Sora + 美图自研） |
| 真实产出 | 可播放视频、图像编辑（换装/换发/改姿势/换背景/去水印/重打光）、设计（海报/商品图/Logo/meme/品牌物料） |
| Motion Control | 虚拟摄像机：对任意起始图加 pan/tilt/zoom 运镜 |
| Agent Teams（2026 Q1）| 多 Agent 并行协作、各司其职、交接真产物：编剧 / 分镜导演 / 美术总监 / 后期合成。端到端短剧、社媒、电商视频（<5min）|
| Agent Skills | 可复用领域包：电商 / 短剧 / 广告 / 动画 |
| Memory | 跨会话记住品牌规范 + 审美偏好 |
| 三种创作路径 | 模板即开即用 / 对话式多步 / 拖拽节点画布（可复用流水线）|
| 触点 | Web + iOS + Android + 创作社区（roboneoai.art）|

## 二、AICrew 当前真实能力（源码核验）

| 维度 | AICrew 现状 | 真实度 |
|------|------------|--------|
| 三模式 | 自动 / 半自动 / 手动，统一为一个 Flow 编排图（lib/flow/*）| ✅ 架构真实且优雅 |
| 域内 Agent | 10 个（Brief/Strategy/Script/Storyboard/Visual/Video/Copy/QA/Export/Orchestrator）| ⚠️ 确定性模拟，产出元数据非媒体 |
| 文案生成 | Claude/OpenAI/硅基流动真接入，多 variant 文案 | ✅ 真（需配置）|
| 图像生成 | 真接入，但仅 variant[0] 生成 1 张封面 | 🟡 真但单张 |
| 视频生成 | `generateVideo()` 存在于 providers.js，但 workflow 未调用 → `video.mp4` 为占位字符串 | ❌ 模拟 |
| 画布 | 矢量白板（矩形/圆/文字/箭头/导入图视频）+ 缩放/平移/撤销 | 🟡 纯编辑，无 AI 生成 |
| Skill | 5 个预设（现仅抖音+小红书启用，其余注释）| 🟡 模板套在模拟上 |
| Brand Memory | `defaultBrandKit`（name/voice/禁用词），随状态走、不跨会话 | 🟡 浅 + 不持久 |
| 计费 | estimated/actual 积分，纯模拟 | ❌ 非真实 |
| 触点 | 单 Web 部署，无移动端 | ❌ |
| 工程质量 | 纯函数/不可变/node:test 106+ 全绿/离线可测 | ✅ 强 |

---

## 三、功能差距矩阵

| 能力 | RoboNeo | AICrew | 差距等级 |
|------|:---:|:---:|:---:|
| 文生文（文案/脚本）| ✅ | ✅ | 持平 |
| 文生图（封面/场景）| ✅ | 🟡 单张 | 小 |
| 图像编辑（去背/换装/改姿势/去水印/重打光）| ✅ | ❌ | 大 |
| 文/图生视频（Kling/Sora 级）| ✅ | ❌ 占位 | 致命 |
| Motion Control 运镜 | ✅ | ❌ | 大 |
| AI 音频（配乐/配音 TTS）| ✅ | ❌（有 voiceover agent，无真引擎）| 大 |
| Agent 真协作（调引擎+交接真产物）| ✅ | ❌ 模拟管线 | 致命 |
| 节点画布构建可复用流水线 | ✅ | 🟡 Flow 图有，执行模拟 | 中 |
| 生成式画布（画布内生成/再编辑）| ✅ | ❌ 仅白板 | 大 |
| 模板库 / 即开即用 | ✅ 丰富 | 🟡 5 预设 | 中 |
| 真实导出可下载媒体 | ✅ | ❌ 文件名清单 | 致命 |
| 真实计费/积分 | ✅ | ❌ 模拟 | 中 |
| 任务态/渲染进度轮询 | ✅ | 🟡 有 jobId 字段，UI 未建 | 中 |

## 四、体验差距矩阵

| 体验维度 | RoboNeo | AICrew | 差距 |
|------|---|---|---|
| 产出真实感 | 出片即可播放/可发 | 看着像生产，实为结构化计划 + 1 图 + 文案 | 最大落差 |
| 对话深度 | 真 LLM Agent，规划→执行→精修→选工具 | Director 模式是正则/别名命令解析器，词汇有限 | 大 |
| 迭代精修 | 对真实素材反复改（运镜/重打光/换背景）| 只能改文案钩子、改图节点顺序 | 大 |
| 渲染反馈 | 实时进度/秒级出片 | 无真实渲染，无进度 | 中 |
| 跨会话记忆 | 记品牌+审美，不必重复解释 | brandKit 浅且本地 | 中 |
| 触点覆盖 | Web+iOS+Android+社区 | 单 Web | 中 |
| 平台适配 | TikTok/IG/YouTube | 抖音/小红书（国内市场反而是差异化楔子）| 持平/互补 |

---

## 五、最关键的三个差距

### 1. 视频 = 0 真实产出（致命）
`lib/ai/providers.js` 有完整 `generateVideo()`（含 system 代理 + jobId 异步），但 `lib/ai/workflow.js:runCreativeWorkflowWithAI` 只调了 `generateText` + `generateImage`。交付物里的 `video.mp4` 始终是 `lib/domain.js` 拼的占位串。对一个主打「短视频/电商视频/短剧」的产品，这是核心价值缺口。

### 2. Agent 是模拟管线，不是真协作（致命）
10 个 agent 是确定性函数，输出 evaluation/artifact 元数据；`orchestrator.plan` 是固定列表。Flow DAG 结构是真的（优势），但执行体是模拟。让每个 agent 节点真正路由到一次引擎调用，Flow 才从「图」变「生产线」。

### 3. 画布是白板，不是生成式画布（大）
`lib/canvas/*` 是矢量编辑（含缩放句柄/历史），按 RoboNeo 工具栏 1:1 做了壳，但不能在画布上生成或 AI 编辑素材。差距 = 一个生成回路 + 图像编辑能力。

---

## 六、AICrew 的相对优势

- **架构更干净**：「一个 Flow，三种模式」比 RoboNeo 三套割裂模式概念更统一，degenerate 成线性即固定管线，可扩展性好。
- **工程纪律强**：纯函数/不可变/106+ 测试/离线可跑——核心逻辑不依赖 API key 即可验证。
- **AI 层已抽象**：Claude/OpenAI/硅基流动/system 代理 + 优雅降级——接真引擎的地基已铺好。
- **国内市场楔子**：抖音/小红书定位避开 RoboNeo 的西方平台正面战场。

---

## 七、收敛方向（优先级）

> 本期决策：**暂不接入视频**。下列 P0 在「不接视频」前提下重排——
> 详见可执行计划：[[2026-06-23-make-it-real-no-video]]。

**P0 — 把图文路径从「模拟」变「真生产」**
1. 多 variant 都真出图（现仅 variant[0]）。
2. 真实可下载导出：export 产出真实图片 URL/dataURL，替换文件名清单。
3. agent 节点真路由到引擎调用（文案/图像）。

**P1 — 补体验闭环**
4. Director 模式从正则解析器升级为真 LLM 对话。
5. 图像编辑能力（去背 / 换背景 / 去水印）。
6. 生成式画布：生成素材落画布 + 选中再 AI 编辑。
7. 跨会话 Brand Memory 持久化。

**P2 / Deferred（本期不做）**
- 视频生成接入 + jobId 轮询 UI（明确推迟）。
- Motion Control 运镜、AI 音频、真实计费、移动端。

---

## 核心判断

AICrew 已把 RoboNeo 的「产品骨架和编排思想」复刻得相当到位，且工程质量更高；
真正的鸿沟是从「编排元数据」跨到「渲染真实媒体」。本期在不接视频的约束下，
先把**图文路径做到真实可交付 + 对话/画布/记忆体验真实化**，是性价比最高的推进。

## 公开参考来源

- RoboNeo 官网 — https://www.roboneo.com/
- Agent Teams 发布博客 — https://www.roboneo.com/blog/agent-teams
- Motion Control — https://www.roboneo.com/motion-control
- RoboNeo AI Review 2026 — https://aiimagetovideo.pro/blog/roboneo-ai/
- MOGE 产品页 — https://moge.ai/product/roboneo
