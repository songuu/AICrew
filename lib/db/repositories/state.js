// 主 state 快照仓库：把客户端单 blob（workspace / projects / tasks / exports / customSkills）
// 分解为 aicrew_ 首类行落库，并按 sort_order 还原数组顺序。
//
// 积分字段是 server-owned：GET 时从 creditSystemWallet 合成展示缓存；PUT 时客户端余额/账本被丢弃。

import { getSql, DEFAULT_WORKSPACE_ID } from "../client.js";
import {
  buildCreditWalletOverview,
  createCreditSystemWallet,
  createSeededCreditSystemWallet,
  ensureCreditSystemDefaultGrant,
  transactionsForDisplay
} from "../../credit-system.js";

export const STATE_COLLECTION_KEYS = Object.freeze(["tasks", "projects", "exports", "creditLedger", "customSkills", "rednoteHandoffs"]);
const COLLECTION_KEYS = STATE_COLLECTION_KEYS;
const PAYLOAD_OMIT_COLLECTION_KEYS = COLLECTION_KEYS.filter(key => key !== "rednoteHandoffs");
const SERVER_DEFAULT_CREDITS = 10000;
const SERVER_OWNED_STATE_KEYS = new Set(["creditLedger", "creditReservations", "creditReservationLedger", "creditWallet", "creditCatalog"]);
const SERVER_OWNED_WORKSPACE_FIELDS = new Set(["credits", "reservedCredits", "creditOpeningBalance"]);
const OMIT_FROM_PAYLOAD = new Set([...PAYLOAD_OMIT_COLLECTION_KEYS, ...SERVER_OWNED_STATE_KEYS, "brandKit", "creditSystemWallet"]);
const CREDIT_WALLET_PAYLOAD_KEY = "creditSystemWallet";

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
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
}

function objectOr(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function isMissingRednoteHandoffsTable(error) {
  return error?.code === "42P01" || /aicrew_rednote_handoffs/i.test(String(error?.message || ""));
}

async function loadRednoteHandoffRows(sql, workspaceId) {
  try {
    return await sql`select payload from public.aicrew_rednote_handoffs where workspace_id = ${workspaceId} order by sort_order asc, created_at desc`;
  } catch (error) {
    if (isMissingRednoteHandoffsTable(error)) return null;
    throw error;
  }
}

async function replaceRednoteHandoffs(tx, workspaceId, handoffs) {
  try {
    await tx`delete from public.aicrew_rednote_handoffs where workspace_id = ${workspaceId}`;
    for (let index = 0; index < handoffs.length; index += 1) {
      const item = handoffs[index] || {};
      await tx`
        insert into public.aicrew_rednote_handoffs (id, workspace_id, task_id, export_id, variant_id, action, status, sort_order, payload)
        values (
          ${stringOr(item.id, `rednote-handoff-${index}`)},
          ${workspaceId},
          ${typeof item.taskId === "string" ? item.taskId : null},
          ${typeof item.exportId === "string" ? item.exportId : null},
          ${typeof item.variantId === "string" ? item.variantId : null},
          ${stringOr(item.action, "")},
          ${stringOr(item.status, "")},
          ${index},
          ${tx.json(item)}
        )
      `;
    }
  } catch (error) {
    if (isMissingRednoteHandoffsTable(error)) return;
    throw error;
  }
}

function workspaceWithoutClientCredits(workspace) {
  const next = {};
  for (const [key, value] of Object.entries(objectOr(workspace))) {
    if (!SERVER_OWNED_WORKSPACE_FIELDS.has(key)) next[key] = value;
  }
  return next;
}

function walletOpeningBalance(wallet) {
  return wallet.availableCredits + wallet.reservedCredits + wallet.lifetimeConsumed;
}

function creditWalletFromPayload(workspaceId, workspaceRow = {}, payload = {}) {
  const stored = objectOr(payload[CREDIT_WALLET_PAYLOAD_KEY], null);
  const wallet = stored
    ? createCreditSystemWallet(stored)
    : createSeededCreditSystemWallet({
        id: `wallet_${workspaceId}`,
        workspaceId,
        initialCredits: intOr(workspaceRow.credits, SERVER_DEFAULT_CREDITS),
        label: "Server wallet seed",
        idempotencyKey: `grant:${workspaceId}:server-seed`
      });
  const migratedWallet = wallet.buckets.length === 0 && wallet.availableCredits > 0
    ? createSeededCreditSystemWallet({
        ...wallet,
        initialCredits: wallet.availableCredits,
        label: "Server wallet scalar migration",
        idempotencyKey: `grant:${workspaceId}:scalar-migration`
      })
    : wallet;
  return ensureCreditSystemDefaultGrant(migratedWallet, {
    targetCredits: SERVER_DEFAULT_CREDITS,
    label: "Testing default credits",
    idempotencyKey: `grant:${workspaceId}:testing-default:${SERVER_DEFAULT_CREDITS}`
  });
}

function stateCreditPayload(wallet) {
  const overview = buildCreditWalletOverview(wallet);
  return {
    workspaceCredits: wallet.availableCredits,
    workspaceReservedCredits: wallet.reservedCredits,
    workspaceOpeningBalance: walletOpeningBalance(wallet),
    creditLedger: transactionsForDisplay(wallet),
    creditReservations: wallet.reservations,
    creditReservationLedger: wallet.transactions,
    creditWallet: overview,
    creditCatalog: overview.catalog
  };
}

export function sanitizeClientStateForSave(state, serverState = {}) {
  const source = objectOr(state);
  const serverWorkspace = objectOr(serverState.workspace);
  const serverCreditWallet = objectOr(serverState.creditWallet, null);
  const serverCredits = intOr(serverWorkspace.credits, intOr(serverCreditWallet?.availableCredits, SERVER_DEFAULT_CREDITS));
  const serverReservedCredits = intOr(serverWorkspace.reservedCredits, intOr(serverCreditWallet?.reservedCredits, 0));
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
    creditReservationLedger: asArray(serverState.creditReservationLedger),
    creditWallet: serverState.creditWallet ?? null,
    creditCatalog: serverState.creditCatalog ?? null
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

  const [projects, tasks, exportRows, legacyLedger, skills] = await Promise.all([
    sql`select payload from public.aicrew_projects where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_tasks where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_exports where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_credit_ledger where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`,
    sql`select payload from public.aicrew_custom_skills where workspace_id = ${workspaceId} order by sort_order asc, created_at asc`
  ]);

  const base = workspace.payload && typeof workspace.payload === "object" ? workspace.payload : {};
  const { creditSystemWallet: _serverCreditSystemWallet, ...clientBase } = base;
  const rednoteRows = await loadRednoteHandoffRows(sql, workspaceId);
  const rednoteHandoffs = rednoteRows?.length ? rednoteRows.map(row => row.payload) : asArray(clientBase.rednoteHandoffs);
  const workspacePayloadValue = objectOr(base.workspace);
  const wallet = creditWalletFromPayload(workspaceId, workspace, base);
  const credit = stateCreditPayload(wallet);
  const displayLedger = credit.creditLedger.length > 0 ? credit.creditLedger : legacyLedger.map(row => row.payload);

  return {
    ...clientBase,
    workspace: {
      ...workspacePayloadValue,
      credits: credit.workspaceCredits,
      reservedCredits: credit.workspaceReservedCredits,
      creditOpeningBalance: credit.workspaceOpeningBalance
    },
    tasks: tasks.map(row => row.payload),
    projects: projects.map(row => row.payload),
    exports: exportRows.map(row => row.payload),
    creditLedger: displayLedger,
    creditReservations: credit.creditReservations,
    creditReservationLedger: credit.creditReservationLedger,
    creditWallet: credit.creditWallet,
    creditCatalog: credit.creditCatalog,
    customSkills: skills.map(row => row.payload),
    rednoteHandoffs
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
    const serverWallet = creditWalletFromPayload(workspaceId, existingWorkspace, existingPayload);
    const credit = stateCreditPayload(serverWallet);
    const sanitizedState = sanitizeClientStateForSave(state, {
      ...existingPayload,
      workspace: {
        ...objectOr(existingPayload.workspace),
        credits: credit.workspaceCredits,
        reservedCredits: credit.workspaceReservedCredits,
        creditOpeningBalance: credit.workspaceOpeningBalance
      },
      creditLedger: credit.creditLedger,
      creditReservations: credit.creditReservations,
      creditReservationLedger: credit.creditReservationLedger,
      creditWallet: credit.creditWallet,
      creditCatalog: credit.creditCatalog
    });
    const payload = {
      ...workspacePayload(sanitizedState),
      [CREDIT_WALLET_PAYLOAD_KEY]: serverWallet
    };

    await tx`
      insert into public.aicrew_workspaces (id, name, credits, payload, updated_at)
      values (${workspaceId}, ${name}, ${serverWallet.availableCredits}, ${tx.json(payload)}, now())
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

    await replaceRednoteHandoffs(tx, workspaceId, asArray(sanitizedState?.rednoteHandoffs));
  });

  return { ok: true };
}
