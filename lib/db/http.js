// API 路由共享：统一无缓存 JSON 响应 + 错误消息归一。对齐 app/api/ai/generate 既有风格。

export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export const DB_UNCONFIGURED_MESSAGE =
  "Supabase 未配置：SUPABASE_DB_URL 缺失。请在本地 .env 或生产 AICREW_PRODUCTION_ENV 中提供连接串。";

// 500 对外脱敏文案：未鉴权端点不得回显 postgres 原始 error.message（含表名/列名/约束/host 等 schema 与基础设施细节）。
export const INTERNAL_ERROR_MESSAGE = "服务处理请求时出错，请稍后重试。";
