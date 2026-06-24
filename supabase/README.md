# AICrew Studio · Supabase 持久化

AICrew 全部用户数据落自托管 Supabase Postgres（火山 AIDAP，与 agent-build 共用同实例），
经 `app/api/*` 服务端路由直连 `SUPABASE_DB_URL` 读写。客户端永不接触连接串/service-role。

> **共享实例约束**：该 Postgres 实例被多个项目共用，因此 AICrew 所有表统一 `aicrew_` 前缀，
> 迁移幂等（`create ... if not exists`），**绝不 drop/alter 他人表**。

## 表结构

| 表 | 用途 | 替代的 localStorage key |
|----|------|------------------------|
| `aicrew_workspaces` | 工作区级状态（credits + payload 兜底），当前单例 `default` | — |
| `aicrew_projects` | 项目（首类行 + payload） | 主 blob 子集 |
| `aicrew_tasks` | 创作任务（变体嵌于 payload） | 主 blob 子集 |
| `aicrew_exports` | 导出记录 | 主 blob 子集 |
| `aicrew_credit_ledger` | 积分流水 | 主 blob 子集 |
| `aicrew_custom_skills` | 自定义技能 | 主 blob 子集 |
| `aicrew_assets` | 图像（变体封面/画布图元），ref_key=`variant:`/`canvas:` | `aicrew-variant-images-v1` |
| `aicrew_documents` | 单例文档：`brand` / `ai_selection` / `canvas:<key>` | `aicrew-brand-v1` / `aicrew-ai-selection-v1` / `aicrew-canvas-*` |

顶层集合用「首类提升列（id/name/外键/sort_order）+ `payload jsonb` 兜底」模式，对齐 agent-build：
可查询字段提升为列，其余字段进 payload，抗客户端 state 形状漂移。

## 应用迁移

```bash
# 本地（读 .env 中的 SUPABASE_DB_URL）
npm run db:migrate

# 集成测试（真实库往返断言）
npm run test:db
```

`scripts/db-migrate.mjs` 直连 `SUPABASE_DB_URL` 按文件名升序应用 `migrations/*.sql`（PostgREST 不能建表）。

## 环境变量

`.env`（本地）/ `AICREW_PRODUCTION_ENV` GH secret（生产）需包含：

```
SUPABASE_DB_URL=postgresql://<user>:<pwd>@<host>:5432/<db>   # 直连，含库密码；server-only
# 以下供未来前端直连/PostgREST，可选：
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SCHEMA=public
```

> **部署须知**：生产经 `.github/workflows/deploy-aicrew.yml` 把 `AICREW_PRODUCTION_ENV` secret 写入 `.env`。
> 接入 Supabase 后，**必须把 `SUPABASE_DB_URL` 追加进该 secret**，否则生产环境 `/api/*` 持久化路由返回 503。

## 数据流

```
浏览器组件 ──fetch──▶ /aicrew/api/{state,assets,brand,canvas,ai-selection}
                          │ (runtime=nodejs, dynamic)
                          ▼
                   lib/db/repositories/*  ──postgres(ssl=require)──▶ Supabase Postgres
```

Supabase 为权威源；localStorage 降级为离线缓存兜底（断网仍可恢复，恢复联网后下次变更自动回写）。
