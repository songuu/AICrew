import { connectionFor, createSystemAiRuntime, resolveSystemModel } from "../../../../lib/ai/server-config.js";
import { generateText, generateImage, generateVideo } from "../../../../lib/ai/providers.js";
import { AiRouteInputError, assertAiRouteRateLimit, normalizeAiRouteBody, publicAiRouteError, rateLimitKeyFromRequest, readBoundedJsonBody, sanitizeImageSize } from "../../../../lib/ai/routeGuard.js";

type RouteConnection = Record<string, unknown>;
type RouteSignal = AbortSignal | null | undefined;

const generateTextForRoute = generateText as unknown as (
  connection: RouteConnection,
  options: { system?: string; prompt: string; maxTokens?: number; signal?: RouteSignal }
) => Promise<string>;
const generateImageForRoute = generateImage as unknown as (
  connection: RouteConnection,
  options: { prompt: string; size?: string; signal?: RouteSignal }
) => Promise<string>;
const generateVideoForRoute = generateVideo as unknown as (
  connection: RouteConnection,
  options: { prompt: string; imageUrl?: string; signal?: RouteSignal }
) => Promise<Record<string, unknown>>;

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

export async function POST(request: Request) {
  const runtime = createSystemAiRuntime();
  if (!runtime.configured) {
    return json({ error: `系统 AI 未配置：${runtime.missing.join("、")}` }, 503);
  }

  let body;
  try {
    assertAiRouteRateLimit(rateLimitKeyFromRequest(request));
    body = normalizeAiRouteBody(await readBoundedJsonBody(request));
  } catch (error) {
    const status = error instanceof AiRouteInputError ? error.status : 400;
    return json({ error: publicAiRouteError(error) }, status);
  }

  try {
    const mode = body.mode;
    const route = resolveSystemModel(runtime, mode, body.modelId);
    const connection = connectionFor(runtime, route);

    if (mode === "text") {
      const text = await generateTextForRoute(connection, {
        system: body.system,
        prompt: body.prompt,
        maxTokens: body.maxTokens,
        signal: request.signal
      });
      return json({ text, model: route.id, providerName: runtime.providerName });
    }

    if (mode === "image") {
      const imageUrl = await generateImageForRoute(connection, {
        prompt: body.prompt,
        size: sanitizeImageSize(route.size || body.size),
        signal: request.signal
      });
      return json({ imageUrl, model: route.id, providerName: runtime.providerName });
    }

    if (mode === "video") {
      const video = await generateVideoForRoute(connection, {
        prompt: body.prompt,
        imageUrl: body.imageUrl,
        signal: request.signal
      });
      return json({ ...video, model: route.id, providerName: runtime.providerName });
    }

    return json({ error: `不支持的 AI 模式：${mode}` }, 400);
  } catch (error) {
    return json({ error: publicAiRouteError(error) }, 500);
  }
}

