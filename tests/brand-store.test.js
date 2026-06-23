import test from "node:test";
import assert from "node:assert/strict";
import { BRAND_STORE_KEY, loadBrandKit, saveBrandKit, normalizeBrandKit } from "../lib/brand/store.js";
import { defaultBrandKit } from "../lib/domain.js";

function memStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
    has: key => map.has(key)
  };
}

test("saveBrandKit/loadBrandKit round-trips across sessions under an independent key", () => {
  const store = memStorage();
  const edited = {
    ...defaultBrandKit,
    name: "AICrew",
    colors: ["#111", "#fff"],
    forbiddenWords: ["禁词A", "禁词B"],
    aesthetic: "高级、留白、冷色调"
  };
  const saved = saveBrandKit(edited, store);

  assert.equal(saved.name, "AICrew");
  assert.ok(store.has(BRAND_STORE_KEY));

  const loaded = loadBrandKit(store);
  assert.deepEqual(loaded.colors, ["#111", "#fff"]);
  assert.deepEqual(loaded.forbiddenWords, ["禁词A", "禁词B"]);
  assert.equal(loaded.aesthetic, "高级、留白、冷色调");
});

test("normalizeBrandKit coerces non-string array members and respects explicit empties", () => {
  const normalized = normalizeBrandKit({ colors: [123, " #abc "], forbiddenWords: [] });
  assert.deepEqual(normalized.colors, ["123", "#abc"]);
  assert.deepEqual(normalized.forbiddenWords, []); // 显式清空被尊重
});

test("loadBrandKit falls back to defaults on missing or corrupt storage", () => {
  const fresh = loadBrandKit(memStorage());
  assert.equal(fresh.name, defaultBrandKit.name);
  assert.deepEqual(fresh.forbiddenWords, defaultBrandKit.forbiddenWords);

  const corrupt = memStorage();
  corrupt.setItem(BRAND_STORE_KEY, "{broken");
  assert.equal(loadBrandKit(corrupt).name, defaultBrandKit.name);

  // 无 storage（SSR）不抛
  assert.equal(loadBrandKit(null).name, defaultBrandKit.name);
});

test("normalizeBrandKit defaults aesthetic to empty string and falls back missing fields", () => {
  const normalized = normalizeBrandKit({ name: "X" });
  assert.equal(normalized.aesthetic, "");
  assert.equal(normalized.voice, defaultBrandKit.voice);
  assert.equal(normalized.typography, defaultBrandKit.typography);
});
