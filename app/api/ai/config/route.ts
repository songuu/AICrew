import { createSystemAiRuntime, publicSystemAiConfig } from "../../../../lib/ai/server-config.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const runtime = createSystemAiRuntime();
  return Response.json(publicSystemAiConfig(runtime), {
    headers: { "cache-control": "no-store" }
  });
}

