import { createSystemAiRuntime, publicSystemAiConfig } from "../../../../src/ai/server-config.js";

export const dynamic = "force-dynamic";

export function GET() {
  const runtime = createSystemAiRuntime();
  return Response.json(publicSystemAiConfig(runtime), {
    headers: { "cache-control": "no-store" }
  });
}

