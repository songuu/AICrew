import { json, DB_UNCONFIGURED_MESSAGE, INTERNAL_ERROR_MESSAGE } from "../../../../lib/db/http.js";
import { isDbConfigured, resolveWorkspaceId, withDbRetry } from "../../../../lib/db/client.js";
import { settleServerCredits, CreditTransactionError } from "../../../../lib/db/repositories/credits.js";
import { areCreditsEnabled } from "../../../../lib/feature-flags.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!areCreditsEnabled()) return json({ disabled: true });
  if (!isDbConfigured()) return json({ error: DB_UNCONFIGURED_MESSAGE }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求 JSON 无效" }, 400);
  }
  try {
    const result = await withDbRetry(() => settleServerCredits(body, resolveWorkspaceId(request)));
    return json(result);
  } catch (error) {
    if (error instanceof CreditTransactionError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: INTERNAL_ERROR_MESSAGE }, 500);
  }
}
