---
title: "容器化部署支持"
type: sprint
status: completed
created: "2026-06-24"
updated: "2026-06-24"
checkpoints: 0
tasks_total: 5
tasks_completed: 5
tags: [sprint, deployment, container]
aliases: ["containerized deployment", "Docker deployment"]

invariants:
  - "默认生产入口仍是 Next server runtime，不能退回纯静态 out/ 发布"
  - "basePath 保持 /aicrew，容器和非容器部署访问路径一致"
  - "AI 密钥只能从服务端环境变量读取，不能进入浏览器 bundle 或镜像源码层"
  - "现有 PM2/Nginx 发布路径继续可用，容器化作为云迁移入口而非破坏性替换"
invariant_tests:
  - npm test
  - npm run build

deferred:
  - sprint: follow-up
    item: "Docker daemon 启动后补跑镜像 build/run 验证"
    deadline: "2026-07-15"
    reason: "当前机器 Docker client 可用但 Docker Desktop daemon 未启动，无法验证实际镜像运行"
deadcode_until: []
---

# Sprint: 容器化部署支持

## Phase 1: Think

### Scope
- 为 AICrew Studio 增加容器化部署闭环，支持后续云服务一键迁移。
- 目标运行形态：Next server runtime 容器，而不是静态 `out/` 容器。
- 交付物预计包括 `Dockerfile`、`.dockerignore`、本地/云迁移可用的 Compose 或等价运行示例、部署文档更新。
- 容器启动后必须保持现有生产语义：`NEXT_PUBLIC_BASE_PATH=/aicrew`，Next server 监听容器内 `PORT`，AI 配置从运行时 env 注入。

### Non-scope
- 不在本 sprint 内执行真实云厂商迁移、购买资源、绑定域名或改 DNS。
- 不替换当前 `scripts/deploy-server.ps1` + PM2/Nginx 生产发布路径。
- 不把 `.env` 或真实密钥写入镜像、仓库、构建日志。
- 不引入数据库/对象存储迁移自动化；当前请求只覆盖应用容器化。

### Success
- 本地可执行容器构建，并能以运行时环境变量启动服务。
- 容器访问路径与当前线上一致：`/aicrew/` 与 `/aicrew/api/ai/config/`。
- 文档明确区分：传统 PM2 部署、容器部署、云迁移时的环境变量和反代边界。
- 验证命令覆盖至少：`npm test`、`npm run build`、容器镜像构建；如 Docker 不可用，记录环境阻塞而不伪装成功。

### Risks
- Next 16 server build 与容器 standalone 输出是否需要调整 `next.config.mjs`，必须先验证后定。
- `NEXT_PUBLIC_BASE_PATH` 是构建期变量；容器迁移若要求不同 base path，可能需要按目标 base path 重建镜像。
- `AICREW_AI_API_KEY` 等密钥若通过 build arg 注入会泄露到镜像层；必须只允许 runtime env。
- Windows 本机可能没有 Docker daemon 或受沙箱限制；验证结果需区分源码问题与本机环境问题。

### Repo Facts
- `package.json` 当前脚本：`npm test`、`npm run build`、`npm start`。
- `next.config.mjs` 当前默认：`basePath=/aicrew`，`assetPrefix=/aicrew/`，`trailingSlash=true`。
- `docs/DEPLOYMENT.md` 当前声明：生产为 Next server runtime，`/api/ai/config` 与 `/api/ai/generate` 必须服务端读取 env。
- `scripts/deploy-server.ps1` 当前是 PM2/Nginx 传统发布入口，且会把项目 `.env` 打包进 release；容器路线需改为运行时 env 注入。

## Next Phase Preview
- 关键文件：`package.json`、`next.config.mjs`、`docs/DEPLOYMENT.md`、`scripts/deploy-server.ps1`。
- 起步命令：`docker version`、`npm test`、`npm run build`。
- Plan 重点：是否启用 Next standalone 输出、镜像层是否包含 `.env`、Compose 如何表达 `/aicrew` 反代和 runtime env。
## Phase 2: Plan

### 入场扫描 - Invariants 继承

| 子系统 | 上 sprint invariant | 本 sprint 如何保持 |
|---|---|---|
| Next 发布形态 | 默认生产入口为 Next server runtime，`/api/ai/*` 必须服务端读取 env | Docker 镜像运行 `npm start`，不启用 `AICREW_STATIC_EXPORT=1`，不回退 `out/` |
| 子路径部署 | `basePath=/aicrew`、`assetPrefix=/aicrew/`、`trailingSlash=true` | Docker build 默认 `NEXT_PUBLIC_BASE_PATH=/aicrew`，Compose/runtime 也显式设置同值 |
| AI 密钥边界 | 浏览器不得接收 `AICREW_AI_API_KEY` / base URL 等 secret | `.dockerignore` 排除 `.env*`，Dockerfile 不使用 secret build args，Compose 只通过 runtime env / env_file 注入 |
| 传统发布链路 | `scripts/deploy-server.ps1` + PM2/Nginx 仍为当前生产发布路径 | 不改 deploy-server 行为；文档新增容器路线为云迁移入口 |

### 入场扫描 - 集成路径

| 改动点 | 触发动作 | 中间层 | 持久化/运行态 | 刷新后可见 |
|---|---|---|---|---|
| Docker 镜像 | `docker build` | multi-stage Node image → `npm run build` | 镜像内 `.next` + prod dependencies | ✅ `/aicrew/` 由 `npm start` 提供 |
| 容器运行 | `docker compose up` / 云服务启动容器 | runtime env → Next server | env 由平台注入，不进入镜像层 | ✅ `/aicrew/api/ai/config/` 反映配置状态 |
| 云迁移文档 | 运维按文档配置 | image + env + reverse proxy / platform ingress | 云平台环境变量 | ✅ 同一路径 `/aicrew/` |

无静默 `❌`：当前 Docker daemon 不可用，属于本机验证阻塞；Work 阶段仍应落文件并尝试镜像构建，若 daemon 仍不可用则把 Docker build/run 标为环境阻塞，不计为源码通过。

### 入场扫描 - 债务清单

| 来源 sprint | 议题 | 本 sprint 决策 | deadline |
|---|---|---|---|
| 2026-06-22 system AI config | 生产 Next server runtime 需要服务端 env | ✅ 本轮容器保持 runtime env 注入 | 2026-06-24 |
| 当前请求 | 云服务一键迁移 | ✅ 本轮交付容器入口 + 文档；真实云资源迁移不做 | 2026-06-24 |
| 后续 | 不同云平台 IaC / registry push / DNS 切换 | ⏭ 推迟；需目标云厂商和账号权限 | 2026-09-30 |

### 技术方案

- `Dockerfile`：采用 multi-stage 构建，`deps` 安装依赖，`builder` 执行 `npm run build`，`runner` 只保留生产运行所需文件并以非 root 用户运行 `npm start`。
- 不默认启用 Next `output: "standalone"`：先保证与现有 `next start`/PM2 运行模型一致，避免为了镜像体积影响当前生产链路；如后续镜像体积成为问题，再单独 sprint 验证 standalone。
- `.dockerignore`：排除 `.env*`、`.git`、`node_modules`、`.next`、`out`、日志、handoff 等本地/敏感/构建产物，确保 secret 不进 build context。
- `compose.yml`：提供本地/云迁移参考，`ports: 3101:3000`，`env_file: .env`，`NEXT_PUBLIC_BASE_PATH=/aicrew`，镜像运行时通过环境变量注入 AI 配置。
- 文档：更新 `docs/DEPLOYMENT.md` 与 `README.md`，明确 PM2 路线与容器路线边界、构建/运行命令、反代示例、云平台迁移 checklist。

### 任务拆解

| # | Task | 风险 | 验证 |
|---|---|---|---|
| T1 | 新增 `Dockerfile`：multi-stage Next server runtime，非 root，runtime env，健康检查 | L3 | `docker build -t aicrew-studio:local .` |
| T2 | 新增 `.dockerignore` 与 `compose.yml`，确保 `.env` 只 runtime 注入、不进镜像上下文 | L3 | `docker compose config`；人工检查 ignore 规则 |
| T3 | 更新 `docs/DEPLOYMENT.md`：容器部署、云迁移 checklist、反代、密钥边界 | L2 | 文档审查 + 命令可复制 |
| T4 | 更新 `README.md`：本地容器启动最短路径与 env 说明 | L1 | 文档审查 |
| T5 | 跑回归与容器验证，记录 Docker daemon 当前阻塞或成功结果 | L3 | `npm test`、`npm run build`、`docker version`、`docker build`、可选 `docker compose up` + `/aicrew/api/ai/config/` |

### 验证策略

- 必跑：`npm test`、`npm run build`。
- 容器 gate：`docker version` 当前结果为 Docker client 可用但 daemon 未启动：`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`。
- Work 阶段先实施文件，再重新尝试 `docker build`；若 daemon 仍不可用，结论写为环境阻塞，不把容器运行验证伪装为通过。

### 下一 Phase 预热（Phase 3: Work）

- 关键文件：`Dockerfile`、`.dockerignore`、`compose.yml`、`docs/DEPLOYMENT.md`、`README.md`。
- 起步命令：`npm test`、`npm run build`、`docker version`。
- 风险预判：secret 不能进 build context；`NEXT_PUBLIC_BASE_PATH` 构建期固定；Docker daemon 当前未启动。
## Phase 3: Work（changelog）

| Task | 状态 | 改动 |
|---|---|---|
| T1 | ✅ | 新增 `Dockerfile`：Node 24 Alpine multi-stage；`deps`/`builder`/`runner` 分层；构建期 `NEXT_PUBLIC_BASE_PATH` 默认 `/aicrew`；runner 非 root；`npm start` 监听 `${PORT}` 和 `${AICREW_HOST}`；healthcheck 命中 `${NEXT_PUBLIC_BASE_PATH}/api/ai/config/`。 |
| T2 | ✅ | 新增 `.dockerignore`：排除 `.env*`、`.git`、`node_modules`、`.next`、`out`、日志、handoff 等；新增 `compose.yml`：镜像构建、`3101:3000` 映射、runtime env、`.env` 仅作为运行时 `env_file`。 |
| T3 | ✅ | `docs/DEPLOYMENT.md` 新增容器化部署章节：镜像构建、本地运行、云迁移 checklist、Nginx 容器反代示例、secret 不进 build args、`docker compose config --no-interpolate` 安全检查提示。 |
| T4 | ✅ | `README.md` 新增 Container Deployment 快速入口：build、compose、docker run、访问路径、runtime secret 边界。 |
| T5 | ✅/⚠ | 回归与静态容器检查已跑；Docker build/run 被本机 Docker daemon 未启动阻塞，已记录为环境阻塞，不作为源码失败。 |

### 验证

| 命令 | 结果 | 结论 |
|---|---|---|
| `npm test`（sandbox） | fail：全部 test file `spawn EPERM` | sandbox child-process 限制，不判源码失败 |
| `npm test`（require_escalated） | pass：212 pass / 2 skip / 0 fail | 源码回归通过 |
| `npm run build`（sandbox） | fail：`.next/app-path-routes-manifest.json` unlink EPERM | sandbox filesystem 限制，不判源码失败 |
| `npm run build`（require_escalated） | pass：Next 16.2.9 编译成功；动态 route 含 `/api/ai/config`、`/api/ai/generate` | server runtime 构建通过 |
| `docker compose config --no-interpolate` | pass | Compose 结构有效，且未展开 `.env` secret |
| `docker version` | fail：Docker client 可用，但 `dockerDesktopLinuxEngine` pipe 不存在 | Docker daemon 未启动 |
| `docker build --build-arg NEXT_PUBLIC_BASE_PATH=/aicrew -t aicrew-studio:local .` | fail：无法连接 Docker API `npipe:////./pipe/dockerDesktopLinuxEngine` | 环境阻塞，镜像实际构建/运行未验证 |

### 本轮发现

- 普通 `docker compose config` 会展开 `env_file` 内容，可能把 `.env` secret 打到日志；后续结构检查必须使用 `docker compose config --no-interpolate` 或避免共享输出。
- Dockerfile 需要在 `builder` 和 `runner` 阶段都声明 `ARG NEXT_PUBLIC_BASE_PATH`，否则自定义 base path 构建后 runner 默认值会漂回 `/aicrew`。

### 下一 Phase 预热（Phase 4: Review）

- 关键文件：`Dockerfile`、`.dockerignore`、`compose.yml`、`docs/DEPLOYMENT.md`、`README.md`。
- 执行命令：`git diff -- Dockerfile .dockerignore compose.yml docs/DEPLOYMENT.md README.md docs/plans/2026-06-24-containerized-deployment.md`。
- 风险预判：Docker build/run 未验证；Compose `env_file` 便利性 vs config 输出泄密风险；Next 非 standalone 镜像体积较大但兼容当前生产链路。
## Phase 4: Review（6 视角）

### 派遣记录

- 评估 risk：L3（部署/runtime 边界 + secret 边界 + 容器运行路径）。
- 跑的视角：security、arch、quality、test、integration-continuity；perf 跳过（未改请求处理/数据路径，镜像体积为 P2 后续优化）。
- Design lens：跳过；diff 为部署/文档/容器配置，无 UI/CSS/视觉输出。
- Blocked：0。

### Gap Detection Walkthrough

| workflow / invariant | existing coverage | uncovered gap | action |
|---|---|---|---|
| Next server runtime 不退回静态 `out/` | `Dockerfile` 运行 `npm start`；`npm run build` 通过，动态 route 包含 `/api/ai/config`/`generate` | none | pass |
| `/aicrew` 子路径一致 | `Dockerfile` build arg + runner env；`compose.yml` 同值；docs 验证 URL 使用 `/aicrew/` | 不同云 path 需重新 build | docs 已声明 |
| secret 不进镜像/日志 | `.dockerignore` 排除 `.env*`；Dockerfile 无 secret build arg；docs 禁止 secret build arg；`rg` 只命中示例 `sk-project` | 普通 `docker compose config` 会展开 env_file | docs 已加入 `--no-interpolate` 安全提示 |
| 容器实际 build/run | Docker client 可用；`docker compose config --no-interpolate` 通过 | Docker daemon 未启动，`docker build`/run 未验证 | P1 verification gap |
| 传统 PM2/Nginx 发布链路 | 未改 `scripts/deploy-server.ps1`；README/DEPLOYMENT 明确不替换 | none | pass |

### Doc↔Code 一致性 Walkthrough

| doc claim | 断言内容 | code reality | 状态 | confidence | action |
|---|---|---|---|---|---|
| `docs/DEPLOYMENT.md` 容器章节 | `.dockerignore` 排除 `.env*` | `.dockerignore` lines 10-12：`.env` / `.env.*` / `!.env.example` | PASS | high | none |
| `docs/DEPLOYMENT.md` 容器章节 | 镜像运行 `npm start` | `Dockerfile` CMD：`npm start -- -H ... -p ...` | PASS | high | none |
| `README.md` 容器章节 | 不替换当前 PM2/Nginx 路径 | `scripts/deploy-server.ps1` 未改；README 只新增 Container Deployment | PASS | high | none |
| sprint doc Phase 3 | `docker build` 未验证，daemon 未启动 | `docker build ...` 输出无法连接 `dockerDesktopLinuxEngine` | PASS | high | none |

Second pass：已扫描 `已 / 不 / configured / verified / pass / fail / build` 等状态词；未发现 doc 高估 code 的断言。唯一未完成项已作为 P1 verification gap 暴露。

### 5 + 1 视角结论

| 视角 | 结论 |
|---|---|
| Security | PASS：无真实密钥入仓；Docker build context 排除 `.env*`；docs 修正 Compose config 输出泄密风险。注意：已有 docs 示例 `sk-project` 为占位，不是真密钥。 |
| Architecture | PASS：容器入口保持现有 Next server runtime，不改 PM2/Nginx 发布链路；不引入 standalone 迁移风险。 |
| Quality | PASS：新增文件职责清晰；README/DEPLOYMENT EOF newline 已修；`git diff --check` 通过。 |
| Test | PASS with caveat：`npm test`/`npm run build` 提权后通过；Compose 静态配置通过；Docker build/run 因 daemon 缺失未验证。 |
| Integration continuity | PASS with caveat：跨 sprint invariant 未破坏；容器实际运行验收需 Docker daemon 可用后补跑。 |
| Performance | P2：非 standalone 镜像体积可能较大，但按 YAGNI 保持当前 `next start` 模型，后续再优化。 |

### P0 / P1 / P2

P0：无。

P1：
- `Dockerfile` / `compose.yml` verification：容器镜像实际 build/run 未验证。原因是本机 Docker daemon 未启动（`dockerDesktopLinuxEngine` pipe 不存在）。修复/关闭：启动 Docker Desktop 后运行 `docker build --build-arg NEXT_PUBLIC_BASE_PATH=/aicrew -t aicrew-studio:local .`，再运行容器并验证 `/aicrew/` 与 `/aicrew/api/ai/config/`。

P2：
- Dockerfile 当前未启用 Next standalone，镜像会包含完整 prod `node_modules`。这是刻意兼容当前 PM2/`next start` 模型；若镜像体积成为云迁移成本问题，单独开 sprint 验证 `output: "standalone"`。

### Review Verdict

- 可进入 Compound，但不能宣称“容器已实际构建/运行通过”。当前可宣称：容器化入口与文档已实现，源码 gate/Compose 静态 gate 通过，Docker runtime gate 被本机 daemon 阻塞。

### 下一 Phase 预热（Phase 5: Compound）

- 关键沉淀：`docker compose config` 会展开 `.env`，结构检查需 `--no-interpolate`；Dockerfile 自定义 basePath 要 builder/runner 双阶段声明 `ARG NEXT_PUBLIC_BASE_PATH`。
- 收尾状态：若不启动 Docker Desktop，本 sprint 完成状态应保留 P1 verification gap。
## Phase 5: Compound

### 复利产出

| 类型 | 产出 |
|---|---|
| 解决方案 | `docs/solutions/2026-06-24-containerized-deployment.md` |
| 索引 | `docs/solutions/index.jsonl`（仓库当前无 `scripts/sync-solution-index.js`，本轮创建最小索引；无 runtime projection） |
| 经验 | Compose 结构检查需 `--no-interpolate`；Dockerfile basePath 要 builder/runner 双阶段同源 |
| Skill 信号 | 使用 `sprint` / `work` / `test-strategy` / `review` / `compound` |

### 沉淀条目

1. `docker compose config` 会展开 `env_file` 内容，可能泄露 `.env`；审查/日志场景应使用 `docker compose config --no-interpolate`。
2. Next 子路径部署容器化时，`NEXT_PUBLIC_BASE_PATH` 既影响构建产物，也影响运行期 healthcheck/文档路径；Dockerfile builder/runner 阶段必须保持同一 build arg 默认值。
3. Docker daemon 不可用时，验收边界必须拆开：源码测试、Next build、Compose 静态配置可以通过；Docker image build/run 仍是未验证项。

### 最终状态

- Status：completed with verification gap。
- Completed：5/5 tasks。
- Closed gates：`npm test`（提权后 212 pass / 2 skip）、`npm run build`（提权后 pass）、`docker compose config --no-interpolate`（pass）、`git diff --check`（pass）。
- Open gate：`docker build --build-arg NEXT_PUBLIC_BASE_PATH=/aicrew -t aicrew-studio:local .` 与容器 run 验证，阻塞于 Docker daemon 未启动。

### Follow-up

启动 Docker Desktop 后补跑：

```powershell
docker build --build-arg NEXT_PUBLIC_BASE_PATH=/aicrew -t aicrew-studio:local .
docker run --rm --env-file .env -e NEXT_PUBLIC_BASE_PATH=/aicrew -e PORT=3000 -p 3101:3000 aicrew-studio:local
curl.exe -f http://127.0.0.1:3101/aicrew/
curl.exe -f http://127.0.0.1:3101/aicrew/api/ai/config/
```

🧠 会话收尾：
  ✅ 已 compound：1 个 solution + 3 条经验 + 5 个 skill 信号
⚠️ 建议 /compact — 本轮完成完整 sprint，且 Docker runtime gate 留有明确 follow-up。

