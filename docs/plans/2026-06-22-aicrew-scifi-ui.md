---
title: "AICrew Studio 科幻 UI 重塑 + 部署"
type: sprint
status: completed
created: "2026-06-22"
updated: "2026-06-22"
checkpoints: 0
tasks_total: 10
tasks_completed: 10
tags: [sprint, ui, redesign, deploy]
aliases: ["scifi-ui"]

goal: "按 docs/AICrew_Studio_RoboNeo_Product_PRD.md 采用最先进、最科幻的 UI 风格重塑界面，修改完成后直接部署到生产服务器"
goal_max_iter: 3
goal_until: ""
goal_iteration: 0
goal_status: met

invariants:
  - "AICrewStudio.jsx 引用的所有 className 必须有对应 CSS（改样式不破布局结构）"
  - "domain.js 导出与逻辑不变；npm test 通过"
  - "next.config.mjs 静态导出 + basePath /aicrew 不变"
  - "app/layout.jsx metadata.title 保留 'AICrew Studio'（CI 在 root 页 grep 此字符串）"
  - "路由 dashboard/workbench/skills/admin 等全部可渲染（CI 验证 200）"
  - "尊重 prefers-reduced-motion（动画可降级）"

invariant_tests:
  - tests/domain.test.js

deferred: []
deadcode_until: []
---

# AICrew Studio 科幻 UI 重塑 + 部署

## Phase 1: Think — 范围定义

### Scope（做什么）
把 AICrew Studio 全部界面从"标准暗色仪表盘"升级为**最先进、最科幻的视觉语言**——
设计主题 **"Neural Mission Control / 神经任务控制台"**：
深空黑底 + 动态极光网格、玻璃拟态发光面板、HUD 角标框、霓虹/全息渐变、
活体 Agent 流水线（脉冲节点 + 能量流连接线）、等宽遥测数据读出、扫描线/噪点叠层、
等离子聚焦环、微交互发光。覆盖全部视图：dashboard / workbench / projects /
assets / skills / brand / exports / billing / admin / onboarding / auth。
完成后**直接部署到生产服务器**（songuu.top/aicrew/）。

### Non-scope（不做什么）
- 不改 domain.js 业务/模拟逻辑、不改数据模型
- 不接真实模型 / 后端 / 鉴权
- 不新增路由或页面
- 不改静态导出契约与 basePath
- 不做无障碍以外的功能性行为变更

### Success（成功标准）
- `npm test` 通过、`npm run build` 成功、`out/` 含 `/aicrew/_next` 与 index.html
- 全部路由渲染正常、响应式断点不破、动画可降级
- 部署成功，公网 `https://songuu.top/aicrew/` 返回 200 且呈现新 UI

### Risks（风险）
1. 重写样式时破坏布局栅格 → 保留全部结构性 selector，只换观感
2. 动画性能 / 无障碍 → `prefers-reduced-motion` 降级；动画用 transform/opacity
3. 本地无法像素级验证 → 依赖 build 成功 + 严格 CSS 自审 + 审查 workflow + CI 公网校验
4. 部署属跨用户副作用 → **用户已显式授权**（目标含"直接部署"），仍打印 gate 说明

## Phase 2: Plan — 技术方案

### 入场扫描 - Invariants 继承
见 frontmatter `invariants`。本 sprint 为首个 UI 重塑 sprint，invariant 由本 sprint 建立。

### 入场扫描 - 集成路径
| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| styles.css 重写 | 页面加载 | layout.jsx import | 静态文件 | ✅ |
| JSX 增强（HUD/遥测） | 渲染 | React 组件 | 无（纯展示） | ✅ |
| 部署 | push main | GitHub Actions | 服务器原子替换 | ✅ 公网可见 |

### 入场扫描 - 债务清单
无（首个 sprint）。

### 任务拆解
| # | Task | 风险 | 验证 |
|---|------|------|------|
| 1 | 设计系统基座：tokens / 字体 / 动态极光背景 / HUD 原语 / 玻璃 / 发光 / 动画 keyframes / reduced-motion | L1 | 构建通过 |
| 2 | 重塑 App Shell：sidebar / topbar / nav / 品牌锁标 / credit ring → HUD 控制台 | L1 | 视觉自审 |
| 3 | 重塑 Dashboard：hero 控制台 / 遥测指标条 / 活体 Agent 流水线 | L1 | 视觉自审 |
| 4 | 重塑 Workbench：composer / canvas / 全息手机预览 / variant tabs / QA 遥测 | L1 | 视觉自审 |
| 5 | 重塑其余页面：projects/assets/skills/brand/exports/billing/admin/onboarding/auth | L1 | 视觉自审 |
| 6 | JSX 增强（additive）：HUD 系统状态、variant 7 维遥测可视化、装饰角标 | L1 | className↔CSS 对齐 |
| 7 | 响应式 + reduced-motion 收尾 | L1 | 断点检查 |
| 8 | 质量门：npm test + npm run build + 产物自检 | gate | exit 0 |
| 9 | 部署：commit + push main → CI 自动部署 + 公网验证 | 用户授权 | 公网 200 |

### 测试策略
- 风险等级 L0-L1（纯视觉 + 展示型 JSX，无逻辑变更）
- 不变量回归：`npm test`（domain 逻辑）必须保持通过
- 视觉验证：构建成功 + 静态产物自检 + CI 公网 200 校验
- 无新增业务逻辑，不新增单测

## Phase 3: Work — 变更日志

- [x] Task 1-5：重写 `src/styles.css` → "Neural Mission Control" 科幻设计系统
  - 动态极光背景（body::before drift）+ HUD 网格/扫描线（body::after）
  - 玻璃拟态面板 + plasma 顶边 + hero HUD 角标框
  - plasma 渐变按钮/发光焦点环、霓虹 score-badge、等宽遥测排版
  - 活体 Agent 流水线（连接线 + 脉冲节点）、全息手机预览（扫描线 sweep + 律动条）
  - 全部既有 selector 保留，新增 .system-status / .metric-bars
- [x] Task 6：additive JSX（`src/AICrewStudio.jsx`）
  - Topbar 加 `.system-status` 实时 agent 在线 HUD pill
  - VariantDetail 加 `.metric-bars` 7 维质量遥测可视化
- [x] Task 7：响应式（1180/860/540 断点）+ `prefers-reduced-motion: reduce` 全动画降级
- [x] Task 8 门：`npm test` 8/8 通过；`npm run build` 15 路由静态生成
  - 产物自检：out/index.html ✓、/aicrew/_next ✓、title 'AICrew Studio' ✓、124 文件、13 路由全在
  - 新 CSS 进 bundle：aurora-drift/system-status/metric-bars/node-pulse/scan-sweep ✓（31KB minified）

变更文件：`src/styles.css`（全量重写）、`src/AICrewStudio.jsx`（+2 处 additive）、`docs/plans/2026-06-22-aicrew-scifi-ui.md`

## Phase 4: Review — 审查结果

对抗式多视角 workflow（4 lens 审查 + 2 verify 子代理，共 6 agent），reviewer 实跑 `next build` 核验。

**P0：0 个。4 大不变量全部 HOLD：**
- 构建成功、15 路由全部静态预渲染
- domain.js / next.config.mjs / layout.jsx 未改；title 'AICrew Studio' 保留、资产基址 /aicrew/_next 保留
- 全部 JSX className 解析到 CSS（无掉布局孤儿）
- `prefers-reduced-motion` 真实中和全部 6 个装饰动画 + 重置 gradient-text
- 固定 aurora 层 z-index:0 + pointer-events:none，内容根 z-index:1 → 既不遮挡也不拦截点击

**第 6 视角（集成连续性）：PASS** — 纯 additive UI + 视觉重写，无逻辑/导入/配置/数据改动，无 bundle 膨胀级 dead code。

**确认 P1（1 个，已修）：** `.agent-step em`（agent 时长遥测真实内容）用 `--muted-2` (#5f6c8f) @11px → 实测对比度 ~3.3:1 < AA 4.5:1 → 改用 `--muted` (6.66:1)。

**应用的 P2（部署前便宜稳健性/a11y）：**
1. agent-rail 脊线 left 18→25px，节点回到流水线轴线
2. 补 `.asset-thumb.image` 强调色（三类素材区分完整）
3. `@supports not (background-clip:text)` fallback → 不支持引擎文字不消失
4. metric-strip 在 ≤1180px 提前 2-up，避免 KPI 数字截断
5. variant-tabs 加 `role="tab"` + `aria-selected`
6. active 态 `:focus-visible` 覆盖，焦点环不再被 .active glow 遮蔽

**记录不修的 P2（taste/无害，写入文档不展开）：** spacing 粒度 8/10/12/14/16/18、eyebrow 泛用、phone-preview 跨容器同尺寸、`brand-preview` 孤儿类（与 .panel 共用，无害）、focus ring 玻璃质感。

复测：`npm test` 8/8、`npm run build` 15/15、产物自检通过、修复进 bundle。

## Phase 5: Compound — 复利记录

**经验沉淀：**
- 大规模 UI 重写时**保留全部结构性 selector、只换观感**，可实现零布局回归（reviewer 交叉核验 className↔CSS 全解析）。
- 装饰动画必须统一收口到 `@media (prefers-reduced-motion: reduce)` 的 `*,*::before,*::after` 通配降级。
- `background-clip:text; color:transparent` 渐变文字**必须**配 `@supports not (...)` fallback，否则不支持引擎整段文字消失。
- 暗色玻璃系统中，正文/遥测文字走 `--muted`(≥AA)，`--muted-2` 仅留给 placeholder 等非必要提示。
- 固定全屏装饰层放 `z-index:0 + pointer-events:none`，内容根 `position:relative; z-index:1`，避免遮挡与点击拦截。
- 部署经 push main → GitHub Actions（`deploy-aicrew.yml`：test→build→audit→原子替换→公网校验，含备份回滚），无需本地 SSH。

**部署：** commit `39a8c32` → push main → GitHub Actions run `27924142902` success
→ 公网校验：`songuu.top/aicrew/` 200 + title 'AICrew Studio'、线上 CSS 含 `aurora-drift`、
workbench/skills/admin 全 200。

**关键操作经验：** auto-mode 权限分类器对"push main = 生产部署"硬拦截，即使 `/goal` 文本含
"直接部署"也不放行；且会拦截**整条含 push 的复合命令**（连带 add/commit 一起失败）。
解法：本地 commit 与 push 分两步；push 需用户**显式授权**（AskUserQuestion）后才放行。

Goal loop: iter 0/3, until=n/a, goal-met=yes, decision=stop:met
</content>
</invoke>

## 追加迭代：RoboNeo Canvas Mode（2026-06-22）

### Phase 1/2：范围与方案

用户反馈：当前界面“不够科幻”，要求继续参照 `www.roboneo.com` 风格和截图。

本轮追加目标：从之前的“Neural Mission Control”进一步收敛到 RoboNeo 式创作画布：
黑色点阵背景、左侧智能体对话面板、浮动底部工具坞、右侧快捷控制、深色悬浮面板、紫色主动作。

Scope：
- `AICrewStudio.jsx` additive 增加 `SidebarAssistant`、`FloatingCommandLayer`、`runtime-card`。
- `styles.css` 追加 `RoboNeo canvas mode override`，不破坏已有业务 selector。
- 修移动端窄屏 containment，隐藏桌面浮动工具，避免横向裁切。

Non-scope：
- 不改 domain / AI provider / token 存储逻辑。
- 不新增依赖，不调用真实外部 AI API。
- 不部署生产。

### Phase 3：变更日志

- [x] Task 10：RoboNeo Canvas Mode 视觉加强
  - 左侧 sidebar 改成更像 RoboNeo 的创作对话面板：Pilot 头像、能力标签、发送创作任务入口。
  - 主画布改为黑色点阵 + 深色浮动面板，降低旧版极光渐变感。
  - 新增右侧快捷工具 rail、底部工具 dock、右下状态 dock。
  - Dashboard hero 加 runtime-card，强化 live canvas/agent chain 状态。
  - 统一面板/卡片 radius 到 8px，修复负 letter-spacing 覆盖。
  - 移动端补 `max-width: 100vw` containment，隐藏桌面浮动 dock。

### Phase 4：Review

风险等级：L1/L2（视觉结构 + 展示型 JSX）。

验证结果：
- `npm test`：29/29 pass。
- `npm run build`：Next.js 16.2.9 build pass，16/16 static pages。
- 桌面截图：`C:/tmp/aicrew-dashboard-1440.png`，首屏呈现左侧 Pilot 面板、点阵画布、浮动工具坞、右侧工具 rail。
- 移动截图：`C:/tmp/aicrew-workbench-390.png`，窄屏隐藏浮动 dock，侧栏/导航按两列堆叠。

注意：sandbox 下 `npm test` 曾因 Node child process `spawn EPERM` 失败，`npm run build` 曾因 `.next` unlink `EPERM` 失败；非 sandbox 重跑均通过，判定为环境权限问题，不是代码失败。

### Phase 5：Compound

经验：RoboNeo 参考不是单纯“更多霓虹”，核心是黑色无限点阵画布 + 左侧对话式控制面板 + 浮动工具坞。后续继续迭代时，应优先增强“画布工具感”和“agent 对话输入”，再增加局部动效。

Goal loop: iter 0/3, until=n/a, goal-met=yes, decision=stop:met
