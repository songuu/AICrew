const DEFAULT_MAX_TOKENS = 1024;

function resolveFetch(fetchImpl) {
  const fn = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!fn) throw new Error("当前环境无 fetch，无法调用 AI 接口");
  return fn;
}

function normalizeBase(config) {
  const base = String(config?.baseURL || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("AI 平台 baseURL 未配置");
  try {
    const url = new URL(base);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("bad protocol");
  } catch {
    throw new Error("AI 平台 baseURL 必须是合法 URL");
  }
  return base;
}

async function readErrorDetail(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || "";
  } catch {
    try {
      return (await response.text())?.slice(0, 200) || "";
    } catch {
      return "";
    }
  }
}

function apiUrl(base, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (base.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${base}${normalizedPath.slice(3)}`;
  }
  return `${base}${normalizedPath}`;
}

function inferImageApi(config, base) {
  const explicit = String(config?.imageApi || "").trim().toLowerCase();
  if (["siliconflow", "openai"].includes(explicit)) return explicit;
  try {
    const hostname = new URL(base).hostname;
    if (hostname.endsWith("siliconflow.cn")) return "siliconflow";
  } catch {
    // normalizeBase already validates the URL; keep generic format if that ever changes.
  }
  return "openai";
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function imageRequestBody(config, prompt, size, imageApi) {
  const model = config.imageModel || config.model;
  const imageSize = config.size || size;
  if (imageApi === "siliconflow") {
    return {
      model,
      prompt,
      image_size: imageSize,
      batch_size: optionalNumber(config.batchSize) || 1,
      num_inference_steps: optionalNumber(config.numInferenceSteps) || 20,
      guidance_scale: optionalNumber(config.guidanceScale) || 7.5
    };
  }
  return { model, prompt, size: imageSize, n: 1 };
}

async function callSystemApi(config, mode, payload, fetchImpl) {
  const doFetch = resolveFetch(fetchImpl);
  const response = await doFetch(config.endpoint || "/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode,
      modelId: config.selection?.[mode] || "auto",
      ...payload
    }),
    signal: payload.signal
  });
  if (!response.ok) {
    throw new Error(`系统 AI 调用失败 (${response.status}): ${await readErrorDetail(response)}`);
  }
  return response.json();
}

export async function generateText(config, { system = "", prompt, maxTokens = DEFAULT_MAX_TOKENS, signal, fetchImpl } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error("generateText: prompt 不能为空");
  if (config?.provider === "system") {
    const data = await callSystemApi(config, "text", { system, prompt, maxTokens, signal }, fetchImpl);
    if (!data?.text) throw new Error("系统 AI 文本返回为空");
    return data.text;
  }

  const doFetch = resolveFetch(fetchImpl);
  const base = normalizeBase(config);

  if (config?.provider === "claude") {
    const response = await doFetch(apiUrl(base, "/v1/messages"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }]
      }),
      signal
    });
    if (!response.ok) {
      throw new Error(`Claude API 调用失败 (${response.status}): ${await readErrorDetail(response)}`);
    }
    const data = await response.json();
    const text = Array.isArray(data?.content)
      ? data.content.filter(block => block?.type === "text").map(block => block.text).join("\n").trim()
      : "";
    if (!text) throw new Error("Claude API 返回为空");
    return text;
  }

  const response = await doFetch(apiUrl(base, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt }
      ]
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`AI 文本生成失败 (${response.status}): ${await readErrorDetail(response)}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("AI 文本返回为空");
  return text;
}

export async function generateImage(config, { prompt, size = "1024x1024", signal, fetchImpl } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error("generateImage: prompt 不能为空");
  if (config?.provider === "system") {
    const data = await callSystemApi(config, "image", { prompt, size, signal }, fetchImpl);
    if (!data?.imageUrl) throw new Error("系统 AI 图像返回为空");
    return data.imageUrl;
  }

  const doFetch = resolveFetch(fetchImpl);
  const base = normalizeBase(config);
  const imageApi = inferImageApi(config, base);
  const response = await doFetch(apiUrl(base, "/v1/images/generations"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(imageRequestBody(config, prompt, size, imageApi)),
    signal
  });
  if (!response.ok) {
    throw new Error(`AI 图像生成失败 (${response.status}): ${await readErrorDetail(response)}`);
  }
  const data = await response.json();
  const item = data?.images?.[0] || data?.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;
  throw new Error("AI 图像生成返回为空");
}

export async function generateVideo(config, { prompt, imageUrl, signal, fetchImpl } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error("generateVideo: prompt 不能为空");
  if (config?.provider === "system") {
    const data = await callSystemApi(config, "video", { prompt, imageUrl, signal }, fetchImpl);
    if (!data?.videoUrl && !data?.jobId) throw new Error("系统 AI 视频返回为空");
    return data;
  }

  const doFetch = resolveFetch(fetchImpl);
  const base = normalizeBase(config);
  const response = await doFetch(apiUrl(base, "/v1/videos/generations"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ model: config.videoModel || config.model, prompt, image_url: imageUrl }),
    signal
  });
  if (!response.ok) {
    throw new Error(`AI 视频生成失败 (${response.status}): ${await readErrorDetail(response)}`);
  }
  const data = await response.json();
  const item = data?.data?.[0] || data;
  const videoUrl = item?.url || item?.video_url || item?.output?.[0]?.url || "";
  const jobId = item?.id || data?.id || "";
  if (!videoUrl && !jobId) throw new Error("AI 视频生成返回为空");
  return { videoUrl, jobId };
}

export async function testConnection(config, { fetchImpl, signal } = {}) {
  try {
    const text = await generateText(config, {
      prompt: "ping，请只回复 ok",
      maxTokens: 16,
      signal,
      fetchImpl
    });
    return { ok: true, message: `连接成功：${config.providerName || config.provider} / ${config.model || "system"}`, sample: text.slice(0, 40) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
