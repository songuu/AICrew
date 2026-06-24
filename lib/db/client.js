// 服务端独占的 Supabase Postgres 连接（直连 SUPABASE_DB_URL）。
//
// 安全纪律：本模块及 lib/db/* 只允许被 app/api/* 路由处理器 import，绝不进客户端 bundle
// （SUPABASE_DB_URL 含库密码）。客户端一律走 API 路由，不接触连接串。
//
// 自托管 Supabase(火山 AIDAP) 需 ssl=require（已实测）；连接复用单例池，避免每请求新建连接。

import postgres from "postgres";

let cachedSql = null;

export function isDbConfigured(env = process.env) {
  return typeof env?.SUPABASE_DB_URL === "string" && env.SUPABASE_DB_URL.trim().length > 0;
}

/**
 * 返回进程级单例 sql 客户端。未配置 SUPABASE_DB_URL 时抛出带上下文的明确错误，
 * 由调用方（API 路由）转成 503，绝不静默吞。
 * @returns {import("postgres").Sql}
 */
export function getSql() {
  if (cachedSql) return cachedSql;
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !url.trim()) {
    throw new Error(
      "SUPABASE_DB_URL 未配置：无法连接 Supabase Postgres。请在本地 .env 或生产 AICREW_PRODUCTION_ENV 中提供连接串。"
    );
  }
  // 连接池 max 默认 1：自托管火山 Postgres(共享实例)对并发新建连接限流，prod 实测
  // 「单连接可达、并发开多连接 ETIMEDOUT」。max=1 让 loadStateSnapshot 的 Promise.all 在单连接上排队复用，
  // 消除并发建连超时。单工作区低并发场景，串行化代价可忽略。可经 SUPABASE_DB_POOL_MAX 覆盖。
  //
  // idle_timeout:0 保活单连接：建连对火山 DB 是抖动点（冷启动易 ETIMEDOUT），保持 warm 让冷连只发生一次；
  // max_lifetime 定期回收防陈旧；冷连/陈旧失败由 withDbRetry 兜底重试。
  cachedSql = postgres(url, {
    ssl: "require",
    max: Number(process.env.SUPABASE_DB_POOL_MAX || 1),
    idle_timeout: 0,
    max_lifetime: 60 * 30,
    connect_timeout: 15
  });
  return cachedSql;
}

const TRANSIENT_DB_CODES = new Set([
  "CONNECT_TIMEOUT", // postgres.js 建连超时（冷启动主因）
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "CONNECTION_ENDED",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "EAI_AGAIN"
]);

function isTransientDbError(error) {
  const code = error?.code || error?.errno || error?.cause?.code;
  if (code && TRANSIENT_DB_CODES.has(code)) return true;
  // postgres.js 建连失败（含并发/多地址）抛 AggregateError，按瞬时处理重试。
  return error?.name === "AggregateError";
}

/**
 * 瞬时连接错误重试包装（冷启动建连抖动 / 陈旧连接）。非连接类错误（SQL 语义错等）立即抛出不重试。
 * 不主动 closeSql（会 end 调用方捕获的 sql 引用致 CONNECTION_ENDED）；postgres.js 会在重试查询时自动重连。
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} attempts
 * @returns {Promise<T>}
 */
export async function withDbRetry(fn, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

// 优雅关闭：结束连接池并清空单例缓存，使下次 getSql() 重建新池。
// 主要用于测试隔离（多测试各自 end 后需新连接）与进程退出钩子；生产运行时为长生命周期单例，通常不调用。
export async function closeSql() {
  if (!cachedSql) return;
  const sql = cachedSql;
  cachedSql = null;
  await sql.end({ timeout: 5 });
}

export const DEFAULT_WORKSPACE_ID = "default";

// 工作区解析（安全边界）：当前无鉴权 → 锁定单工作区 default，**忽略客户端 ?workspace= 入参**。
// 否则未授权方可凭任意 workspace 值越权读取、触发破坏性整替换覆写、或在共享库凭空创建工作区行污染。
// 接入账号体系后：改为从已认证会话推导 workspace_id，并校验调用方对该工作区的归属权。
export function resolveWorkspaceId(_request) {
  return DEFAULT_WORKSPACE_ID;
}

/**
 * 确保工作区行存在（所有写路径前置调用）。子表外键依赖此行；
 * 多个独立写入路径（state / brand / canvas / assets）都可能先触达，故统一幂等保底。
 * @param {import("postgres").Sql} sql
 * @param {string} workspaceId
 */
export async function ensureWorkspace(sql, workspaceId = DEFAULT_WORKSPACE_ID) {
  await sql`
    insert into public.aicrew_workspaces (id)
    values (${workspaceId})
    on conflict (id) do nothing
  `;
}
