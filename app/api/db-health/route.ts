// 临时诊断端点：探明 prod 能走通哪条 Supabase 链路（5432 直连 vs 443 PostgREST），定最终方案后删除。
// 仅返回连接级状态/错误码与 env 是否存在（布尔），绝不回显密码/key/表名等敏感信息。
import { json } from "../../../lib/db/http.js";
import { isDbConfigured, getSql } from "../../../lib/db/client.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("probe-timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// 探 5432 直连 Postgres。
async function probePostgres() {
  if (!isDbConfigured()) return { reachable: false, reason: "no SUPABASE_DB_URL" };
  try {
    const sql = getSql();
    const rows = await withTimeout(sql`select 1 as ok`, 8000);
    return { reachable: true, select: rows[0].ok };
  } catch (error) {
    const e = error;
    return { reachable: false, code: e?.code || "", name: e?.name || "", reason: String(e?.message || "").slice(0, 80) };
  }
}

// 探 443 PostgREST（Supabase REST 网关）。
async function probePostgREST() {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base) return { configured: false, reason: "no SUPABASE_URL" };
  try {
    const response = await withTimeout(
      fetch(`${base}/rest/v1/`, { headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : {} }),
      8000
    );
    return { configured: true, reachable: true, status: response.status, host: new URL(base).host };
  } catch (error) {
    const e = error;
    return { configured: true, reachable: false, code: e?.code || e?.cause?.code || "", reason: String(e?.message || "").slice(0, 80) };
  }
}

// 探出口 IP（顺带验证 prod 一般性出站 443 是否通）。
async function probeEgressIp() {
  try {
    const response = await withTimeout(fetch("https://api.ipify.org?format=json"), 6000);
    const data = await response.json();
    return { ok: true, ip: data?.ip || "" };
  } catch (error) {
    return { ok: false, reason: String(error?.message || "").slice(0, 60) };
  }
}

export async function GET() {
  const [postgres, postgrest, egress] = await Promise.all([probePostgres(), probePostgREST(), probeEgressIp()]);
  return json({
    env: {
      SUPABASE_DB_URL: Boolean(process.env.SUPABASE_DB_URL),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
    },
    postgres,
    postgrest,
    egress
  });
}
