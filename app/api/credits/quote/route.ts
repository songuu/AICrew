import { json } from "../../../../lib/db/http.js";
import { quoteCreditTransaction } from "../../../../lib/db/repositories/credits.js";
import { areCreditsEnabled } from "../../../../lib/feature-flags.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!areCreditsEnabled()) return json({ disabled: true });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求 JSON 无效" }, 400);
  }
  return json(quoteCreditTransaction(body));
}
