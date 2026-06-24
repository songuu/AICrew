// 临时诊断端点：确认 prod→Supabase Postgres 可达性。仅返回连接级错误码/host（不含表名/列名等 schema）。
// 诊断完成后删除。用于区分 IP 白名单(ETIMEDOUT) / URL 写错(ENOTFOUND/ECONNREFUSED) / 认证(28P01)。
import { json } from "../../../lib/db/http.js";
import { isDbConfigured, getSql } from "../../../lib/db/client.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!isDbConfigured()) return json({ ok: false, configured: false });
  let host = "";
  try {
    host = new URL(process.env.SUPABASE_DB_URL as string).host;
  } catch {
    host = "(unparsable SUPABASE_DB_URL)";
  }
  try {
    const sql = getSql();
    const rows = await sql`select 1 as ok`;
    return json({ ok: true, configured: true, host, select: rows[0].ok });
  } catch (error) {
    const e = error as { code?: string; name?: string; message?: string };
    return json({
      ok: false,
      configured: true,
      host,
      code: e?.code || "",
      name: e?.name || "",
      message: String(e?.message || "").slice(0, 140)
    });
  }
}
