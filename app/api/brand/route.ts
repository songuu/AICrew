// 品牌套件 API：单例文档 doc_type='brand'。GET 读、PUT upsert。替代 lib/brand/store.js 的 localStorage。
import { json, DB_UNCONFIGURED_MESSAGE, INTERNAL_ERROR_MESSAGE } from "../../../lib/db/http.js";
import { isDbConfigured, resolveWorkspaceId, withDbRetry } from "../../../lib/db/client.js";
import { loadDocument, saveDocument, DOC_TYPES } from "../../../lib/db/repositories/documents.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isDbConfigured()) return json({ error: DB_UNCONFIGURED_MESSAGE }, 503);
  try {
    const brand = await withDbRetry(() => loadDocument(DOC_TYPES.brand, resolveWorkspaceId(request)));
    return json({ brand });
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
    await withDbRetry(() => saveDocument(DOC_TYPES.brand, body?.brand ?? body, resolveWorkspaceId(request)));
    return json({ ok: true });
  } catch {
    return json({ error: INTERNAL_ERROR_MESSAGE }, 500);
  }
}
