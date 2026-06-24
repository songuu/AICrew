-- AICrew Studio 持久化核心表。
--
-- 共享实例约束：SUPABASE_DB_URL 指向自托管 Supabase(火山 AIDAP)，与 agent-build 等项目共用同一库。
-- 因此 AICrew 全部表必须 aicrew_ 前缀，与其它项目表（news_items / dm_* / task_management ...）隔离，
-- 且本迁移幂等（create ... if not exists / add column if not exists），绝不 drop/alter 他人表。
--
-- 设计依据（对齐 agent-build 实践 + 现有客户端 localStorage 分治）：
--   顶层集合（workspace / projects / tasks / exports / credit_ledger / custom_skills）落首类行，
--   每行除可查询的提升列（id/name/created_at/外键）外保留 payload jsonb 兜底字段漂移；
--   图像（assets）替代独立 imageStore；单例文档（brand / canvas / ai_selection）落 aicrew_documents。
--
-- 应用方式：node --env-file=.env scripts/db-migrate.mjs（直连 SUPABASE_DB_URL，PostgREST 不能建表）。

create extension if not exists pgcrypto;

-- 工作区：当前无鉴权，单例 'default'；保留多工作区扩展位（未来接账号体系）。
create table if not exists public.aicrew_workspaces (
  id text primary key,
  name text not null default 'AICrew Workspace',
  credits integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aicrew_projects (
  id text not null,
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  name text not null default '',
  sort_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 复合主键：id 仅在 workspace 内唯一，与 aicrew_assets/aicrew_documents 隔离模型一致；
  -- 避免跨 workspace 同名 id（含 makeId/兜底 index id）撞键致整替换事务回滚、静默丢存。
  primary key (workspace_id, id)
);
create index if not exists aicrew_projects_workspace_idx on public.aicrew_projects(workspace_id, sort_order);

create table if not exists public.aicrew_tasks (
  id text not null,
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  project_id text,
  title text not null default '',
  sort_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists aicrew_tasks_workspace_idx on public.aicrew_tasks(workspace_id, sort_order);

create table if not exists public.aicrew_exports (
  id text not null,
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  project_id text,
  project_name text not null default '',
  sort_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists aicrew_exports_workspace_idx on public.aicrew_exports(workspace_id, sort_order);

create table if not exists public.aicrew_credit_ledger (
  id text not null,
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  type text not null default '',
  amount integer not null default 0,
  label text not null default '',
  sort_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists aicrew_credit_ledger_workspace_idx on public.aicrew_credit_ledger(workspace_id, sort_order);

create table if not exists public.aicrew_custom_skills (
  id text not null,
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  name text not null default '',
  sort_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists aicrew_custom_skills_workspace_idx on public.aicrew_custom_skills(workspace_id, sort_order);

-- 图像存储：替代独立 imageStore（变体封面 / 画布图元）。ref_key 命名空间：variant:<id> / canvas:<id>。
-- data 类（base64）可能很大 → url 用 text；remote(https) 引用体积小。配额修剪逻辑保留在客户端纯函数。
create table if not exists public.aicrew_assets (
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  ref_key text not null,
  url text not null,
  kind text not null default 'remote' check (kind in ('data', 'remote')),
  bytes integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, ref_key)
);

-- 单例文档：每个 (workspace, doc_type) 一条。doc_type ∈ {brand, canvas, ai_selection}。
create table if not exists public.aicrew_documents (
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  doc_type text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, doc_type)
);
