// 无限画布文档 API：单例文档 doc_type='canvas'。GET 读、PUT upsert。替代 CanvasStudio 的 localStorage。
import { json, DB_UNCONFIGURED_MESSAGE, INTERNAL_ERROR_MESSAGE } from "../../../lib/db/http.js";
import { isDbConfigured, resolveWorkspaceId, withDbRetry } from "../../../lib/db/client.js";
import { loadDocument, saveDocument, canvasDocType } from "../../../lib/db/repositories/documents.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 画布按 ?key=<storageKey> 区分多实例（主画布 / 导演台）；缺省回退主画布 key。
// 注意：key 仅区分同一工作区内的多个画布，不是租户标识；工作区仍由 resolveWorkspaceId 锁定。
function canvasTypeFrom(request: Request): string {
  const key = new URL(request.url).searchParams.get("key");
  return canvasDocType(key && key.trim() ? key.trim() : "aicrew-canvas-v1");
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return json({ error: DB_UNCONFIGURED_MESSAGE }, 503);
  try {
    const canvas = await withDbRetry(() => loadDocument(canvasTypeFrom(request), resolveWorkspaceId(request)));
    return json({ canvas });
  } catch {
    return json({ error: INTERNAL_ERROR_MESSAGE }, 500);
  }
}

export async function PUT(request: Request) {
  if (!isDbConfigured()) return json({ error: DB_UNCONFIGURED_MESSAGE }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求 JSON 无效" }, 400);
  }
  try {
    await withDbRetry(() => saveDocument(canvasTypeFrom(request), body?.canvas ?? body, resolveWorkspaceId(request)));
    return json({ ok: true });
  } catch {
    return json({ error: INTERNAL_ERROR_MESSAGE }, 500);
  }
}
