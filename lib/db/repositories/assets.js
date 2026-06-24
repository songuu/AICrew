// 图像资产仓库：替代客户端独立 imageStore（变体封面 / 画布图元）。
// 形状与 imageStore 保持一致：{ items: [{ id, url, kind, bytes }] }，便于客户端无缝切换。
// ref_key = imageStore 的 id（命名空间 variant:<id> / canvas:<id>）。
// 写入语义：整存替换（imageStore 本就是 load→改→prune→save 全量回写）。

import { getSql, ensureWorkspace, DEFAULT_WORKSPACE_ID } from "../client.js";

function kindOf(url) {
  return typeof url === "string" && url.startsWith("data:") ? "data" : "remote";
}

/**
 * 读取工作区全部资产，返回 imageStore 兼容形状。
 * @param {string} workspaceId
 */
export async function loadAssets(workspaceId = DEFAULT_WORKSPACE_ID) {
  const sql = getSql();
  const rows = await sql`
    select ref_key, url, kind, bytes
    from public.aicrew_assets
    where workspace_id = ${workspaceId}
    order by sort_order asc, created_at asc
  `;
  return {
    items: rows.map(row => ({
      id: row.ref_key,
      url: row.url,
      kind: row.kind,
      bytes: Number.isFinite(row.bytes) ? row.bytes : 0
    }))
  };
}

/**
 * 整存替换工作区资产。入参为 imageStore 形状 { items: [{ id, url, kind?, bytes? }] }。
 * 边界防御：丢弃缺 id/url 的脏项、去重（后者覆盖前者，对齐 imageStore putRecord 语义）。
 * @param {{ items?: Array<{id?:string,url?:string,kind?:string,bytes?:number}> }} store
 * @param {string} workspaceId
 */
export async function saveAssets(store, workspaceId = DEFAULT_WORKSPACE_ID) {
  const sql = getSql();
  const items = Array.isArray(store?.items) ? store.items : [];
  const byId = new Map();
  for (const item of items) {
    const id = item && typeof item.id === "string" ? item.id : null;
    const url = item && typeof item.url === "string" ? item.url : null;
    if (!id || !url) continue;
    byId.set(id, {
      url,
      kind: item.kind === "data" || item.kind === "remote" ? item.kind : kindOf(url),
      bytes: Number.isFinite(item.bytes) ? Math.trunc(item.bytes) : url.length
    });
  }

  await sql.begin(async tx => {
    await ensureWorkspace(tx, workspaceId);
    await tx`delete from public.aicrew_assets where workspace_id = ${workspaceId}`;
    let index = 0;
    for (const [refKey, value] of byId) {
      await tx`
        insert into public.aicrew_assets (workspace_id, ref_key, url, kind, bytes, sort_order, updated_at)
        values (${workspaceId}, ${refKey}, ${value.url}, ${value.kind}, ${value.bytes}, ${index}, now())
      `;
      index += 1;
    }
  });

  return { ok: true, count: byId.size };
}
