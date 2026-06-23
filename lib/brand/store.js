// 跨会话品牌记忆持久化层。设计依据：docs/plans/2026-06-23-make-it-real-no-video.md（P4-T1）。
// 为什么独立 key：brandKit 此前随主 state blob 漂移（与任务/资产同一份序列化），刷新易丢、难单独读取。
// 拆到独立 key 后，品牌规范 + 审美偏好可跨会话稳定恢复并自动注入 prompt（见 lib/brand/prompt.js）。
import { defaultBrandKit } from "../domain.js";

export const BRAND_STORE_KEY = "aicrew-brand-v1";

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

function asString(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

// 数组字段：是数组就按字符串清洗（允许空数组——用户显式清空应被尊重）；非数组才回退默认。
function asStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.map(item => String(item).trim()).filter(Boolean);
}

// 输入边界校验：任意外部数据 → 受控 brandKit 形状，缺字段回退 defaultBrandKit。
export function normalizeBrandKit(raw) {
  const base = defaultBrandKit;
  const input = raw && typeof raw === "object" ? raw : {};
  return {
    name: asString(input.name, base.name),
    slogan: asString(input.slogan, base.slogan),
    colors: asStringArray(input.colors, base.colors),
    typography: asString(input.typography, base.typography),
    voice: asString(input.voice, base.voice),
    forbiddenWords: asStringArray(input.forbiddenWords, base.forbiddenWords),
    productLine: asString(input.productLine, base.productLine),
    // 审美偏好：RoboNeo 式 Brand Memory 的关键字段，默认空字符串（无则不注入）。
    aesthetic: typeof input.aesthetic === "string" ? input.aesthetic.trim() : ""
  };
}

export function loadBrandKit(storage) {
  const store = resolveStorage(storage);
  if (!store) return normalizeBrandKit({});
  try {
    const raw = store.getItem(BRAND_STORE_KEY);
    return normalizeBrandKit(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeBrandKit({});
  }
}

export function saveBrandKit(brandKit, storage) {
  const normalized = normalizeBrandKit(brandKit);
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(BRAND_STORE_KEY, JSON.stringify(normalized));
    } catch {
      // 极端配额失败：静默降级，内存态不受影响。
    }
  }
  return normalized;
}
