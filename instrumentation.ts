// Next.js 启动钩子：服务进程起来后在后台预热 Supabase 连接，消除用户首请求的冷连延迟。
// 火山自托管 Postgres 建连抖动，冷连可能慢/超时；这里 fire-and-forget（不 await），
// 不阻塞 server 就绪与健康检查，预热失败也不影响——首请求自带 withDbRetry 兜底。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const db = await import("./lib/db/client.js");
  if (!db.isDbConfigured()) return;
  db.withDbRetry(() => db.getSql()`select 1`).catch(() => {
    // 预热失败忽略：连接会在首个真实请求时再次尝试建立。
  });
}
