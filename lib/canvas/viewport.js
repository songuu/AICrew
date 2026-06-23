// 视口变换：pan/zoom 与屏幕↔世界坐标互转。纯函数、不可变。
// 视口 viewport = { x, y, zoom }；屏幕点 = 世界点 * zoom + (x, y)。
import { getBounds } from "./model.js";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function createViewport() {
  return { x: 0, y: 0, zoom: 1 };
}

export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(viewport, sx, sy) {
  return { x: (sx - viewport.x) / viewport.zoom, y: (sy - viewport.y) / viewport.zoom };
}

export function worldToScreen(viewport, wx, wy) {
  return { x: wx * viewport.zoom + viewport.x, y: wy * viewport.zoom + viewport.y };
}

export function panBy(viewport, dx, dy) {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

/**
 * 缩放到目标倍数，保持 center（屏幕点）对应的世界坐标不动。
 */
export function zoomTo(viewport, nextZoom, center = { x: 0, y: 0 }) {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(viewport, center.x, center.y);
  return {
    x: center.x - world.x * zoom,
    y: center.y - world.y * zoom,
    zoom
  };
}

export function zoomBy(viewport, factor, center) {
  return zoomTo(viewport, viewport.zoom * factor, center);
}

/**
 * 计算让所有可见对象居中铺满视口的视口。无对象返回默认视口。
 * @param {Array} objects 场景对象
 * @param {{width:number,height:number}} size 视口像素尺寸
 * @param {number} padding 视口内边距像素
 */
export function fitToView(objects, size, padding = 80) {
  const bounds = getBounds(objects);
  if (!bounds || (bounds.width === 0 && bounds.height === 0)) {
    return createViewport();
  }
  const zoomX = (size.width - padding * 2) / (bounds.width || 1);
  const zoomY = (size.height - padding * 2) / (bounds.height || 1);
  // 极薄/极小对象的理想缩放可能超过 MAX_ZOOM；此处按上限截断（宁可留白也不超缩），
  // 对象仍居中可见，只是不一定铺满。这是 max-zoom 约束下的有意取舍。
  const zoom = clampZoom(Math.min(zoomX, zoomY));
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;
  return {
    x: size.width / 2 - centerX * zoom,
    y: size.height / 2 - centerY * zoom,
    zoom
  };
}
