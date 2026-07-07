-- AICrew 小红书交接事件表。
--
-- 幂等、aicrew_ 前缀、无 destructive 变更。记录「复制/分享/个人入口发布」等人工发布交接动作，
-- payload 保存轻量上下文（文案、标签、文件名、task/export/variant id），不保存图片 dataUrl/Blob。

create table if not exists public.aicrew_rednote_handoffs (
  id text not null,
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  task_id text,
  export_id text,
  variant_id text,
  action text not null default '',
  status text not null default '',
  sort_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists aicrew_rednote_handoffs_workspace_idx
  on public.aicrew_rednote_handoffs(workspace_id, sort_order, created_at desc);

create index if not exists aicrew_rednote_handoffs_task_idx
  on public.aicrew_rednote_handoffs(workspace_id, task_id, created_at desc);

create index if not exists aicrew_rednote_handoffs_status_idx
  on public.aicrew_rednote_handoffs(workspace_id, status, created_at desc);
