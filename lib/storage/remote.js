// 客户端 → Supabase 的统一 fetch 层。所有持久化读写经 app/api/* 路由（服务端直连 SUPABASE_DB_URL）。
//
// 数据流纪律：Supabase 为权威源。读失败抛出 / 写失败抛出，由调用方回退 localStorage 离线兜底，
// 绝不静默丢用户数据。客户端永不接触连接串/service-role（只在服务端 env）。

import { buildRuntimeApiPath } from "../runtime/base-path.js";

const READ_TIMEOUT_MS = 30000;

export function apiUrl(path) {
  return buildRuntimeApiPath(path);
}

// 写入串行化（防 lost-update）：所有持久化写经此 FIFO 队列，杜绝两次防抖写的请求乱序落库
// 把旧态覆写新态。整替换 PUT 无版本守卫，故靠串行保证「后发起的写后落库」。
let writeChain = Promise.resolve();
export function serializeWrite(task) {
  const run = writeChain.then(task, task);
  // 链尾吞掉拒绝，避免一次失败毒化整条链（各 task 自行 catch 处理错误）。
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  const url = apiUrl(path);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`GET ${url} 失败 (${response.status})`);
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`GET ${url} 超时 (${READ_TIMEOUT_MS}ms)`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function writeJson(method, path, body) {
  const url = apiUrl(path);
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json())?.error || "";
    } catch {
      // 响应体非 JSON：忽略，沿用状态码。
    }
    throw new Error(method + " " + url + " 失败 (" + response.status + ")" + (detail ? ": " + detail : ""));
  }
  return response.json();
}

async function putJson(path, body) {
  return writeJson("PUT", path, body);
}

async function postJson(path, body) {
  return writeJson("POST", path, body);
}

// —— 主 state 快照 ——
export async function fetchSnapshot() {
  const data = await getJson("/api/state");
  return data?.snapshot ?? null;
}
export function pushSnapshot(snapshot) {
  return putJson("/api/state", { snapshot });
}

// —— 图像资产（imageStore 形状 { items }）——
export async function fetchAssetStore() {
  const data = await getJson("/api/assets");
  return data?.store ?? { items: [] };
}
export function pushAssetStore(store) {
  return putJson("/api/assets", { store });
}

// —— 品牌套件 ——
export async function fetchBrand() {
  const data = await getJson("/api/brand");
  return data?.brand ?? null;
}
export function pushBrand(brand) {
  return putJson("/api/brand", { brand });
}

// —— 无限画布（按 storageKey 区分主画布 / 导演台等多实例）——
export async function fetchCanvasDoc(key) {
  const data = await getJson(`/api/canvas?key=${encodeURIComponent(key)}`);
  return data?.canvas ?? null;
}
export function pushCanvasDoc(key, canvas) {
  return putJson(`/api/canvas?key=${encodeURIComponent(key)}`, { canvas });
}

// —— AI 模型选择 ——
export async function fetchAiSelectionDoc() {
  const data = await getJson("/api/ai-selection");
  return data?.selection ?? null;
}
export function pushAiSelectionDoc(selection) {
  return putJson("/api/ai-selection", { selection });
}

// —— 服务端积分交易（幂等，客户端只提交交易意图；DB 事务更新余额和流水）——
export function applyCreditTransaction(transaction) {
  return postJson("/api/credits/transaction", transaction);
}

// —— 积分钱包 / 报价 / 权益 ——
export async function fetchCreditWallet() {
  return getJson("/api/credits/wallet");
}
export function quoteCredits(input) {
  return postJson("/api/credits/quote", input);
}
export function grantCredits(input) {
  return postJson("/api/credits/grant", input);
}
export function reserveCredits(input) {
  return postJson("/api/credits/reserve", input);
}
export function settleCredits(input) {
  return postJson("/api/credits/settle", input);
}
export function releaseCredits(input) {
  return postJson("/api/credits/release", input);
}
