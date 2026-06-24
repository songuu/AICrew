// 图像资产 API：GET 读整 store、PUT 整替换。形状对齐 imageStore { items: [{ id, url, kind, bytes }] }。
import { json, DB_UNCONFIGURED_MESSAGE, INTERNAL_ERROR_MESSAGE } from "../../../lib/db/http.js";
import { isDbConfigured, resolveWorkspaceId, withDbRetry } from "../../../lib/db/client.js";
import { loadAssets, saveAssets } from "../../../lib/db/repositories/assets.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isDbConfigured()) return json({ error: DB_UNCONFIGURED_MESSAGE }, 503);
  try {
    const store = await withDbRetry(() => loadAssets(resolveWorkspaceId(request)));
    return json({ store });
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
  const store = body?.store ?? body;
  try {
    const result = await withDbRetry(() => saveAssets(store, resolveWorkspaceId(request)));
    return json(result);
  } catch {
    return json({ error: INTERNAL_ERROR_MESSAGE }, 500);
  }
}
