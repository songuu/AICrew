// 画布对象模型：纯函数、不可变。无 DOM 依赖，可在 node --test 下完整验证。
// 场景 scene = { objects: Shape[] }，数组顺序即 z-order（末尾=最上层）。

export const SHAPE_TYPES = ["rect", "ellipse", "text", "arrow", "image", "video"];

const LABELS = { rect: "矩形", ellipse: "圆形", text: "文字", arrow: "箭头", image: "图片", video: "视频" };

// 各类型默认视觉属性（创建即可见，避免空尺寸图元）。
const DEFAULTS = {
  rect: { width: 160, height: 100, fill: "#6c5ce7", stroke: "#aeb4ff" },
  ellipse: { width: 140, height: 140, fill: "#00b894", stroke: "#9ef5dd" },
  text: { text: "文本", fontSize: 28, fill: "#f5f6fa", width: 160, height: 40 },
  arrow: { width: 180, height: 0, stroke: "#fdcb6e" },
  image: { width: 240, height: 160, src: "", name: "图片" },
  video: { width: 280, height: 160, src: "", name: "视频" }
};

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `obj_${idSeq}_${Math.random().toString(36).slice(2, 7)}`;
}

function labelFor(type) {
  return LABELS[type] || type;
}

/**
 * 创建图元。未知类型显式抛错（输入边界校验）。
 * @param {string} type SHAPE_TYPES 之一
 * @param {object} props 覆盖默认（可含 id；不传则自动生成）
 */
export function createShape(type, props = {}) {
  if (!SHAPE_TYPES.includes(type)) {
    throw new Error(`未知图元类型：${type}`);
  }
  const id = props.id || nextId();
  return {
    x: 0,
    y: 0,
    rotation: 0,
    hidden: false,
    name: labelFor(type),
    ...DEFAULTS[type],
    ...props,
    id,
    type
  };
}

const DEG = Math.PI / 180;

// 缩放句柄顺序与方向符号（句柄相对中心的单位位置）。
export const HANDLE_ORDER = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const HANDLE_SIGN = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0]
};

// 缩放最小尺寸（世界单位），防止图元被拖成 0/负。
export const MIN_SIZE = 10;

/**
 * 绕中心旋转一个点。deg=0 时原样返回（避免无谓浮点误差）。
 */
export function rotatePoint(px, py, cx, cy, deg) {
  if (!deg) return { x: px, y: py };
  const r = deg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * 图元中心（基于未旋转包围盒）。
 */
export function centerOf(obj) {
  const b = boundsOf(obj);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function createScene(objects = []) {
  return { objects: [...objects] };
}

/**
 * 校验单个图元是否合法（复原 localStorage 时的输入边界防御）。
 * 必须有字符串 id、已知 type、有限数值 x/y——否则下游 hitTest/boundsOf/渲染会崩。
 */
export function isValidShape(obj) {
  return (
    !!obj &&
    typeof obj === "object" &&
    typeof obj.id === "string" &&
    SHAPE_TYPES.includes(obj.type) &&
    Number.isFinite(obj.x) &&
    Number.isFinite(obj.y)
  );
}

/**
 * 过滤掉损坏/被篡改的图元，绝不信任反序列化数据。
 */
export function sanitizeObjects(objects) {
  return Array.isArray(objects) ? objects.filter(isValidShape) : [];
}

export function addObject(scene, shape) {
  return { ...scene, objects: [...scene.objects, shape] };
}

// 把一张生成/导入的图作为 image 图元放入场景（末尾=最上层）。box 可选定位/尺寸。
// 纯函数；AI 调用本身由组件层完成后把结果 src 传入，保持 lib/canvas 零依赖 ai。
export function placeGeneratedImage(scene, { src, name = "AI 生成图", box } = {}) {
  const props = { src, name, aiGenerated: true };
  if (box) Object.assign(props, box);
  return addObject(scene, createShape("image", props));
}

// 批量网格铺入多张图，返回单个新场景（配合一次 history.commit 守 undo 原子性：N 张一步撤销）。
export function placeGeneratedImages(scene, items, options = {}) {
  const { startX = 0, startY = 0, cellWidth = 240, cellHeight = 160, gap = 20, columns = 3 } = options;
  let next = scene;
  (items || []).forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    next = placeGeneratedImage(next, {
      src: item.src,
      name: item.name,
      box: {
        x: startX + column * (cellWidth + gap),
        y: startY + row * (cellHeight + gap),
        width: cellWidth,
        height: cellHeight
      }
    });
  });
  return next;
}

export function updateObject(scene, id, patch) {
  return {
    ...scene,
    objects: scene.objects.map(obj => (obj.id === id ? { ...obj, ...patch } : obj))
  };
}

export function moveObject(scene, id, dx, dy) {
  return {
    ...scene,
    objects: scene.objects.map(obj => (obj.id === id ? { ...obj, x: obj.x + dx, y: obj.y + dy } : obj))
  };
}

export function removeObject(scene, id) {
  return { ...scene, objects: scene.objects.filter(obj => obj.id !== id) };
}

/**
 * 调整 z-order。direction="up" 向数组末尾（更靠上层），"down" 反之。
 * 越界为安全 no-op。
 */
export function reorderObject(scene, id, direction) {
  const index = scene.objects.findIndex(obj => obj.id === id);
  if (index === -1) return scene;
  const target = direction === "up" ? index + 1 : index - 1;
  if (target < 0 || target >= scene.objects.length) return scene;
  const objects = [...scene.objects];
  [objects[index], objects[target]] = [objects[target], objects[index]];
  return { ...scene, objects };
}

/**
 * 单对象包围盒（世界坐标）。arrow 用起止线段，其余用矩形框。
 */
export function boundsOf(obj) {
  if (obj.type === "arrow") {
    const x2 = obj.x + (obj.width || 0);
    const y2 = obj.y + (obj.height || 0);
    return {
      minX: Math.min(obj.x, x2),
      minY: Math.min(obj.y, y2),
      maxX: Math.max(obj.x, x2),
      maxY: Math.max(obj.y, y2)
    };
  }
  return {
    minX: obj.x,
    minY: obj.y,
    maxX: obj.x + (obj.width || 0),
    maxY: obj.y + (obj.height || 0)
  };
}

/**
 * 旋转后的世界轴对齐包围盒（4 角旋转后取 min/max）。rotation=0 时等于 boundsOf。
 */
export function worldBounds(obj) {
  const b = boundsOf(obj);
  const rot = obj.rotation || 0;
  if (!rot) {
    return { ...b, width: b.maxX - b.minX, height: b.maxY - b.minY };
  }
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const corners = [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY]
  ].map(([x, y]) => rotatePoint(x, y, cx, cy, rot));
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * 聚合可见对象包围盒（旋转感知）。无可见对象返回 null。
 */
export function getBounds(objects) {
  const visible = objects.filter(obj => !obj.hidden);
  if (!visible.length) return null;
  let acc = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const obj of visible) {
    const b = worldBounds(obj);
    acc = {
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY)
    };
  }
  return { ...acc, width: acc.maxX - acc.minX, height: acc.maxY - acc.minY };
}

/**
 * 选择句柄的世界坐标：8 个缩放句柄 + 1 个旋转句柄（rotate，位于顶边上方 rotateOffset）。
 * 全部按 obj.rotation 绕中心旋转，使句柄贴合旋转后的图元。
 */
export function handlePositions(obj, rotateOffset = 26) {
  const b = boundsOf(obj);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const halfW = (b.maxX - b.minX) / 2;
  const halfH = (b.maxY - b.minY) / 2;
  const rot = obj.rotation || 0;
  const out = {};
  for (const key of HANDLE_ORDER) {
    const [sx, sy] = HANDLE_SIGN[key];
    out[key] = rotatePoint(cx + sx * halfW, cy + sy * halfH, cx, cy, rot);
  }
  out.rotate = rotatePoint(cx, b.minY - rotateOffset, cx, cy, rot);
  return out;
}

/**
 * 命中哪个句柄（含 rotate）。返回句柄 key 或 null。threshold/rotateOffset 为世界单位。
 */
export function hitHandle(obj, worldX, worldY, threshold, rotateOffset = 26) {
  const pos = handlePositions(obj, rotateOffset);
  // 优先 rotate，再角点/边点。
  const keys = ["rotate", ...HANDLE_ORDER];
  for (const key of keys) {
    const p = pos[key];
    if (Math.abs(worldX - p.x) <= threshold && Math.abs(worldY - p.y) <= threshold) {
      return key;
    }
  }
  return null;
}

/**
 * 缩放：拖动 handle 到 (worldX,worldY)，保持对角/对边锚点的世界位置不变（旋转感知）。
 * 在图元本地（未旋转）坐标系内计算新尺寸，再重定位中心使锚点不动。文本同步缩放 fontSize。
 * @returns {object} patch（x/y/width/height[/fontSize]）
 */
export function resizeShape(obj, handle, worldX, worldY) {
  const [sx, sy] = HANDLE_SIGN[handle];
  const b = boundsOf(obj);
  const w0 = b.maxX - b.minX;
  const h0 = b.maxY - b.minY;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rot = obj.rotation || 0;
  // 锚点 = 对侧句柄当前世界位置（缩放期间固定不动）。
  const anchorWorld = rotatePoint(cx - sx * w0 / 2, cy - sy * h0 / 2, cx, cy, rot);
  // 指针相对锚点、旋转回本地轴的位移。
  const localPointer = rotatePoint(worldX, worldY, anchorWorld.x, anchorWorld.y, -rot);
  const dx = localPointer.x - anchorWorld.x;
  const dy = localPointer.y - anchorWorld.y;
  const newW = sx !== 0 ? Math.max(MIN_SIZE, dx * sx) : w0;
  const newH = sy !== 0 ? Math.max(MIN_SIZE, dy * sy) : h0;
  // 新中心：锚点 + 旋转后的 (handleSign * newSize/2)。
  const offset = rotatePoint(sx * newW / 2, sy * newH / 2, 0, 0, rot);
  const newCx = anchorWorld.x + offset.x;
  const newCy = anchorWorld.y + offset.y;
  const patch = {
    x: newCx - newW / 2,
    y: newCy - newH / 2,
    width: newW,
    height: newH
  };
  if (obj.type === "text") {
    patch.fontSize = Math.max(8, Math.round((obj.fontSize || 28) * (newH / (h0 || 1))));
  }
  return patch;
}

/**
 * 旋转：使旋转句柄朝向指针。snap>0 时吸附到该角度的整数倍。返回 {rotation} patch（度，[0,360)）。
 */
export function rotateShapeTo(obj, worldX, worldY, snap = 0) {
  const c = centerOf(obj);
  let deg = (Math.atan2(worldY - c.y, worldX - c.x) * 180) / Math.PI + 90;
  if (snap > 0) deg = Math.round(deg / snap) * snap;
  return { rotation: ((deg % 360) + 360) % 360 };
}

/**
 * 由起点 + 当前点计算绘制图元的几何 patch（世界坐标）。
 * arrow 保留有符号 width/height 以记录方向；矩形/椭圆归一化为左上角 + 正尺寸，
 * 故无论从哪个方向拖拽都得到一致的正向包围盒。
 * @param {string} tool 工具类型（"arrow" 走方向分支，其余归一化）
 * @param {{x:number,y:number}} start 起点世界坐标
 * @param {{x:number,y:number}} current 当前点世界坐标
 */
export function computeDrawPatch(tool, start, current) {
  if (tool === "arrow") {
    return { x: start.x, y: start.y, width: current.x - start.x, height: current.y - start.y };
  }
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}

/**
 * 命中测试：返回最上层命中对象 id，空白返回 null。arrow 给 8px 容差。
 */
export function hitTest(scene, worldX, worldY) {
  for (let i = scene.objects.length - 1; i >= 0; i--) {
    const obj = scene.objects[i];
    if (obj.hidden) continue;
    const b = boundsOf(obj);
    const pad = obj.type === "arrow" ? 8 : 0;
    // 旋转感知：把测试点旋转回图元本地（未旋转）坐标系，再做 AABB 命中。
    let px = worldX;
    let py = worldY;
    const rot = obj.rotation || 0;
    if (rot) {
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const local = rotatePoint(worldX, worldY, cx, cy, -rot);
      px = local.x;
      py = local.y;
    }
    if (px >= b.minX - pad && px <= b.maxX + pad && py >= b.minY - pad && py <= b.maxY + pad) {
      return obj.id;
    }
  }
  return null;
}
