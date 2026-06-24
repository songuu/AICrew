---
title: "AICrew 容器化部署入口"
date: 2026-06-24
tags: [solution, deployment, container, nextjs]
related_instincts: []
aliases: ["Docker deployment", "containerized Next runtime"]
---

# AICrew 容器化部署入口

## Problem

AICrew 后续可能迁移到云服务一键部署，需要一个不破坏当前 PM2/Nginx 生产链路的容器化入口。

## Root Cause

项目已从静态 `out/` 切到 Next server runtime，`/api/ai/config` 和 `/api/ai/generate` 必须读取服务端环境变量。直接做静态容器或把 `.env` 打进镜像都会破坏 runtime/secret 边界。

## Solution

- 新增 `Dockerfile`：Node Alpine multi-stage，构建 Next server runtime，runner 非 root，运行 `npm start`。
- 新增 `.dockerignore`：排除 `.env*`、`.next`、`node_modules`、`out`、handoff 和本地工作目录。
- 新增 `compose.yml`：本地和云迁移参考入口，`.env` 仅作为 runtime `env_file`。
- 更新 `docs/DEPLOYMENT.md` / `README.md`：明确 PM2 路线与容器路线边界，禁止通过 build arg 注入 secret。

## Prevention

- 检查 Compose 结构时使用 `docker compose config --no-interpolate`；普通 `docker compose config` 会展开 `env_file`，可能把 secret 打到日志。
- 自定义 `NEXT_PUBLIC_BASE_PATH` 时，Dockerfile 的 builder 和 runner 阶段都要声明同一个 `ARG NEXT_PUBLIC_BASE_PATH`，避免构建路径和运行 healthcheck 路径漂移。
- Docker daemon 不可用时，只能声明源码 gate / Compose 静态 gate 通过，不能声明镜像实际 build/run 通过。

## Related

- [[2026-06-24-containerized-deployment]] — sprint 文档
- [[docs/DEPLOYMENT]] — 部署运行手册
