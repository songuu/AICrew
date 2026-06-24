// 主 state 快照 API：GET 读整快照、PUT 整替换写入。客户端经此读写，绝不接触 SUPABASE_DB_URL。
import { json, DB_UNCONFIGURED_MESSAGE, INTERNAL_ERROR_MESSAGE } from "../../../lib/db/http.js";
import { isDbConfigured, resolveWorkspaceId } from "../../../lib/db/client.js";
import { loadStateSnapshot, saveStateSnapshot } from "../../../lib/db/repositories/state.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isDbConfigured()) return json({ error: DB_UNCONFIGURED_MESSAGE }, 503);
  try {
    const snapshot = await loadStateSnapshot(resolveWorkspaceId(request));
    return json({ snapshot });
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
  const snapshot = body?.snapshot ?? body;
  if (!snapshot || typeof snapshot !== "object") {
    return json({ error: "缺少 snapshot 对象" }, 400);
  }
  try {
    await saveStateSnapshot(snapshot, resolveWorkspaceId(request));
    return json({ ok: true });
  } catch {
    return json({ error: INTERNAL_ERROR_MESSAGE }, 500);
  }
}
