// 单例文档仓库：每个 (workspace, doc_type) 一条 jsonb。
// doc_type ∈ { brand, canvas, ai_selection }，分别替代 brand/store.js、canvas、ai/config.js 的 localStorage。

import { getSql, ensureWorkspace, DEFAULT_WORKSPACE_ID } from "../client.js";

export const DOC_TYPES = Object.freeze({
  brand: "brand",
  aiSelection: "ai_selection"
});

// 画布按 storageKey 区分多实例（主画布 / 手动导演台），doc_type = canvas:<key>。
export function canvasDocType(key) {
  return `canvas:${String(key || "default")}`;
}

// 允许：brand / ai_selection / 任意 canvas:<key>。非法类型显式拒绝（边界防御）。
function assertDocType(docType) {
  if (docType === DOC_TYPES.brand || docType === DOC_TYPES.aiSelection) return;
  if (typeof docType === "string" && docType.startsWith("canvas:")) return;
  throw new Error(`不支持的文档类型：${docType}（允许：brand, ai_selection, canvas:<key>）`);
}

/**
 * 读取单例文档 payload；不存在返回 null。
 * @param {string} docType
 * @param {string} workspaceId
 */
export async function loadDocument(docType, workspaceId = DEFAULT_WORKSPACE_ID) {
  assertDocType(docType);
  const sql = getSql();
  const [row] = await sql`
    select payload from public.aicrew_documents
    where workspace_id = ${workspaceId} and doc_type = ${docType}
  `;
  return row ? row.payload : null;
}

/**
 * upsert 单例文档 payload。
 * @param {string} docType
 * @param {unknown} payload 任意可序列化对象
 * @param {string} workspaceId
 */
export async function saveDocument(docType, payload, workspaceId = DEFAULT_WORKSPACE_ID) {
  assertDocType(docType);
  const sql = getSql();
  const value = payload && typeof payload === "object" ? payload : {};
  await sql.begin(async tx => {
    await ensureWorkspace(tx, workspaceId);
    await tx`
      insert into public.aicrew_documents (workspace_id, doc_type, payload, updated_at)
      values (${workspaceId}, ${docType}, ${tx.json(value)}, now())
      on conflict (workspace_id, doc_type) do update
        set payload = excluded.payload, updated_at = now()
    `;
  });
  return { ok: true };
}
