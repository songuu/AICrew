// 主 state 快照仓库：把客户端单 blob（workspace / projects / tasks / exports / creditLedger / customSkills）
// 分解为 aicrew_ 首类行落库，并按 sort_order 还原数组顺序。
//
// 语义对齐现有客户端：客户端每次状态变更整体落盘 → 服务端整快照替换（replace-all，事务内）。
// 单用户、行数有限，replace-all 简单且健壮；brandKit 不入主快照（走 documents 单独存）。

import { getSql, DEFAULT_WORKSPACE_ID } from "../client.js";

// 这些集合从 workspace.payload 中剥离，分表存储；brandKit 由 documents 负责，避免双写。
const COLLECTION_KEYS = ["tasks", "projects", "exports", "creditLedger", "customSkills"];
const SERVER_DEFAULT_CREDITS = 5000;
const SERVER_OWNED_STATE_KEYS = new Set(["creditLedger", "creditReservations", "creditReservationLedger"]);
const SERVER_OWNED_WORKSPACE_FIELDS = new Set(["credits", "reservedCredits", "creditOpeningBalance"]);
const OMIT_FROM_PAYLOAD = new Set([...COLLECTION_KEYS, ...SERVER_OWNED_STATE_KEYS, "brandKit"]);

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

function objectOr(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function workspaceWithoutClientCredits(workspace) {
  const next = {};
  for (const [key, value] of Object.entries(objectOr(workspace))) {
    if (!SERVER_OWNED_WORKSPACE_FIELDS.has(key)) next[key] = value;
  }
  return next;
}

export function sanitizeClientStateForSave(state, serverState = {}) {
  const source = objectOr(state);
  const serverWorkspace = objectOr(serverState.workspace);
  const serverCredits = intOr(serverWorkspace.credits, SERVER_DEFAULT_CREDITS);
  const serverReservedCredits = intOr(serverWorkspace.reservedCredits, 0);
  const serverOpeningBalance = intOr(serverWorkspace.creditOpeningBalance, serverCredits + serverReservedCredits);
  const next = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SERVER_OWNED_STATE_KEYS.has(key)) next[key] = value;
  }
  return {
    ...next,
    workspace: {
      ...workspaceWithoutClientCredits(source.workspace),
      credits: serverCredits,
      reservedCredits: serverReservedCredits,
      creditOpeningBalance: serverOpeningBalance
    },
    creditLedger: asArray(serverState.creditLedger),
    creditReservations: asArray(serverState.creditReservations),
    creditReservationLedger: asArray(serverState.creditReservationLedger)
  };
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
  const workspacePayloadValue = objectOr(base.workspace);
  return {
    ...base,
    workspace: {
      ...workspacePayloadValue,
      credits: intOr(workspace.credits, SERVER_DEFAULT_CREDITS),
      reservedCredits: 0,
      creditOpeningBalance: intOr(workspacePayloadValue.creditOpeningBalance, intOr(workspace.credits, SERVER_DEFAULT_CREDITS))
    },
    tasks: tasks.map(row => row.payload),
    projects: projects.map(row => row.payload),
    exports: exportRows.map(row => row.payload),
    creditLedger: ledger.map(row => row.payload),
    creditReservations: [],
    creditReservationLedger: [],
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
  const name = stringOr(state?.workspace?.name, "AICrew Workspace");

  await sql.begin(async tx => {
    const [existingWorkspace] = await tx`
      select credits, payload from public.aicrew_workspaces where id = ${workspaceId} for update
    `;
    const existingPayload = objectOr(existingWorkspace?.payload);
    const sanitizedState = sanitizeClientStateForSave(state, {
      ...existingPayload,
      workspace: {
        ...objectOr(existingPayload.workspace),
        credits: existingWorkspace ? intOr(existingWorkspace.credits, SERVER_DEFAULT_CREDITS) : SERVER_DEFAULT_CREDITS,
        reservedCredits: 0
      },
      creditLedger: [],
      creditReservations: [],
      creditReservationLedger: []
    });
    const payload = workspacePayload(sanitizedState);
    const credits = intOr(sanitizedState?.workspace?.credits, SERVER_DEFAULT_CREDITS);

    await tx`
      insert into public.aicrew_workspaces (id, name, credits, payload, updated_at)
      values (${workspaceId}, ${name}, ${credits}, ${tx.json(payload)}, now())
      on conflict (id) do update
        set name = excluded.name, credits = excluded.credits, payload = excluded.payload, updated_at = now()
    `;

    await tx`delete from public.aicrew_projects where workspace_id = ${workspaceId}`;
    const projects = asArray(sanitizedState?.projects);
    for (let index = 0; index < projects.length; index += 1) {
      const item = projects[index] || {};
      await tx`
        insert into public.aicrew_projects (id, workspace_id, name, sort_order, payload)
        values (${stringOr(item.id, `project-${index}`)}, ${workspaceId}, ${stringOr(item.name, "")}, ${index}, ${tx.json(item)})
      `;
    }

    await tx`delete from public.aicrew_tasks where workspace_id = ${workspaceId}`;
    const tasks = asArray(sanitizedState?.tasks);
    for (let index = 0; index < tasks.length; index += 1) {
      const item = tasks[index] || {};
      const title = stringOr(item.title, stringOr(item.brief?.title, ""));
      const projectId = typeof item.projectId === "string" ? item.projectId : null;
      // status 列与 payload.status 同步（payload 仍是真相，列供查询/启动调和）；旧/缺省态回退 completed。
      const status = stringOr(item.status, "completed");
      await tx`
        insert into public.aicrew_tasks (id, workspace_id, project_id, title, status, sort_order, payload)
        values (${stringOr(item.id, `task-${index}`)}, ${workspaceId}, ${projectId}, ${title}, ${status}, ${index}, ${tx.json(item)})
      `;
    }

    await tx`delete from public.aicrew_exports where workspace_id = ${workspaceId}`;
    const exportItems = asArray(sanitizedState?.exports);
    for (let index = 0; index < exportItems.length; index += 1) {
      const item = exportItems[index] || {};
      const projectId = typeof item.projectId === "string" ? item.projectId : null;
      await tx`
        insert into public.aicrew_exports (id, workspace_id, project_id, project_name, sort_order, payload)
        values (${stringOr(item.id, `export-${index}`)}, ${workspaceId}, ${projectId}, ${stringOr(item.projectName, "")}, ${index}, ${tx.json(item)})
      `;
    }

    await tx`delete from public.aicrew_custom_skills where workspace_id = ${workspaceId}`;
    const skills = asArray(sanitizedState?.customSkills);
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
