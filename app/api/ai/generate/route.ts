import { connectionFor, createSystemAiRuntime, resolveSystemModel } from "../../../../lib/ai/server-config.js";
import { generateText, generateImage, generateVideo } from "../../../../lib/ai/providers.js";

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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const runtime = createSystemAiRuntime();
  if (!runtime.configured) {
    return json({ error: `系统 AI 未配置：${runtime.missing.join("、")}` }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求 JSON 无效" }, 400);
  }

  try {
    const mode = body?.mode || "text";
    const route = resolveSystemModel(runtime, mode, body?.modelId || "auto");
    const connection = connectionFor(runtime, route);

    if (mode === "text") {
      const text = await generateTextForRoute(connection, {
        system: body?.system || "",
        prompt: body?.prompt || "",
        maxTokens: body?.maxTokens || 1024,
        signal: request.signal
      });
      return json({ text, model: route.id, providerName: runtime.providerName });
    }

    if (mode === "image") {
      const imageUrl = await generateImageForRoute(connection, {
        prompt: body?.prompt || "",
        size: route.size || body?.size || "1024x1024",
        signal: request.signal
      });
      return json({ imageUrl, model: route.id, providerName: runtime.providerName });
    }

    if (mode === "video") {
      const video = await generateVideoForRoute(connection, {
        prompt: body?.prompt || "",
        imageUrl: body?.imageUrl || "",
        signal: request.signal
      });
      return json({ ...video, model: route.id, providerName: runtime.providerName });
    }

    return json({ error: `不支持的 AI 模式：${mode}` }, 400);
  } catch (error) {
    return json({ error: errorMessage(error) }, 500);
  }
}

