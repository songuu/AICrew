---
title: "系统级 AI 平台配置接入"
type: sprint
status: completed
created: "2026-06-22"
updated: "2026-06-22"
checkpoints: 0
tasks_total: 6
tasks_completed: 6
tags: [sprint, feature, ai-platform, env-config]
aliases: ["AI 平台系统配置", "系统模型选择器"]

invariants:
  - "浏览器不得接收 AICREW_AI_API_KEY / baseURL 等 secret"
  - "用户不能输入 token、baseURL 或自定义模型；只能选择系统模型 id"
  - "无系统 AI env 时必须回退确定性模拟，不阻断现有创作链路"
  - "domain.js 纯函数契约不变；domain/canvas/ai 测试全绿"

invariant_tests:
  - tests/ai.test.js
  - tests/domain.test.js
  - tests/canvas.test.js

deferred: []

---

# 系统级 AI 平台配置接入

## 需求分析（Phase 1 Think）

用户诉求：把当前 AICrew 接入 AI 平台，配置改为项目级环境变量；不支持用户配置；用户只能选择系统配置；参考截图里的模型选择方式，并在图像/视频基础上增加文本。

### Scope
- 后端 API：`/api/ai/config` 暴露公开模型目录；`/api/ai/generate` 读取 server env 后代理 text/image/video。
- 配置层：直接读取项目根目录 `.env`（Next 自动加载）里的 `AICREW_AI_BASE_URL`、`AICREW_AI_API_KEY`、`AICREW_AI_TEXT_MODEL`、`AICREW_AI_IMAGE_MODEL`、`AICREW_AI_IMAGE_API`、`AICREW_AI_VIDEO_MODEL`、`AICREW_AI_MODELS_JSON`。
- 前端：移除 token/baseURL/provider 表单，改为“文本 / 图像 / 视频”系统模型选择器。
- 工作流：文案走系统 text 模型，封面走系统 image 模型；无 env 时回退模拟。
- 文档：更新 README 与部署手册，明确静态 out 与 server API 的边界。

### Non-scope
- 真实视频渲染链路接入到现有 export（本 sprint 先接配置目录/API 能力）。
- systemd/container 部署脚本迁移。
- 账号、权限、计费、密钥托管后台。

### Success
- 用户无法输入 token/baseURL；UI 只展示系统模型。
- API config 响应不包含 key/baseURL。
- text/image/video 模型均可由 env 或 JSON catalog 配置。
- `npm test` 与 `npm run build` 通过。

## 技术方案（Phase 2 Plan）

### 入场扫描 - Invariants 继承

| 子系统 | 既有 invariant | 本 sprint 如何保持 |
|--------|----------------|--------------------|
| Domain | `runCreativeWorkflow` 纯函数契约 | AI 层继续包装，不改 domain 签名 |
| 安全 | secret 不进 git/日志/UI | env 只在 route handler 读取，公开 config 过滤 secret |
| 回退 | 无 AI 配置仍可演示 | `isAiConfigured=false` 时走确定性模拟 |
| UI | RoboNeo 模型弹层模式 | 设置页复用 tab + list 选择结构，新增文本 tab |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化 | 刷新后可见 |
|--------|----------|--------|--------|------------|
| 系统模型目录 | 打开页面 | `/api/ai/config` -> `normalizeSystemAiConfig` | ❌ env runtime | ✅ 重新 fetch |
| 模型选择 | 点击系统模型 | `saveAiSelection` | ✅ localStorage 仅 model id | ✅ 读回选择 id |
| 文本生成 | Workbench submit | `runCreativeWorkflowWithAI` -> `/api/ai/generate` | ✅ task state | ✅ task 可见 |
| 图像生成 | Workbench submit | system image route | ❌ imageUrl 不进主 blob | ❌ 仅会话内 |
| 视频模型 | Settings 选择 | catalog selection | ✅ model id | ✅ 选择可见 |

### 任务拆解

| # | 任务 | 风险 | 结果 |
|---|------|------|------|
| 1 | 重写 `src/ai/config.js` 为系统模型目录与选择持久化 | L3 | 完成 |
| 2 | 新增 `src/ai/server-config.js` 读取 env/JSON catalog | L3 | 完成 |
| 3 | 改 `src/ai/providers.js` 支持 system API 代理与 direct server provider | L3 | 完成 |
| 4 | 新增 `/api/ai/config`、`/api/ai/generate` | L3 | 完成 |
| 5 | 改 `AICrewStudio` 设置页与生成接线 | L2 | 完成 |
| 6 | 更新测试、README、部署手册 | L2 | 完成 |

## 变更日志（Phase 3）

- `src/ai/config.js`：移除用户 token 配置，新增 text/image/video modes、selection storage、direct/system config 判断。
- `.env`：新增本地系统 AI 配置文件（gitignored，真实密钥不提交）。
- `src/ai/server-config.js`：新增 env runtime 解析、public config 过滤、model resolve、connection mapping。
- `src/ai/providers.js`：新增 `provider:"system"` 前端 API 代理；保留 direct provider 给 server route 调用；新增 video generation wrapper。
- `app/api/ai/config/route.js`：返回公开模型目录与缺失 env 信息。
- `app/api/ai/generate/route.js`：server env 代理 text/image/video 调用。
- `src/ai/workflow.js`：text/image 能力改走系统模式；无配置回退模拟。
- `src/AICrewStudio.jsx`：设置页改为系统模型选择器；生成文案提示改为系统 AI 状态。
- `next.config.mjs`：默认 Next server build；`AICREW_STATIC_EXPORT=1` 保留静态预览。
- `tests/ai.test.js`：覆盖 env catalog、secret 不泄露、system API proxy、workflow 回退。
- SiliconFlow 图片生成：按官方文档使用 `image_size` / `batch_size` / `num_inference_steps` / `guidance_scale`，并解析 `images[0].url`。
- `scripts/deploy-server.ps1`：新增 Next server runtime 发布脚本；`.env` 随 release 上传到服务器，落到 `/opt/aicrew/releases/<timestamp>/.env`，权限设为 `600`，部署后 PM2 直接读取。

## 审查结果（Phase 4）

| 严重度 | 视角 | 问题 | 处理 |
|--------|------|------|------|
| P1 | 部署连续性 | 旧静态 `out/` 发布无法承载 server API | ✅ 新增 `scripts/deploy-server.ps1`，server release 包含 `.env` 并重启 PM2；旧脚本仅保留静态回滚 |
| P2 | 安全 | 公开 config 可能误泄 baseURL/key | ✅ `publicSystemAiConfig` 只输出 providerName/model metadata/missing，不输出 key/baseURL |
| P2 | 回退 | `normalizeSystemAiConfig(null)` 触发异常 | ✅ 增加 null fallback，回归测试覆盖 |
| P2 | UI | 用户配置入口残留会违反需求 | ✅ `rg` 扫描旧 Token/provider/baseURL 表单符号为 0 |

## 验证（Phase 4/5）

- `npm test`：65/65 pass（提升权限运行；普通 sandbox 触发 `spawn EPERM`）。
- `npm run build`：pass；构建结果包含 `ƒ /api/ai/config`、`ƒ /api/ai/generate`。
- `.env`：已写入 SiliconFlow baseURL、text/image 模型、`AICREW_AI_IMAGE_API=siliconflow` 与图像参数；真实 key 仅保留在 gitignored 本地文件。
- `pwsh scripts/deploy-server.ps1 -DryRun`：验证部署参数与 `.env` 必填项；不上传、不重启。
- `pwsh scripts/deploy-server.ps1`：首次远端 `npm ci --omit=dev` 被服务器 kill；脚本改为 package-lock 一致时复用当前 `node_modules`，并增加失败清理未切换 release。
- `pwsh scripts/deploy-server.ps1 -SkipTests -SkipBuild`：部署成功；`current-server -> /opt/aicrew/releases/aicrew-server-20260622155222`，服务器 `.env` 权限 `600`。
- 服务器侧验证：`/aicrew/api/ai/config/` direct 与 Nginx loopback 均 200 且 `configured:true`；`https://songuu.top/aicrew/` 服务器侧 200。
- 本机 `curl.exe https://songuu.top/aicrew/` 返回 `000`，但服务器侧公网验证 200；按本机网络出口限制记录，不作为线上失败。
- 本地服务：若复用已启动的 `http://127.0.0.1:3000/aicrew/`，需重启 dev server 才会读取最新 `.env`。
- Playwright 截图未执行：本机 Playwright Chromium 未安装。

## 复利记录（Phase 5）

- 静态站 + server secret 是硬冲突：只要需求要求 env secret 不暴露，必须进入 server/API runtime。
- 系统配置与用户选择要分层：env 保存能力与 secret；localStorage 只保存 model id。
- 图像/视频/文本应作为 mode 统一建模，避免后续再为每类模型复制配置流。

Goal loop: iter 1/3, until=n/a, goal-met=yes, decision=stop:requirements-covered
