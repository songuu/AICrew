import { json, DB_UNCONFIGURED_MESSAGE, INTERNAL_ERROR_MESSAGE } from "../../../../lib/db/http.js";
import { isDbConfigured, resolveWorkspaceId, withDbRetry } from "../../../../lib/db/client.js";
import { loadCreditWalletOverview } from "../../../../lib/db/repositories/credits.js";
import { areCreditsEnabled } from "../../../../lib/feature-flags.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!areCreditsEnabled()) return json({ disabled: true });
  if (!isDbConfigured()) return json({ error: DB_UNCONFIGURED_MESSAGE }, 503);
  try {
    const result = await withDbRetry(() => loadCreditWalletOverview(resolveWorkspaceId(request)));
    return json(result);
  } catch {
    return json({ error: INTERNAL_ERROR_MESSAGE }, 500);
  }
}
