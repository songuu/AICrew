import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createScene,
  createShape,
  addObject,
  updateObject,
  moveObject,
  removeObject,
  reorderObject,
  getBounds,
  boundsOf,
  worldBounds,
  hitTest,
  computeDrawPatch,
  rotatePoint,
  centerOf,
  handlePositions,
  hitHandle,
  resizeShape,
  rotateShapeTo,
  HANDLE_SIGN,
  MIN_SIZE,
  isValidShape,
  sanitizeObjects,
  SHAPE_TYPES
} from "../lib/canvas/model.js";

import {
  createViewport,
  clampZoom,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomTo,
  zoomBy,
  fitToView,
  MIN_ZOOM,
  MAX_ZOOM
} from "../lib/canvas/viewport.js";

import {
  createHistory,
  commit,
  undo,
  redo,
  canUndo,
  canRedo
} from "../lib/canvas/history.js";

import { TOOL, DRAW_TOOLS, isDrawTool, ADD_MENU } from "../lib/canvas/tools.js";

// ---------- model ----------

test("createShape 生成带 id/默认值的图元，未知类型抛错", () => {
  const rect = createShape("rect", { x: 10, y: 20 });
  assert.equal(rect.type, "rect");
  assert.equal(rect.x, 10);
  assert.equal(rect.y, 20);
  assert.ok(rect.id, "应自动生成 id");
  assert.equal(rect.hidden, false);
  assert.ok(rect.width > 0 && rect.height > 0, "应有默认尺寸");
  assert.throws(() => createShape("hexagon"), /未知图元类型/);
});

test("createShape 显式 id 不被覆盖，props 覆盖默认", () => {
  const t = createShape("text", { id: "fixed", text: "你好", x: 1, y: 2 });
  assert.equal(t.id, "fixed");
  assert.equal(t.text, "你好");
});

test("SHAPE_TYPES 覆盖 RoboNeo 全部图元", () => {
  for (const type of ["rect", "ellipse", "text", "arrow", "image", "video"]) {
    assert.ok(SHAPE_TYPES.includes(type), `缺图元类型 ${type}`);
  }
});

test("addObject 不可变追加", () => {
  const s0 = createScene();
  const shape = createShape("rect", { id: "a" });
  const s1 = addObject(s0, shape);
  assert.equal(s0.objects.length, 0, "原场景不被修改");
  assert.equal(s1.objects.length, 1);
  assert.equal(s1.objects[0].id, "a");
});

test("updateObject 仅改目标且不可变", () => {
  const s = addObject(addObject(createScene(), createShape("rect", { id: "a", x: 0 })), createShape("rect", { id: "b", x: 0 }));
  const next = updateObject(s, "a", { x: 99 });
  assert.equal(next.objects.find(o => o.id === "a").x, 99);
  assert.equal(next.objects.find(o => o.id === "b").x, 0);
  assert.equal(s.objects.find(o => o.id === "a").x, 0, "原场景不变");
});

test("moveObject 平移 dx/dy", () => {
  const s = addObject(createScene(), createShape("rect", { id: "a", x: 10, y: 10 }));
  const next = moveObject(s, "a", 5, -3);
  const o = next.objects[0];
  assert.equal(o.x, 15);
  assert.equal(o.y, 7);
});

test("removeObject 删除指定", () => {
  const s = addObject(addObject(createScene(), createShape("rect", { id: "a" })), createShape("rect", { id: "b" }));
  const next = removeObject(s, "a");
  assert.equal(next.objects.length, 1);
  assert.equal(next.objects[0].id, "b");
});

test("reorderObject 调整 z-order（数组序=层序）", () => {
  let s = createScene();
  s = addObject(s, createShape("rect", { id: "a" }));
  s = addObject(s, createShape("rect", { id: "b" }));
  s = addObject(s, createShape("rect", { id: "c" }));
  // up = 向数组末尾（更靠前/上层）
  const up = reorderObject(s, "a", "up");
  assert.deepEqual(up.objects.map(o => o.id), ["b", "a", "c"]);
  const down = reorderObject(s, "c", "down");
  assert.deepEqual(down.objects.map(o => o.id), ["a", "c", "b"]);
  // 边界：顶端再 up 不变
  const noop = reorderObject(s, "c", "up");
  assert.deepEqual(noop.objects.map(o => o.id), ["a", "b", "c"]);
});

test("boundsOf 计算单对象包围盒，arrow 用线段", () => {
  const rect = createShape("rect", { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(boundsOf(rect), { minX: 10, minY: 20, maxX: 110, maxY: 70 });
  const arrow = createShape("arrow", { x: 0, y: 0, width: -40, height: 30 });
  const b = boundsOf(arrow);
  assert.equal(b.minX, -40);
  assert.equal(b.maxX, 0);
  assert.equal(b.minY, 0);
  assert.equal(b.maxY, 30);
});

test("getBounds 聚合可见对象，忽略隐藏，空返回 null", () => {
  assert.equal(getBounds([]), null);
  const objs = [
    createShape("rect", { x: 0, y: 0, width: 50, height: 50 }),
    createShape("rect", { x: 100, y: 100, width: 50, height: 50 }),
    createShape("rect", { x: -999, y: -999, width: 10, height: 10, hidden: true })
  ];
  const b = getBounds(objs);
  assert.equal(b.minX, 0);
  assert.equal(b.minY, 0);
  assert.equal(b.maxX, 150);
  assert.equal(b.maxY, 150);
  assert.equal(b.width, 150);
  assert.equal(b.height, 150);
});

test("hitTest 命中最上层，隐藏不命中，空白返回 null", () => {
  let s = createScene();
  s = addObject(s, createShape("rect", { id: "bottom", x: 0, y: 0, width: 100, height: 100 }));
  s = addObject(s, createShape("rect", { id: "top", x: 0, y: 0, width: 100, height: 100 }));
  assert.equal(hitTest(s, 50, 50), "top", "应命中最上层");
  assert.equal(hitTest(s, 500, 500), null, "空白处不命中");
  const hidden = updateObject(s, "top", { hidden: true });
  assert.equal(hitTest(hidden, 50, 50), "bottom", "隐藏对象跳过");
});

test("computeDrawPatch 矩形/椭圆归一化（任意拖拽方向都得正向包围盒）", () => {
  // 正向拖拽
  assert.deepEqual(computeDrawPatch("rect", { x: 100, y: 100 }, { x: 160, y: 140 }), {
    x: 100,
    y: 100,
    width: 60,
    height: 40
  });
  // 反向拖拽（右下→左上）应得到同一个正向包围盒
  assert.deepEqual(computeDrawPatch("rect", { x: 160, y: 140 }, { x: 100, y: 100 }), {
    x: 100,
    y: 100,
    width: 60,
    height: 40
  });
  assert.deepEqual(computeDrawPatch("ellipse", { x: 50, y: 50 }, { x: 10, y: 90 }), {
    x: 10,
    y: 50,
    width: 40,
    height: 40
  });
});

test("computeDrawPatch arrow 保留有符号位移（记录方向）", () => {
  assert.deepEqual(computeDrawPatch("arrow", { x: 100, y: 100 }, { x: 40, y: 60 }), {
    x: 100,
    y: 100,
    width: -60,
    height: -40
  });
});

// ---------- 旋转 / 缩放句柄 ----------

test("createShape 默认 rotation=0", () => {
  assert.equal(createShape("rect", { id: "a" }).rotation, 0);
});

test("rotatePoint 绕中心旋转 90°", () => {
  const p = rotatePoint(10, 0, 0, 0, 90);
  assert.ok(Math.abs(p.x - 0) < 1e-9);
  assert.ok(Math.abs(p.y - 10) < 1e-9);
  // 0° 原样返回
  assert.deepEqual(rotatePoint(5, 7, 0, 0, 0), { x: 5, y: 7 });
});

test("worldBounds 旋转 90° 的 100×40 矩形 → 世界框 40×100，中心不变", () => {
  const rect = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 40, rotation: 90 });
  const wb = worldBounds(rect);
  assert.ok(Math.abs(wb.width - 40) < 1e-6);
  assert.ok(Math.abs(wb.height - 100) < 1e-6);
  assert.ok(Math.abs((wb.minX + wb.maxX) / 2 - 50) < 1e-6);
  assert.ok(Math.abs((wb.minY + wb.maxY) / 2 - 20) < 1e-6);
});

test("handlePositions 给出 8 缩放句柄 + rotate，rot=0 位置正确", () => {
  const rect = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 40 });
  const pos = handlePositions(rect, 26);
  assert.deepEqual(Object.keys(pos).sort(), ["e", "n", "ne", "nw", "rotate", "s", "se", "sw", "w"].sort());
  assert.deepEqual(pos.nw, { x: 0, y: 0 });
  assert.deepEqual(pos.se, { x: 100, y: 40 });
  assert.deepEqual(pos.n, { x: 50, y: 0 });
  assert.deepEqual(pos.rotate, { x: 50, y: -26 });
});

test("hitHandle 命中角点/旋转句柄，空白返回 null", () => {
  const rect = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 40 });
  assert.equal(hitHandle(rect, 100, 40, 5, 26), "se");
  assert.equal(hitHandle(rect, 50, -26, 5, 26), "rotate");
  assert.equal(hitHandle(rect, 50, 20, 5, 26), null);
});

test("resizeShape rot=0 se 句柄锚定左上角", () => {
  const rect = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 40 });
  const patch = resizeShape(rect, "se", 150, 100);
  assert.deepEqual(patch, { x: 0, y: 0, width: 150, height: 100 });
});

test("resizeShape 夹紧到 MIN_SIZE", () => {
  const rect = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 40 });
  const patch = resizeShape(rect, "se", 3, 3);
  assert.equal(patch.width, MIN_SIZE);
  assert.equal(patch.height, MIN_SIZE);
});

test("resizeShape 文本同步缩放 fontSize", () => {
  const text = createShape("text", { id: "t", x: 0, y: 0, width: 160, height: 40, fontSize: 28 });
  const patch = resizeShape(text, "se", 320, 80);
  assert.equal(patch.height, 80);
  assert.equal(patch.fontSize, 56); // 28 * 80/40
});

test("resizeShape 旋转感知：缩放后对侧锚点世界位置不变（任意旋转）", () => {
  const orig = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 60, rotation: 37 });
  const anchorBefore = handlePositions(orig).nw; // se 的对侧
  const patch = resizeShape(orig, "se", 200, 150);
  const resized = { ...orig, ...patch };
  const anchorAfter = handlePositions(resized).nw;
  assert.ok(Math.abs(anchorBefore.x - anchorAfter.x) < 1e-6, "锚点 X 不变");
  assert.ok(Math.abs(anchorBefore.y - anchorAfter.y) < 1e-6, "锚点 Y 不变");
});

test("rotateShapeTo 朝向指针 + snap", () => {
  const rect = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 100 }); // 中心(50,50)
  assert.ok(Math.abs(rotateShapeTo(rect, 50, 0).rotation - 0) < 1e-6, "正上方 → 0°");
  assert.ok(Math.abs(rotateShapeTo(rect, 150, 50).rotation - 90) < 1e-6, "正右方 → 90°");
  assert.equal(rotateShapeTo(rect, 150, 70, 15).rotation, 105); // 101.3° snap 15 → 105
});

test("hitTest 旋转感知：旋转后落在未旋转框内但旋转框外的点不命中", () => {
  const rect = createShape("rect", { id: "r", x: 0, y: 0, width: 100, height: 20, rotation: 90 });
  const scene = createScene([rect]);
  assert.equal(hitTest(scene, 90, 10), null, "未旋转框内但旋转框外 → 不命中");
  assert.equal(hitTest(scene, 50, 50), "r", "旋转框内 → 命中");
});

test("isValidShape 拒绝损坏图元（缺 id/未知 type/非有限坐标）", () => {
  assert.equal(isValidShape(createShape("rect", { id: "a", x: 0, y: 0 })), true);
  assert.equal(isValidShape(null), false);
  assert.equal(isValidShape({ type: "rect", x: 0, y: 0 }), false, "缺 id");
  assert.equal(isValidShape({ id: "x", type: "hexagon", x: 0, y: 0 }), false, "未知 type");
  assert.equal(isValidShape({ id: "x", type: "rect", x: NaN, y: 0 }), false, "非有限坐标");
});

test("sanitizeObjects 过滤损坏项，非数组返回空", () => {
  const good = createShape("rect", { id: "ok", x: 1, y: 2 });
  const dirty = [good, null, { id: "n", type: "bad", x: 0, y: 0 }, { type: "rect", x: 0, y: 0 }];
  const clean = sanitizeObjects(dirty);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].id, "ok");
  assert.deepEqual(sanitizeObjects("not-array"), []);
  assert.deepEqual(sanitizeObjects(undefined), []);
});

// ---------- viewport ----------

test("clampZoom 限制到 [MIN,MAX]", () => {
  assert.equal(clampZoom(0.001), MIN_ZOOM);
  assert.equal(clampZoom(999), MAX_ZOOM);
  assert.equal(clampZoom(1), 1);
});

test("screenToWorld/worldToScreen 互为逆", () => {
  const vp = { x: 120, y: -40, zoom: 2 };
  const world = screenToWorld(vp, 300, 200);
  const back = worldToScreen(vp, world.x, world.y);
  assert.ok(Math.abs(back.x - 300) < 1e-9);
  assert.ok(Math.abs(back.y - 200) < 1e-9);
});

test("panBy 平移视口原点", () => {
  const vp = panBy(createViewport(), 30, -10);
  assert.equal(vp.x, 30);
  assert.equal(vp.y, -10);
  assert.equal(vp.zoom, 1);
});

test("zoomTo 保持指定屏幕点世界坐标不动", () => {
  const vp = createViewport();
  const center = { x: 400, y: 300 };
  const beforeWorld = screenToWorld(vp, center.x, center.y);
  const zoomed = zoomTo(vp, 2, center);
  const afterWorld = screenToWorld(zoomed, center.x, center.y);
  assert.ok(Math.abs(beforeWorld.x - afterWorld.x) < 1e-9, "缩放锚点世界 X 不变");
  assert.ok(Math.abs(beforeWorld.y - afterWorld.y) < 1e-9, "缩放锚点世界 Y 不变");
  assert.equal(zoomed.zoom, 2);
});

test("zoomBy 相乘并 clamp", () => {
  const vp = { x: 0, y: 0, zoom: 3 };
  const z = zoomBy(vp, 2, { x: 0, y: 0 });
  assert.equal(z.zoom, MAX_ZOOM, "3*2=6 被 clamp 到 MAX");
});

test("fitToView 空对象返回默认视口", () => {
  assert.deepEqual(fitToView([], { width: 800, height: 600 }), createViewport());
});

test("fitToView 让对象包围盒居中且落在视口内", () => {
  const objs = [createShape("rect", { x: 0, y: 0, width: 200, height: 100 })];
  const size = { width: 800, height: 600 };
  const vp = fitToView(objs, size, 80);
  // 包围盒中心映射到视口中心
  const centerWorld = { x: 100, y: 50 };
  const screen = worldToScreen(vp, centerWorld.x, centerWorld.y);
  assert.ok(Math.abs(screen.x - 400) < 1e-6, "水平居中");
  assert.ok(Math.abs(screen.y - 300) < 1e-6, "垂直居中");
  assert.ok(vp.zoom <= MAX_ZOOM && vp.zoom >= MIN_ZOOM);
});

// ---------- history ----------

test("createHistory 初始无可撤销/重做", () => {
  const h = createHistory("s0");
  assert.equal(h.present, "s0");
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
});

test("commit 推进现态并清空 future", () => {
  let h = createHistory("s0");
  h = commit(h, "s1");
  assert.equal(h.present, "s1");
  assert.equal(canUndo(h), true);
  assert.equal(canRedo(h), false);
});

test("undo/redo 往返", () => {
  let h = createHistory("s0");
  h = commit(h, "s1");
  h = commit(h, "s2");
  h = undo(h);
  assert.equal(h.present, "s1");
  assert.equal(canRedo(h), true);
  h = undo(h);
  assert.equal(h.present, "s0");
  assert.equal(canUndo(h), false);
  h = redo(h);
  assert.equal(h.present, "s1");
  h = redo(h);
  assert.equal(h.present, "s2");
  assert.equal(canRedo(h), false);
});

test("undo 后 commit 清空 redo 分支", () => {
  let h = createHistory("s0");
  h = commit(h, "s1");
  h = undo(h);
  h = commit(h, "s1b");
  assert.equal(h.present, "s1b");
  assert.equal(canRedo(h), false, "新提交应清空 future");
});

test("空栈 undo/redo 为安全 no-op", () => {
  const h = createHistory("s0");
  assert.equal(undo(h).present, "s0");
  assert.equal(redo(h).present, "s0");
});

// ---------- tools ----------

test("TOOL 含选择与抓手", () => {
  assert.equal(TOOL.SELECT, "select");
  assert.equal(TOOL.HAND, "hand");
});

test("isDrawTool 区分绘制工具", () => {
  assert.equal(isDrawTool("rect"), true);
  assert.equal(isDrawTool("arrow"), true);
  assert.equal(isDrawTool("select"), false);
  assert.equal(isDrawTool("hand"), false);
  for (const t of DRAW_TOOLS) assert.ok(isDrawTool(t));
});

test("ADD_MENU 与 RoboNeo 添加菜单 1:1（6 项含顺序与类型）", () => {
  assert.deepEqual(
    ADD_MENU.map(item => item.id),
    ["image", "video", "text", "rect", "ellipse", "arrow"]
  );
  const importItems = ADD_MENU.filter(i => i.kind === "import").map(i => i.id);
  const drawItems = ADD_MENU.filter(i => i.kind === "draw").map(i => i.id);
  assert.deepEqual(importItems, ["image", "video"]);
  assert.deepEqual(drawItems, ["text", "rect", "ellipse", "arrow"]);
  // 导入项必须带 accept
  assert.ok(ADD_MENU.find(i => i.id === "image").accept.startsWith("image/"));
  assert.ok(ADD_MENU.find(i => i.id === "video").accept.startsWith("video/"));
});
