// 变体/画布封面的独立图像存储层。设计依据：docs/plans/2026-06-23-make-it-real-no-video.md（P3）。
// 为什么独立 key：主 state blob 一旦塞入 base64 data URL 会迅速撑爆 localStorage 配额，
// 故把图像引用分离到独立 key，并对 data URL 做配额内 LRU 修剪；remote(https) 引用体积小，永久保留。
//
// 数据形态（可序列化）：{ items: [{ id, url, kind:'data'|'remote', bytes }] }
//   - items 按插入顺序排列（队首=最旧，队尾=最新），LRU 修剪从队首开始驱逐 data 项。
//   - id 约定命名空间前缀：variant:<variantId> / canvas:<objId>，避免两类图像互相 LRU 挤兑时语义混淆。

export const IMAGE_STORE_KEY = "aicrew-variant-images-v1";

// data URL 软上限（仅约束 base64 内联图；remote 引用不计入，永久保留）。
export const DEFAULT_IMAGE_QUOTA_BYTES = 4 * 1024 * 1024;

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

function kindOf(url) {
  return typeof url === "string" && url.startsWith("data:") ? "data" : "remote";
}

function bytesOf(url) {
  return typeof url === "string" ? url.length : 0;
}

function emptyStore() {
  return { items: [] };
}

// 输入边界校验：丢弃缺 id/url 的脏项，回填 kind/bytes，保证后续逻辑可信。
export function normalizeImageStore(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const seen = new Set();
  const clean = [];
  for (const item of items) {
    const id = item && typeof item.id === "string" ? item.id : null;
    const url = item && typeof item.url === "string" ? item.url : null;
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    clean.push({ id, url, kind: item.kind === "remote" || item.kind === "data" ? item.kind : kindOf(url), bytes: Number.isFinite(item.bytes) ? item.bytes : bytesOf(url) });
  }
  return { items: clean };
}

// 纯函数：写入/更新一条记录。已存在的 id 先移除再追加到队尾（标记为最近使用）。
export function putRecord(store, id, url) {
  if (typeof id !== "string" || !id || typeof url !== "string" || !url) return store;
  const items = store.items.filter(item => item.id !== id);
  items.push({ id, url, kind: kindOf(url), bytes: bytesOf(url) });
  return { items };
}

export function getRecord(store, id) {
  return store.items.find(item => item.id === id) || null;
}

// 纯函数：把 store 修剪到配额内。只驱逐 data 项（从最旧开始）；remote 项永久保留。
// 即便单个 data 项超过配额也会被驱逐（无法保留）。data 全部驱逐后仍超额则停止（remote 不动）。
export function pruneToQuota(store, maxBytes = DEFAULT_IMAGE_QUOTA_BYTES) {
  let items = store.items.slice();
  const dataBytes = () => items.filter(item => item.kind === "data").reduce((sum, item) => sum + item.bytes, 0);
  while (dataBytes() > maxBytes) {
    const oldestDataIndex = items.findIndex(item => item.kind === "data");
    if (oldestDataIndex === -1) break;
    items = items.slice(0, oldestDataIndex).concat(items.slice(oldestDataIndex + 1));
  }
  return { items };
}

// 存储边界：读。损坏/缺失一律回退空 store（降级安全，绝不抛）。
export function loadImageStore(storage) {
  const store = resolveStorage(storage);
  if (!store) return emptyStore();
  try {
    const raw = store.getItem(IMAGE_STORE_KEY);
    return raw ? normalizeImageStore(JSON.parse(raw)) : emptyStore();
  } catch {
    return emptyStore();
  }
}

// 存储边界：写。写前修剪到配额；返回实际落盘的（已修剪）store。
export function saveImageStore(store, storage, maxBytes = DEFAULT_IMAGE_QUOTA_BYTES) {
  const pruned = pruneToQuota(normalizeImageStore(store), maxBytes);
  const target = resolveStorage(storage);
  if (target) {
    try {
      target.setItem(IMAGE_STORE_KEY, JSON.stringify(pruned));
    } catch {
      /* 配额仍可能在极端情况下写失败：降级为静默丢弃，调用方下次重新生成 */
    }
  }
  return pruned;
}

// 便捷：写入单张图（load→put→prune→save），返回落盘后的 store。
export function putImage(id, url, storage, maxBytes = DEFAULT_IMAGE_QUOTA_BYTES) {
  const next = putRecord(loadImageStore(storage), id, url);
  return saveImageStore(next, storage, maxBytes);
}

// 便捷：读取单张图的 url（命中返回字符串，未命中返回 null）。
export function getImage(id, storage) {
  return getRecord(loadImageStore(storage), id)?.url || null;
}

function variantKey(id) {
  return `variant:${id}`;
}

// 落盘前：把 state 内各 variant 的 imageUrl 批量写入独立 imageStore（一次读改写，含配额修剪）。
// 返回写入条数。配合 sanitizeStateForStorage 把 base64 移出主 blob，避免配额溢出又不丢图。
//
// maxBytes：localStorage 缓存路径用默认 4MB 配额修剪；推 Supabase 路径应传 Infinity（无配额，
// 否则大封面会在写云前被本地 LRU 驱逐 → 权威源永久丢图）。见 STASH_UNBOUNDED。
export function stashVariantImages(state, storage, maxBytes = DEFAULT_IMAGE_QUOTA_BYTES) {
  let store = loadImageStore(storage);
  let count = 0;
  for (const list of [state?.tasks, state?.projects]) {
    for (const item of list || []) {
      for (const variant of item?.variants || []) {
        if (variant?.id && variant.imageUrl) {
          store = putRecord(store, variantKey(variant.id), variant.imageUrl);
          count += 1;
        }
      }
    }
  }
  saveImageStore(store, storage, maxBytes);
  return count;
}

// 推送权威源（Supabase）时使用：不施加 localStorage 4MB 配额修剪。
export const STASH_UNBOUNDED = Infinity;

// 读取后：用 imageStore 回填被剥离的 variant.imageUrl（命中才填，缺失保持原样不报错）。纯函数。
export function rehydrateVariantImages(state, storage) {
  const store = loadImageStore(storage);
  const fill = variant => {
    if (!variant?.id || variant.imageUrl) return variant;
    const record = getRecord(store, variantKey(variant.id));
    return record ? { ...variant, imageUrl: record.url } : variant;
  };
  const fillList = list => (list || []).map(item => (item?.variants ? { ...item, variants: item.variants.map(fill) } : item));
  return { ...state, tasks: fillList(state?.tasks), projects: fillList(state?.projects) };
}
