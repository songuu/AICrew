import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_STORE_KEY,
  loadImageStore,
  saveImageStore,
  putImage,
  getImage,
  putRecord,
  pruneToQuota,
  normalizeImageStore,
  stashVariantImages,
  rehydrateVariantImages,
  stashLibraryAssets,
  rehydrateLibraryAssets
} from "../lib/storage/imageStore.js";

function memStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  };
}

test("putImage/getImage round-trips data and remote urls under independent key", () => {
  const store = memStorage();
  putImage("variant:v1", "data:image/png;base64,AAAA", store);
  putImage("variant:v2", "https://cdn.example.com/cover.png", store);

  assert.equal(getImage("variant:v1", store), "data:image/png;base64,AAAA");
  assert.equal(getImage("variant:v2", store), "https://cdn.example.com/cover.png");
  // 独立 key，不污染其它命名空间
  assert.ok(store.getItem(IMAGE_STORE_KEY));
  assert.equal(getImage("variant:missing", store), null);
});

test("kind is inferred: data: urls are 'data', others are 'remote'", () => {
  const next = putRecord(putRecord({ items: [] }, "a", "data:image/png;base64,XX"), "b", "https://x/y.png");
  assert.equal(next.items.find(item => item.id === "a").kind, "data");
  assert.equal(next.items.find(item => item.id === "b").kind, "remote");
});

test("pruneToQuota evicts oldest data urls first but always keeps remote", () => {
  const big = "data:image/png;base64," + "A".repeat(1000);
  let store = { items: [] };
  store = putRecord(store, "remote:keep", "https://cdn/x.png");
  store = putRecord(store, "data:old", big);
  store = putRecord(store, "data:new", big);

  // 配额只够一张大图 → 驱逐最旧 data（data:old），保留 data:new 与 remote
  const pruned = pruneToQuota(store, 1100);
  const ids = pruned.items.map(item => item.id);
  assert.ok(ids.includes("remote:keep"));
  assert.ok(ids.includes("data:new"));
  assert.ok(!ids.includes("data:old"));
});

test("pruneToQuota keeps remote even when total exceeds quota with no data left", () => {
  let store = { items: [] };
  store = putRecord(store, "r1", "https://cdn/a.png");
  store = putRecord(store, "r2", "https://cdn/b.png");
  const pruned = pruneToQuota(store, 1); // 远小于体积，但 remote 不可驱逐
  assert.equal(pruned.items.length, 2);
});

test("putRecord moves an existing id to most-recent (LRU) position", () => {
  let store = { items: [] };
  store = putRecord(store, "a", "data:image/png;base64,1");
  store = putRecord(store, "b", "data:image/png;base64,2");
  store = putRecord(store, "a", "data:image/png;base64,3"); // 重写 a → 移到队尾
  assert.deepEqual(store.items.map(item => item.id), ["b", "a"]);
  assert.equal(store.items.at(-1).url, "data:image/png;base64,3");
});

test("loadImageStore returns an empty store on missing or corrupt storage", () => {
  const empty = loadImageStore(memStorage());
  assert.deepEqual(empty, { items: [] });

  const corrupt = memStorage();
  corrupt.setItem(IMAGE_STORE_KEY, "{not json");
  assert.deepEqual(loadImageStore(corrupt), { items: [] });

  // 无 storage（SSR）也不抛
  assert.deepEqual(loadImageStore(null), { items: [] });
});

test("normalizeImageStore drops malformed entries and dedups ids", () => {
  const normalized = normalizeImageStore({
    items: [
      { id: "a", url: "data:image/png;base64,1" },
      { id: "a", url: "data:image/png;base64,2" }, // dup id → 丢弃
      { id: "", url: "x" }, // 空 id → 丢弃
      { url: "no-id" }, // 缺 id → 丢弃
      { id: "b" } // 缺 url → 丢弃
    ]
  });
  assert.deepEqual(normalized.items.map(item => item.id), ["a"]);
});

test("stashVariantImages then rehydrateVariantImages restores stripped covers across a session", () => {
  const store = memStorage();
  const live = {
    tasks: [{ id: "t1", variants: [{ id: "v1", imageUrl: "data:image/png;base64,Z" }, { id: "v2" }] }],
    projects: []
  };
  const stashed = stashVariantImages(live, store);
  assert.equal(stashed, 1);

  // 模拟 sanitizeStateForStorage 剥离 imageUrl 后再读取
  const stripped = {
    tasks: [{ id: "t1", variants: [{ id: "v1" }, { id: "v2" }] }],
    projects: []
  };
  const restored = rehydrateVariantImages(stripped, store);
  assert.equal(restored.tasks[0].variants[0].imageUrl, "data:image/png;base64,Z");
  assert.equal(restored.tasks[0].variants[1].imageUrl, undefined); // 无 stash → 保持空
});

test("rehydrateVariantImages is a safe no-op when the store is empty", () => {
  const restored = rehydrateVariantImages({ tasks: [{ id: "t", variants: [{ id: "v" }] }] }, memStorage());
  assert.equal(restored.tasks[0].variants[0].imageUrl, undefined);
});

test("stashLibraryAssets then rehydrateLibraryAssets restores stripped asset refs", () => {
  const store = memStorage();
  const live = {
    assets: [
      { id: "a1", name: "hero", ref: "data:image/png;base64,Z" },
      { id: "a2", name: "doc", ref: "https://cdn/doc.pdf" },
      { id: "a3", name: "seed" } // 无 ref（种子素材）→ 不入 store
    ]
  };
  assert.equal(stashLibraryAssets(live, store), 2);

  // 模拟 sanitizeStateForStorage 剥离 ref 后再读取
  const stripped = { assets: [{ id: "a1", name: "hero" }, { id: "a2", name: "doc" }, { id: "a3", name: "seed" }] };
  const restored = rehydrateLibraryAssets(stripped, store);
  assert.equal(restored.assets[0].ref, "data:image/png;base64,Z");
  assert.equal(restored.assets[1].ref, "https://cdn/doc.pdf");
  assert.equal(restored.assets[2].ref, undefined); // 无 stash → 保持空
});

test("library assets and variant covers coexist in one store without clobbering", () => {
  const store = memStorage();
  stashVariantImages({ tasks: [{ id: "t1", variants: [{ id: "v1", imageUrl: "data:image/png;base64,V" }] }] }, store);
  stashLibraryAssets({ assets: [{ id: "a1", ref: "data:image/png;base64,L" }] }, store);

  // 两个命名空间都在；后写的库素材没抹掉先写的变体封面
  const variantRestored = rehydrateVariantImages({ tasks: [{ id: "t1", variants: [{ id: "v1" }] }] }, store);
  const libraryRestored = rehydrateLibraryAssets({ assets: [{ id: "a1" }] }, store);
  assert.equal(variantRestored.tasks[0].variants[0].imageUrl, "data:image/png;base64,V");
  assert.equal(libraryRestored.assets[0].ref, "data:image/png;base64,L");
});

test("rehydrateLibraryAssets keeps an existing non-empty ref untouched", () => {
  const store = memStorage();
  stashLibraryAssets({ assets: [{ id: "a1", ref: "data:image/png;base64,STORED" }] }, store);
  const restored = rehydrateLibraryAssets({ assets: [{ id: "a1", ref: "data:image/png;base64,LIVE" }] }, store);
  assert.equal(restored.assets[0].ref, "data:image/png;base64,LIVE");
});

test("saveImageStore persists the pruned store and is reload-stable", () => {
  const store = memStorage();
  const big = "data:image/png;base64," + "A".repeat(1000);
  const saved = saveImageStore({ items: [
    { id: "data:old", url: big },
    { id: "data:new", url: big },
    { id: "remote:k", url: "https://cdn/x.png" }
  ] }, store, 1100);

  assert.ok(!saved.items.some(item => item.id === "data:old"));
  // 重新加载与落盘一致
  assert.deepEqual(loadImageStore(store), saved);
});
