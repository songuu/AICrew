-- P0-B：把 task 执行状态提升为可查询列（payload 仍是真相，列供查询 / 启动调和）。
-- 幂等：add column if not exists；迁移前的旧 task 都是已完成态，故默认 'completed'。
-- 仅 alter 本项目 aicrew_ 表，绝不动共享实例中他人的表。
-- 应用方式：node --env-file=.env scripts/db-migrate.mjs（或 npm run db:migrate）。

alter table public.aicrew_tasks
  add column if not exists status text not null default 'completed';

create index if not exists aicrew_tasks_status_idx on public.aicrew_tasks(workspace_id, status);
