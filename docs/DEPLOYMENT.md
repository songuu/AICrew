# AICrew Studio 部署运行手册

本项目已从纯静态 `out/` 发布切换为 Next server runtime：`/api/ai/config` 与 `/api/ai/generate` 必须在服务端读取项目级 AI 环境变量，不能通过静态文件服务承载。

## 当前生产目标

| 配置 | 值 |
|---|---|
| base | `/aicrew/` |
| 域名 | `songuu.top` |
| 线上入口 | `https://songuu.top/aicrew/` |
| 根首页入口 | `https://songuu.top/` |
| Next server | `127.0.0.1:3101` |
| PM2 应用 | `aicrew-studio` |
| 当前 server symlink | `/opt/aicrew/current-server` |

## 本地门禁

```powershell
npm test
npm run build
npm audit --omit=dev
```

`npm run build` 生成 `.next/` server build，并应包含动态 routes：

```text
ƒ /api/ai/config
ƒ /api/ai/generate
```

## AI 环境变量

真实 AI 生成配置直接写入项目根目录 `.env`。该文件已被 `.gitignore` 忽略，不能提交真实密钥。

真实 AI 生成至少需要：

| 变量 | 用途 |
|---|---|
| `AICREW_AI_BASE_URL` | AI 平台或兼容 OpenAI API 的 base URL |
| `AICREW_AI_API_KEY` | 服务端密钥，不能暴露到浏览器 |
| `AICREW_AI_TEXT_MODEL` | 文本模型 |

可选：

| 变量 | 用途 |
|---|---|
| `AICREW_AI_PROVIDER` | `openai-compatible` / `openai` / `claude` |
| `AICREW_AI_PROVIDER_NAME` | UI 展示名 |
| `AICREW_AI_IMAGE_MODEL` | 图像模型 |
| `AICREW_AI_IMAGE_API` | 图片接口格式：`siliconflow` / `openai`；`api.siliconflow.cn` 会自动识别 |
| `AICREW_AI_IMAGE_SIZE` | 图像尺寸，默认 `1024x1024` |
| `AICREW_AI_IMAGE_BATCH_SIZE` | SiliconFlow 出图数量，默认 `1` |
| `AICREW_AI_IMAGE_STEPS` | SiliconFlow 推理步数，默认 `20` |
| `AICREW_AI_IMAGE_GUIDANCE_SCALE` | SiliconFlow guidance scale，默认 `7.5` |
| `AICREW_AI_VIDEO_MODEL` | 视频模型（进入系统选择器） |
| `AICREW_AI_MODELS_JSON` | 多模型目录 JSON |

示例 `.env`：

```dotenv
NEXT_PUBLIC_BASE_PATH=/aicrew
AICREW_AI_PROVIDER=openai-compatible
AICREW_AI_PROVIDER_NAME=项目 AI 平台
AICREW_AI_BASE_URL=https://api.siliconflow.cn/v1
AICREW_AI_API_KEY=sk-project
AICREW_AI_TEXT_MODEL=deepseek-ai/DeepSeek-V4-Pro
AICREW_AI_IMAGE_MODEL=Kwai-Kolors/Kolors
AICREW_AI_IMAGE_API=siliconflow
AICREW_AI_IMAGE_SIZE=1024x1024
AICREW_AI_VIDEO_MODEL=video-pro
```

SiliconFlow 图片生成走 `POST /v1/images/generations`，请求体使用 `image_size` 而不是 OpenAI 的 `size`，响应读取 `images[0].url`。该 URL 有效期为一小时；如后续要长期保存封面，需要增加服务端下载/对象存储步骤。

## Server runtime 发布

生产发布使用 server runtime 脚本，而不是旧 `out/` 静态发布：

```powershell
pwsh scripts/deploy-server.ps1
```

发布硬约束：

- 本地项目根目录必须存在 `.env`，且至少包含 `AICREW_AI_BASE_URL`、`AICREW_AI_API_KEY`、`AICREW_AI_TEXT_MODEL`。
- 脚本会把 `.env` 直接打进 release 包，上传到服务器并落到 `/opt/aicrew/releases/<timestamp>/.env`。
- 服务器上的 `.env` 权限会设为 `600`；真实密钥不会输出到日志。
- `current-server` 指向新 release 后，PM2 重启 `aicrew-studio`，Next server 直接从服务器 `.env` 读取配置。
- 验证会检查 `/aicrew/api/ai/config` 返回 `configured: true`，确认部署后可直接使用系统 AI。

## 容器化部署（云迁移入口）

容器化路线用于后续云服务一键迁移。当前生产仍保留 `scripts/deploy-server.ps1` + PM2/Nginx；容器镜像提供等价的 Next server runtime，不承载旧静态 `out/` 发布。

### 构建镜像

```powershell
docker build --build-arg NEXT_PUBLIC_BASE_PATH=/aicrew -t aicrew-studio:local .
```

约束：

- `NEXT_PUBLIC_BASE_PATH` 是构建期公共变量，默认 `/aicrew`。如果云端入口要改成其他子路径，需要用新 base path 重新构建镜像。
- 不要通过 `--build-arg` 注入 `AICREW_AI_API_KEY`、`AICREW_AI_BASE_URL` 或其他 secret。`.dockerignore` 已排除 `.env*`，真实密钥只能在容器运行时注入。
- 镜像运行 `npm start`，保持 Next server runtime；不设置 `AICREW_STATIC_EXPORT=1`。
- 如需检查 Compose 结构，使用 `docker compose config --no-interpolate`。普通 `docker compose config` 会展开 `env_file`，不要把输出贴到日志或工单。

### 本地运行

使用 Compose：

```powershell
docker compose up --build
```

或直接运行镜像：

```powershell
docker run --rm --env-file .env -e NEXT_PUBLIC_BASE_PATH=/aicrew -e PORT=3000 -p 3101:3000 aicrew-studio:local
```

验证：

```powershell
curl.exe -f http://127.0.0.1:3101/aicrew/
curl.exe -f http://127.0.0.1:3101/aicrew/api/ai/config/
```

`/aicrew/api/ai/config/` 在没有真实 AI 环境变量时可以返回 `configured: false`，但路由必须可访问；生产迁移验收需配置 `AICREW_AI_BASE_URL`、`AICREW_AI_API_KEY`、`AICREW_AI_TEXT_MODEL` 后确认 `configured: true`。

### 云服务迁移 checklist

1. 构建镜像时固定目标 public base path：默认 `NEXT_PUBLIC_BASE_PATH=/aicrew`。
2. 在云平台运行时环境变量中配置 AI env，不把 `.env` 打进镜像。
3. 容器端口使用 `3000`，平台或反代把外部 `/aicrew/` 转发到容器。
4. 若沿用 Nginx，反代目标改为容器内网地址或宿主映射端口，路径仍保持 `/aicrew/`。
5. 发布后验证 `/aicrew/`、`/aicrew/api/ai/config/`，真实生产还需确认 `configured: true`。

Nginx 反代示例（容器映射到宿主 `127.0.0.1:3101` 时）：

```nginx
location = /aicrew {
  return 301 /aicrew/;
}

location /aicrew/ {
  proxy_pass http://127.0.0.1:3101/aicrew/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 运行

```bash
npm start
```

Nginx 应反代到 Next server，而不是 alias 静态目录：

```nginx
location = /aicrew {
  return 301 /aicrew/;
}

location /aicrew/ {
  proxy_pass http://127.0.0.1:3101/aicrew/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 静态预览模式

当前代码包含 `/api/ai/*` 动态 Route Handler，默认发布路径是 Next server runtime。旧静态 `out/` 预览仅适用于临时移除/拆分 API route 后的纯前端预览；否则 `AICREW_STATIC_EXPORT=1 npm run build` 会被 Next 阻止。

静态模式下 `/api/ai/*` 不可用，真实 AI 生成会回退为模拟。

## 当前生产发布状态

2026-06-22 已迁移为 Next server runtime：

- release 目录：`/opt/aicrew/releases/<timestamp>`
- 当前版本软链：`/opt/aicrew/current-server`
- 生产环境变量文件：`/opt/aicrew/releases/<timestamp>/.env`
- PM2 app：`aicrew-studio`
- Nginx：`/aicrew/` 反代到 `http://127.0.0.1:3101/aicrew/`
- 最近一次 Nginx 备份：`/etc/nginx/conf.d/default.conf.bak.20260622150236`

旧静态目录 `/opt/aicrew/current/out` 已保留作回滚参考，但不再是线上入口。`scripts/deploy.ps1` 的旧静态发布路径默认禁用，避免误发布旧 `out/`。
