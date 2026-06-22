// 厂商适配层：统一文本/图像生成接口，浏览器直连 Claude / OpenAI。
// fetch 可注入（fetchImpl）以便单测无需真实网络与真实 key。
import { AI_PROVIDERS } from "./config.js";

const DEFAULT_MAX_TOKENS = 1024;

function resolveFetch(fetchImpl) {
  const fn = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!fn) throw new Error("当前环境无 fetch，无法调用 AI 接口");
  return fn;
}

function normalizeBase(config, meta) {
  return (config.baseURL || meta.defaultBaseURL).replace(/\/+$/, "");
}

// 从厂商错误响应里提取尽量有意义的信息，避免泄漏整段 body 到 UI。
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

// 统一文本生成。config: {provider, apiKey, model, baseURL}
// opts: {system, prompt, maxTokens, signal, fetchImpl}
export async function generateText(config, { system = "", prompt, maxTokens = DEFAULT_MAX_TOKENS, signal, fetchImpl } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error("generateText: prompt 不能为空");
  const meta = AI_PROVIDERS[config?.provider];
  if (!meta) throw new Error(`不支持的 provider: ${config?.provider}`);
  const doFetch = resolveFetch(fetchImpl);
  const base = normalizeBase(config, meta);

  if (config.provider === "claude") {
    const response = await doFetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        // 浏览器直连必需：声明知晓 key 暴露在前端的风险（静态站无后端代理）。
        "anthropic-dangerous-direct-browser-access": "true"
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

  // openai (chat completions)
  const response = await doFetch(`${base}/v1/chat/completions`, {
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
    throw new Error(`OpenAI API 调用失败 (${response.status}): ${await readErrorDetail(response)}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("OpenAI API 返回为空");
  return text;
}

// 图像生成（仅支持 supportsImage 的 provider，目前为 OpenAI）。返回 dataURL 或 http URL。
export async function generateImage(config, { prompt, size = "1024x1024", signal, fetchImpl } = {}) {
  const meta = AI_PROVIDERS[config?.provider];
  if (!meta?.supportsImage) throw new Error(`${config?.provider} 不支持图像生成`);
  if (!prompt || !String(prompt).trim()) throw new Error("generateImage: prompt 不能为空");
  const doFetch = resolveFetch(fetchImpl);
  const base = normalizeBase(config, meta);

  const response = await doFetch(`${base}/v1/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ model: meta.imageModel, prompt, size, n: 1 }),
    signal
  });
  if (!response.ok) {
    throw new Error(`OpenAI 图像生成失败 (${response.status}): ${await readErrorDetail(response)}`);
  }
  const data = await response.json();
  const item = data?.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;
  throw new Error("OpenAI 图像生成返回为空");
}

// 轻量连通性测试：发一个最小 prompt。永不抛错，返回 {ok, message}。
export async function testConnection(config, { fetchImpl, signal } = {}) {
  try {
    const text = await generateText(config, {
      prompt: "ping，请只回复 ok",
      maxTokens: 16,
      signal,
      fetchImpl
    });
    return { ok: true, message: `连接成功：${config.provider} / ${config.model}`, sample: text.slice(0, 40) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
