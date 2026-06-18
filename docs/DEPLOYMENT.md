# AICrew Studio 部署运行手册

本项目按 `agent-build` 的静态站发布方式部署到同一台生产主机。

## 当前生产目标

| 配置 | 值 |
|---|---|
| 部署主机 | `root@47.253.230.197` |
| web root | `/opt/aicrew/current/out` |
| base | `/aicrew/` |
| 域名 | `songuu.top` |
| 线上入口 | `https://songuu.top/aicrew/` |
| 根首页入口 | `https://songuu.top/` |

## 本地门禁

```powershell
npm test
npm run build
npm audit --omit=dev
```

`npm run build` 生成 Next 静态导出目录 `out/`，并要求 `out/index.html` 内包含 `/aicrew/_next` 资源前缀，避免线上 assets 404。

## GitHub Actions 自动发布

`main` 分支 push 会触发 `.github/workflows/deploy-aicrew.yml`：

1. `npm ci`
2. `npm test`
3. `npm run build`
4. `npm audit --omit=dev`
5. 检查 `out/index.html` 与 `/aicrew/_next` 静态资源前缀。
6. 打包 `out/` 为 `.tgz`。
7. 通过 SSH 上传到生产主机。
8. 远端备份旧目录并原子换入新目录。
9. 验证 loopback 与公网 HTTPS。
10. 验证 `https://songuu.top/` 根首页仍包含 `AICrew Studio` 入口。

必须配置 GitHub repository secret：

| Secret | 用途 |
|---|---|
| `AICREW_SSH_PRIVATE_KEY` | 可登录生产主机的部署私钥 |

可选 secret：

| Secret | 默认值 |
|---|---|
| `AICREW_DEPLOY_HOST` | `47.253.230.197` |
| `AICREW_DEPLOY_USER` | `root` |
| `AICREW_WEB_ROOT` | `/opt/aicrew/current/out` |
| `AICREW_DOMAIN` | `songuu.top` |

## 一键部署

```powershell
pwsh scripts/deploy.ps1
```

脚本流程：

1. 解析部署参数。
2. 执行 `npm test`。
3. 执行 `npm run build`。
4. 检查 `out/index.html` 的 `/aicrew/_next` base。
5. 打包 `out/` 为本地临时 `.tgz`。
6. `scp` 上传到远端 `/tmp`。
7. 远端解包 stage。
8. 备份旧目录为 `out.bak.<timestamp>`。
9. 原子换入新 `out`。
10. 远端 loopback 验证。
11. 公网 HTTPS 验证。

## Nginx 前置条件

生产主机需要包含：

```nginx
location = /aicrew {
  return 301 /aicrew/;
}

location /aicrew/ {
  alias /opt/aicrew/current/out/;
  try_files $uri $uri/ /aicrew/index.html;
}
```

## 回滚

部署成功后脚本输出：

```text
ROLLBACK_BACKUP=/opt/aicrew/current/out.bak.<timestamp>
```

回滚：

```bash
ssh root@47.253.230.197 'D=/opt/aicrew/current/out; mv "$D" "$D.bad"; mv "$D.bak.<timestamp>" "$D"; nginx -t && systemctl reload nginx'
```
