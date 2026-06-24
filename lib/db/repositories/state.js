// 主 state 快照仓库：把客户端单 blob（workspace / projects / tasks / exports / creditLedger / customSkills）
// 分解为 aicrew_ 首类行落库，并按 sort_order 还原数组顺序。
//
// 语义对齐现有客户端：客户端每次状态变更整体落盘 → 服务端整快照替换（replace-all，事务内）。
// 单用户、行数有限，replace-all 简单且健壮；brandKit 不入主快照（走 documents 单独存）。

import { getSql, DEFAULT_WORKSPACE_ID } from "../client.js";

// 这些集合从 workspace.payload 中剥离，分表存储；brandKit 由 documents 负责，避免双写。
const COLLECTION_KEYS = ["tasks", "projects", "exports", "creditLedger", "customSkills"];
const OMIT_FROM_PAYLOAD = new Set([...COLLECTION_KEYS, "brandKit"]);

function workspacePayload(state) {
  const rest = {};
  for (const [key, value] of Object.entries(state || {})) {
    if (!OMIT_FROM_PAYLOAD.has(key)) rest[key] = value;
  }
  return rest;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function intOr(value, fallback) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * 读取整快照。无 workspace 行 → 返回 null（调用方回退 createInitialState，等价首次空态）。
 * @param {string} workspaceId
 */
export async function loadStateSnapshot(workspaceId = DEFAULT_WORKSPACE_ID) {
  const sql = getSql();
  const [workspace] = await sql`
    select id, name, credits, payload from public.aicrew_workspaces where id = ${workspaceId}
  `;
  if (!workspace) return null;

  const [projects, tasks, exportRows, ledger, skills] = await Promise.all([
    sql`select payload from public.aicrew_projects where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_tasks where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_exports where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_credit_ledger where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_custom_skills where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`
  ]);

  const base = workspace.payload && typeof workspace.payload === "object" ? workspace.payload : {};
  return {
    ...base,
    tasks: tasks.map(row => row.payload),
    projects: projects.map(row => row.payload),
    exports: exportRows.map(row => row.payload),
    creditLedger: ledger.map(row => row.payload),
    customSkills: skills.map(row => row.payload)
  };
}

/**
 * 整快照替换写入（事务）。先 ensureWorkspace，再 upsert workspace + replace-all 各集合。
 * @param {object} state 客户端 sanitized state（imageUrl 已剥离）
 * @param {string} workspaceId
 */
export async function saveStateSnapshot(state, workspaceId = DEFAULT_WORKSPACE_ID) {
  const sql = getSql();
  const payload = workspacePayload(state);
  const credits = intOr(state?.workspace?.credits, 0);
  const name = stringOr(state?.workspace?.name, "AICrew Workspace");

  await sql.begin(async tx => {
    await tx`
      insert into public.aicrew_workspaces (id, name, credits, payload, updated_at)
      values (${workspaceId}, ${name}, ${credits}, ${tx.json(payload)}, now())
      on conflict (id) do update
        set name = excluded.name, credits = excluded.credits, payload = excluded.payload, updated_at = now()
    `;

    await tx`delete from public.aicrew_projects where workspace_id = ${workspaceId}`;
    const projects = asArray(state?.projects);
    for (let index = 0; index < projects.length; index += 1) {
      const item = projects[index] || {};
      await tx`
        insert into public.aicrew_projects (id, workspace_id, name, sort_order, payload)
        values (${stringOr(item.id, `project-${index}`)}, ${workspaceId}, ${stringOr(item.name, "")}, ${index}, ${tx.json(item)})
      `;
    }

    await tx`delete from public.aicrew_tasks where workspace_id = ${workspaceId}`;
    const tasks = asArray(state?.tasks);
    for (let index = 0; index < tasks.length; index += 1) {
      const item = tasks[index] || {};
      const title = stringOr(item.title, stringOr(item.brief?.title, ""));
      const projectId = typeof item.projectId === "string" ? item.projectId : null;
      await tx`
        insert into public.aicrew_tasks (id, workspace_id, project_id, title, sort_order, payload)
        values (${stringOr(item.id, `task-${index}`)}, ${workspaceId}, ${projectId}, ${title}, ${index}, ${tx.json(item)})
      `;
    }

    await tx`delete from public.aicrew_exports where workspace_id = ${workspaceId}`;
    const exportItems = asArray(state?.exports);
    for (let index = 0; index < exportItems.length; index += 1) {
      const item = exportItems[index] || {};
      const projectId = typeof item.projectId === "string" ? item.projectId : null;
      await tx`
        insert into public.aicrew_exports (id, workspace_id, project_id, project_name, sort_order, payload)
        values (${stringOr(item.id, `export-${index}`)}, ${workspaceId}, ${projectId}, ${stringOr(item.projectName, "")}, ${index}, ${tx.json(item)})
      `;
    }

    await tx`delete from public.aicrew_credit_ledger where workspace_id = ${workspaceId}`;
    const ledger = asArray(state?.creditLedger);
    for (let index = 0; index < ledger.length; index += 1) {
      const item = ledger[index] || {};
      await tx`
        insert into public.aicrew_credit_ledger (id, workspace_id, type, amount, label, sort_order, payload)
        values (${stringOr(item.id, `credit-${index}`)}, ${workspaceId}, ${stringOr(item.type, "")}, ${intOr(item.amount, 0)}, ${stringOr(item.label, "")}, ${index}, ${tx.json(item)})
      `;
    }

    await tx`delete from public.aicrew_custom_skills where workspace_id = ${workspaceId}`;
    const skills = asArray(state?.customSkills);
    for (let index = 0; index < skills.length; index += 1) {
      const item = skills[index] || {};
      await tx`
        insert into public.aicrew_custom_skills (id, workspace_id, name, sort_order, payload)
        values (${stringOr(item.id, `skill-${index}`)}, ${workspaceId}, ${stringOr(item.name, "")}, ${index}, ${tx.json(item)})
      `;
    }
  });

  return { ok: true };
}
