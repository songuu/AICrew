"use client";

// 真实无限画布工作台：把 RoboNeo 底部操作栏从"皮肤"做成可交互功能。
// 设计依据 docs/research/2026-06-22-roboneo-canvas-toolbar.md。
// 画布自包含：按 storageKey 区分多实例，不 import domain/ai，不污染既有契约。
// 持久化：Supabase 为权威源（经 /api/canvas，按 storageKey 区分），localStorage 作离线缓存兜底。
import { useEffect, useRef, useState } from "react";
import {
  createScene,
  createShape,
  addObject,
  updateObject,
  removeObject,
  reorderObject,
  hitTest,
  boundsOf,
  computeDrawPatch,
  handlePositions,
  hitHandle,
  resizeShape,
  rotateShapeTo,
  HANDLE_ORDER,
  HANDLE_SIGN,
  sanitizeObjects,
  placeGeneratedImage,
  placeGeneratedImages
} from "../../lib/canvas/model.js";
import {
  createViewport,
  screenToWorld,
  panBy,
  zoomBy,
  zoomTo,
  fitToView,
  clampZoom,
  MIN_ZOOM,
  MAX_ZOOM
} from "../../lib/canvas/viewport.js";
import { createHistory, commit, undo, redo, canUndo, canRedo } from "../../lib/canvas/history.js";
import { TOOL, isDrawTool, ADD_MENU, TOOL_SHORTCUTS } from "../../lib/canvas/tools.js";
import { fetchCanvasDoc, pushCanvasDoc, serializeWrite } from "../../lib/storage/remote.js";

const CANVAS_STORAGE_KEY = "aicrew-canvas-v1";

// 选择句柄命中半径与旋转句柄偏移（屏幕像素，使用时按 /zoom 转世界单位）。
const HANDLE_HIT = 7;
const ROTATE_OFFSET = 26;
// 句柄方向 → resize 光标。
const HANDLE_CURSOR = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize"
};

// 点击未拖拽时给绘制图元的兜底尺寸。
const CLICK_SIZE = {
  rect: { width: 160, height: 100 },
  ellipse: { width: 140, height: 140 },
  arrow: { width: 160, height: 0 }
};

function loadScene(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return createScene();
    const parsed = JSON.parse(raw);
    // 复原边界防御：丢弃损坏/被篡改的非法图元，避免下游 hitTest/render 崩溃。
    return createScene(sanitizeObjects(parsed?.objects));
  } catch {
    return createScene();
  }
}

// 导入文件白名单与体积上限：base64 入 localStorage，过大必溢出配额。
const IMPORT_MAX_BYTES = 8 * 1024 * 1024;
const IMPORT_ACCEPT = {
  image: /^image\/(png|jpe?g|gif|webp|avif)$/,
  video: /^video\/(mp4|webm|ogg)$/
};

// onGenerateImage(prompt) -> Promise<imageUrl>：AI 能力由组件层注入，lib/canvas/* 保持零依赖 ai。
// covers：本次任务的封面图 [{src, name}]，供「导入封面」一键铺入。
// 复用契约（统一画布）：
//   storageKey 让同一运行时承载多个独立画布（/canvas 与手动导演台各自一份，互不串）。
//   overlay    为渲染于世界变换组内、随 pan/zoom 缩放的只读 SVG（如 Director 流程节点）。
//   emptyHint  覆盖空态文案：传 ReactNode 自定义、传 null 抑制、不传走默认。
//   className  透传根节点，供嵌入场景（手动 stage）改写尺寸布局。
export function CanvasStudio({
  onGenerateImage,
  covers = [],
  storageKey = CANVAS_STORAGE_KEY,
  overlay = null,
  emptyHint,
  className = ""
}) {
  const [history, setHistory] = useState(() => createHistory(createScene()));
  // 水合门：初始空场景在异步载入完成前不得回写，否则会用空画布覆盖 Supabase 已存数据。
  const [hydrated, setHydrated] = useState(false);
  const [viewport, setViewport] = useState(() => createViewport());
  const [tool, setTool] = useState(TOOL.SELECT);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(true);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [notice, setNotice] = useState("");
  const [hoverHandle, setHoverHandle] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  const svgRef = useRef(null);
  const fileRef = useRef(null);
  const importKindRef = useRef("image");
  const gestureRef = useRef(null);

  const scene = draft || history.present;
  const selected = scene.objects.find(obj => obj.id === selectedId) || null;

  // 镜像最新值给只绑定一次的 window 键盘监听器使用（删除时读最新选中）。
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // 载入持久化场景：Supabase 权威源，失败/空回退 localStorage。storageKey 变更（切换承载画布）时重载。
  useEffect(() => {
    let alive = true;
    setHydrated(false);
    (async () => {
      let scene = null;
      try {
        const doc = await fetchCanvasDoc(storageKey);
        if (doc) scene = createScene(sanitizeObjects(doc?.objects));
      } catch {
        scene = null; // 服务端不可达 → 本地兜底
      }
      if (!scene) scene = loadScene(storageKey);
      if (!alive) return;
      setHistory(createHistory(scene));
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, [storageKey]);

  // 仅持久化已提交现态（视口/draft 不入存储）。本地缓存 + 防抖上云。水合完成前不回写（防空覆盖）。
  useEffect(() => {
    if (!hydrated) return undefined;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(history.present));
    } catch {
      // 内存态不受影响，仅本次未落本地缓存；告知用户避免误以为已保存。
      setNotice("存储空间不足，本次改动未能本地保存（画布仍可继续编辑，建议删减大图）。");
    }
    const handle = setTimeout(() => {
      // 串行化：与主组件共用写队列，保证多次防抖写按发起顺序落库，不乱序覆写。
      serializeWrite(() => pushCanvasDoc(storageKey, history.present)).catch(() => {});
    }, 600);
    return () => clearTimeout(handle);
  }, [history.present, storageKey, hydrated]);

  // 添加菜单：点击菜单外部自动关闭（RoboNeo popover 约定）。
  useEffect(() => {
    if (!addOpen) return undefined;
    const onDocClick = event => {
      if (!event.target.closest?.(".canvas-add")) setAddOpen(false);
    };
    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  }, [addOpen]);

  // 滚轮缩放（绕光标）。原生非被动监听以可 preventDefault，避免页面滚动。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = event => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const center = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewport(prev => zoomBy(prev, factor, center));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 键盘：空格临时平移、撤销/重做、删除、工具快捷键、Esc。
  useEffect(() => {
    const onKeyDown = event => {
      const target = event.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const mod = event.metaKey || event.ctrlKey;

      if (event.code === "Space") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        cancelGesture(); // 取消进行中手势，避免 pointerUp 提交早于 undo 的旧 workScene
        setHistory(event.shiftKey ? redo : undo);
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        cancelGesture();
        setHistory(redo);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (gestureRef.current) return; // 手势进行中不删除，避免状态错乱
        if (selectedIdRef.current) {
          event.preventDefault();
          const id = selectedIdRef.current;
          setHistory(h => commit(h, removeObject(h.present, id)));
          setSelectedId(null);
        }
        return;
      }
      if (event.key === "Escape") {
        setTool(TOOL.SELECT);
        setAddOpen(false);
        setSelectedId(null);
        return;
      }
      if (!mod && TOOL_SHORTCUTS[event.key.toLowerCase()]) {
        setTool(TOOL_SHORTCUTS[event.key.toLowerCase()]);
      }
    };
    const onKeyUp = event => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  function viewSize() {
    const rect = svgRef.current?.getBoundingClientRect();
    return { width: rect?.width || 800, height: rect?.height || 600 };
  }

  function pointerToScreen(event) {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function commitScene(nextScene) {
    setHistory(h => commit(h, nextScene));
  }

  // 取消进行中手势：丢弃 draft 与 gesture ref（用于 undo/redo 打断拖拽）。
  function cancelGesture() {
    gestureRef.current = null;
    setDraft(null);
  }

  // ---------- 指针手势 ----------

  function onPointerDown(event) {
    if (event.button === 2) return; // 右键留给浏览器/未来菜单
    svgRef.current.setPointerCapture(event.pointerId);
    const screen = pointerToScreen(event);
    const world = screenToWorld(viewport, screen.x, screen.y);
    const panning = tool === TOOL.HAND || spaceHeld || event.button === 1;

    if (panning) {
      gestureRef.current = { mode: "pan", startScreen: screen, startViewport: viewport };
      return;
    }

    // 选择工具下优先命中已选对象的缩放/旋转句柄（arrow 无句柄）。
    if (tool === TOOL.SELECT && selected && selected.type !== "arrow" && !selected.hidden) {
      const threshold = HANDLE_HIT / viewport.zoom;
      const rotateOffsetWorld = ROTATE_OFFSET / viewport.zoom;
      const handle = hitHandle(selected, world.x, world.y, threshold, rotateOffsetWorld);
      if (handle === "rotate") {
        gestureRef.current = { mode: "rotate", id: selected.id, baseScene: scene, workScene: scene };
        return;
      }
      if (handle) {
        gestureRef.current = { mode: "resize", handle, id: selected.id, baseScene: scene, workScene: scene };
        return;
      }
    }

    if (isDrawTool(tool)) {
      if (tool === TOOL.TEXT) {
        const shape = createShape("text", { x: world.x, y: world.y, text: "文本", name: "文本" });
        commitScene(addObject(scene, shape));
        setSelectedId(shape.id);
        setTool(TOOL.SELECT);
        return;
      }
      const shape = createShape(tool, { x: world.x, y: world.y, width: 0, height: 0 });
      const baseScene = addObject(scene, shape);
      // 在手势内固定 tool，避免拖拽中途切换工具导致图元类型错配。
      gestureRef.current = { mode: "draw", tool, id: shape.id, startWorld: world, baseScene, workScene: baseScene };
      setDraft(baseScene);
      return;
    }

    // 选择工具：命中即选中并准备移动；空白清空选择。
    const hitId = hitTest(scene, world.x, world.y);
    setSelectedId(hitId);
    if (hitId) {
      gestureRef.current = { mode: "move", id: hitId, last: world, baseScene: scene, workScene: scene, moved: false };
    }
  }

  // 无手势时：检测指针是否悬停在句柄上，更新光标（仅在变化时 setState，避免移动churn）。
  function updateHoverCursor(event) {
    if (tool !== TOOL.SELECT || spaceHeld || !selected || selected.type === "arrow" || selected.hidden) {
      if (hoverHandle) setHoverHandle(null);
      return;
    }
    const screen = pointerToScreen(event);
    const world = screenToWorld(viewport, screen.x, screen.y);
    const handle = hitHandle(selected, world.x, world.y, HANDLE_HIT / viewport.zoom, ROTATE_OFFSET / viewport.zoom);
    if (handle !== hoverHandle) setHoverHandle(handle);
  }

  function onPointerMove(event) {
    const gesture = gestureRef.current;
    if (!gesture) {
      updateHoverCursor(event);
      return;
    }
    const screen = pointerToScreen(event);

    if (gesture.mode === "pan") {
      setViewport(panBy(gesture.startViewport, screen.x - gesture.startScreen.x, screen.y - gesture.startScreen.y));
      return;
    }

    const world = screenToWorld(viewport, screen.x, screen.y);

    if (gesture.mode === "resize") {
      const target = gesture.baseScene.objects.find(o => o.id === gesture.id);
      const next = updateObject(gesture.baseScene, gesture.id, resizeShape(target, gesture.handle, world.x, world.y));
      gesture.workScene = next;
      setDraft(next);
      return;
    }

    if (gesture.mode === "rotate") {
      const target = gesture.baseScene.objects.find(o => o.id === gesture.id);
      const next = updateObject(gesture.baseScene, gesture.id, rotateShapeTo(target, world.x, world.y, event.shiftKey ? 15 : 0));
      gesture.workScene = next;
      setDraft(next);
      return;
    }

    if (gesture.mode === "draw") {
      const patch = computeDrawPatch(gesture.tool, gesture.startWorld, world);
      const next = updateObject(gesture.baseScene, gesture.id, patch);
      gesture.workScene = next;
      setDraft(next);
      return;
    }

    if (gesture.mode === "move") {
      const dx = world.x - gesture.last.x;
      const dy = world.y - gesture.last.y;
      gesture.last = world;
      gesture.moved = true;
      const next = {
        ...gesture.workScene,
        objects: gesture.workScene.objects.map(obj => (obj.id === gesture.id ? { ...obj, x: obj.x + dx, y: obj.y + dy } : obj))
      };
      gesture.workScene = next;
      setDraft(next);
    }
  }

  function onPointerUp(event) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    try {
      svgRef.current.releasePointerCapture(event.pointerId);
    } catch {
      // 指针已释放：忽略。
    }

    if (gesture.mode === "pan") return;

    if (gesture.mode === "resize" || gesture.mode === "rotate") {
      if (gesture.workScene !== gesture.baseScene) commitScene(gesture.workScene);
      setDraft(null);
      return;
    }

    if (gesture.mode === "draw") {
      let finalScene = gesture.workScene;
      const obj = finalScene.objects.find(o => o.id === gesture.id);
      const tiny = obj && Math.abs(obj.width) < 4 && Math.abs(obj.height) < 4;
      if (tiny) {
        const size = CLICK_SIZE[obj.type] || { width: 120, height: 80 };
        finalScene = updateObject(finalScene, gesture.id, size);
      }
      commitScene(finalScene);
      setDraft(null);
      setSelectedId(gesture.id);
      setTool(TOOL.SELECT);
      return;
    }

    if (gesture.mode === "move") {
      if (gesture.moved) commitScene(gesture.workScene);
      setDraft(null);
    }
  }

  function onDoubleClick(event) {
    const screen = pointerToScreen(event);
    const world = screenToWorld(viewport, screen.x, screen.y);
    const id = hitTest(scene, world.x, world.y);
    const obj = scene.objects.find(o => o.id === id);
    if (obj?.type === "text") {
      const next = window.prompt("编辑文字", obj.text);
      if (next != null) {
        commitScene(updateObject(scene, id, { text: next, name: next.slice(0, 12) || "文本" }));
      }
    }
  }

  // ---------- 添加 / 导入 ----------

  function handleAddItem(item) {
    setAddOpen(false);
    if (item.kind === "draw") {
      setTool(item.id);
      return;
    }
    importKindRef.current = item.id;
    if (fileRef.current) {
      fileRef.current.accept = item.accept;
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  // AI 生成图落画布：prompt → 注入的 onGenerateImage → placeGeneratedImage 单次 commit（一手势一历史）。
  async function generateOnCanvas() {
    setAddOpen(false);
    if (!onGenerateImage || aiBusy) return;
    const prompt = window.prompt("描述要生成的图像，例如：露营灯产品场景图");
    if (!prompt || !prompt.trim()) return;
    setAiBusy(true);
    setNotice("正在生成图像…");
    try {
      const src = await onGenerateImage(prompt.trim());
      if (!src) {
        setNotice("生成失败，请重试");
        return;
      }
      const size = viewSize();
      const center = screenToWorld(viewport, size.width / 2, size.height / 2);
      const placed = placeGeneratedImage(scene, {
        src,
        name: prompt.trim().slice(0, 20),
        box: { x: center.x - 120, y: center.y - 80 }
      });
      setHistory(h => commit(h, placed));
      setSelectedId(placed.objects.at(-1).id);
      setNotice("");
    } catch (error) {
      setNotice("生成失败：" + (error?.message || "未知错误"));
    } finally {
      setAiBusy(false);
    }
  }

  // 一键把本次任务的多张封面网格铺入画布（整批单次 commit → 一步撤销）。
  function importCovers() {
    setAddOpen(false);
    const items = (covers || []).filter(cover => cover && cover.src);
    if (!items.length) {
      setNotice("当前任务还没有封面图，先去工作台生成。");
      return;
    }
    const size = viewSize();
    const origin = screenToWorld(viewport, size.width / 2, size.height / 2);
    setHistory(h => commit(h, placeGeneratedImages(h.present, items, { startX: origin.x - 260, startY: origin.y - 90, columns: 3 })));
  }

  function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const kind = importKindRef.current;
    const accept = IMPORT_ACCEPT[kind] || IMPORT_ACCEPT.image;
    // 输入边界校验：MIME 白名单（拒 SVG 等可疑类型）+ 体积上限（防 base64 撑爆配额）。
    if (!accept.test(file.type)) {
      setNotice(`不支持的文件类型：${file.type || "未知"}`);
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setNotice(`文件过大（${(file.size / 1048576).toFixed(1)}MB），上限 8MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      const size = viewSize();
      const center = screenToWorld(viewport, size.width / 2, size.height / 2);
      const type = kind === "video" ? "video" : "image";
      const shape = createShape(type, { x: center.x - 120, y: center.y - 80, src, name: file.name });
      // functional updater：异步 onload 期间 history 可能已变，取最新现态合并，避免竞态丢编辑。
      setHistory(h => commit(h, addObject(h.present, shape)));
      setSelectedId(shape.id);
    };
    reader.onerror = () => {
      setNotice("文件读取失败，请重试或更换文件。");
    };
    reader.readAsDataURL(file);
  }

  // ---------- 视口操作 ----------

  function center() {
    const size = viewSize();
    return { x: size.width / 2, y: size.height / 2 };
  }
  const zoomInBtn = () => setViewport(prev => zoomBy(prev, 1.2, center()));
  const zoomOutBtn = () => setViewport(prev => zoomBy(prev, 1 / 1.2, center()));
  const resetZoom = () => setViewport(prev => zoomTo(prev, 1, center()));
  const fitAll = () => setViewport(fitToView(scene.objects, viewSize(), 80));

  // ---------- 图层操作 ----------

  const toggleHidden = id => commitScene(updateObject(scene, id, { hidden: !scene.objects.find(o => o.id === id)?.hidden }));
  const reorder = (id, direction) => commitScene(reorderObject(scene, id, direction));
  const removeLayer = id => {
    commitScene(removeObject(scene, id));
    if (selectedId === id) setSelectedId(null);
  };

  const cursorClass = tool === TOOL.HAND || spaceHeld ? "is-pan" : isDrawTool(tool) ? "is-draw" : "is-select";
  const handleCursor = hoverHandle ? (hoverHandle === "rotate" ? "grab" : HANDLE_CURSOR[hoverHandle]) : null;
  const zoomPercent = Math.round(viewport.zoom * 100);

  return (
    <div className={`canvas-view ${className}`.trim()}>
      <input ref={fileRef} type="file" hidden onChange={onFileChange} aria-hidden="true" />

      <svg
        ref={svgRef}
        className={`canvas-surface ${cursorClass}`}
        style={handleCursor ? { cursor: handleCursor } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={event => event.preventDefault()}
      >
        <defs>
          <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#fdcb6e" />
          </marker>
          <pattern id="canvas-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.08)" />
          </pattern>
        </defs>
        <rect className="canvas-bg" x="0" y="0" width="100%" height="100%" fill="url(#canvas-grid)" />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {/* 只读 overlay（如 Director 流程节点）：渲染于对象之下、随视口缩放、不拦截指针，
              使画布的选择/绘制手势可穿透落到空白处。 */}
          {overlay && (
            <g className="canvas-overlay" style={{ pointerEvents: "none" }}>
              {overlay}
            </g>
          )}
          {scene.objects.map(obj => (
            <CanvasObject key={obj.id} obj={obj} />
          ))}
          {selected && !selected.hidden && <SelectionBox obj={selected} zoom={viewport.zoom} />}
        </g>
      </svg>

      {scene.objects.length === 0 && emptyHint !== null && (
        <div className="canvas-empty">
          {emptyHint || (
            <>
              <strong>空白画布</strong>
              <span>点「添加」插入图元/图片，或按 R/O/T/A 直接绘制</span>
            </>
          )}
        </div>
      )}

      {notice && (
        <div className="canvas-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      {/* 中下「工具坞」：工具组 + 历史组 */}
      <div className="canvas-tool-dock" role="toolbar" aria-label="画布工具">
        <ToolButton active={tool === TOOL.SELECT} label="选择" icon="⌖" onClick={() => setTool(TOOL.SELECT)} />
        <ToolButton active={tool === TOOL.HAND || spaceHeld} label="抓手" icon="✋" onClick={() => setTool(TOOL.HAND)} />
        <div className="canvas-add">
          <ToolButton active={isDrawTool(tool) || addOpen} label="添加" icon="＋" caret onClick={() => setAddOpen(open => !open)} />
          {addOpen && (
            <div className="canvas-add-menu" role="menu">
              {ADD_MENU.map(item => (
                <button key={item.id} type="button" role="menuitem" onClick={() => handleAddItem(item)}>
                  <span className="add-icon">{item.icon}</span>
                  <em>{item.label}</em>
                </button>
              ))}
              {onGenerateImage && (
                <button type="button" role="menuitem" onClick={generateOnCanvas} disabled={aiBusy}>
                  <span className="add-icon">✨</span>
                  <em>{aiBusy ? "生成中…" : "AI 生成图"}</em>
                </button>
              )}
              {covers.length > 0 && (
                <button type="button" role="menuitem" onClick={importCovers}>
                  <span className="add-icon">▦</span>
                  <em>导入本次封面</em>
                </button>
              )}
            </div>
          )}
        </div>
        <i className="dock-sep" />
        <ToolButton disabled={!canUndo(history)} label="撤销" icon="↶" onClick={() => setHistory(undo)} />
        <ToolButton disabled={!canRedo(history)} label="重做" icon="↷" onClick={() => setHistory(redo)} />
      </div>

      {/* 右下「视图坞」：缩放 + 适应 + 图层 */}
      <div className="canvas-view-dock" aria-label="视图操作">
        <button type="button" className="zoom-step" onClick={zoomOutBtn} disabled={viewport.zoom <= MIN_ZOOM} aria-label="缩小">
          −
        </button>
        <button type="button" className="zoom-value" onClick={resetZoom} title="点击重置 100%">
          {zoomPercent}%
        </button>
        <button type="button" className="zoom-step" onClick={zoomInBtn} disabled={viewport.zoom >= MAX_ZOOM} aria-label="放大">
          ＋
        </button>
        <i className="dock-sep" />
        <button type="button" className="view-op" onClick={fitAll}>
          <span>⤢</span>
          <em>显示全部</em>
        </button>
        <button type="button" className={`view-op ${layersOpen ? "active" : ""}`} onClick={() => setLayersOpen(open => !open)}>
          <span>▦</span>
          <em>图层</em>
        </button>
      </div>

      {layersOpen && (
        <LayersPanel
          objects={scene.objects}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleHidden={toggleHidden}
          onReorder={reorder}
          onRemove={removeLayer}
        />
      )}
    </div>
  );
}

function ToolButton({ active, disabled, label, icon, caret, onClick }) {
  return (
    <button
      type="button"
      className={`dock-tool ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      <span className="dock-icon">
        {icon}
        {caret && <i className="dock-caret">▾</i>}
      </span>
      <em>{label}</em>
    </button>
  );
}

function CanvasObject({ obj }) {
  if (obj.hidden) return null;
  const shape = renderShape(obj);
  const rot = obj.rotation || 0;
  if (!rot) return shape;
  const b = boundsOf(obj);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return <g transform={`rotate(${rot} ${cx} ${cy})`}>{shape}</g>;
}

function renderShape(obj) {
  const stroke = { stroke: obj.stroke, strokeWidth: 2, vectorEffect: "non-scaling-stroke" };
  switch (obj.type) {
    case "rect":
      return <rect x={obj.x} y={obj.y} width={obj.width} height={obj.height} rx="10" fill={obj.fill} {...stroke} />;
    case "ellipse":
      return (
        <ellipse
          cx={obj.x + obj.width / 2}
          cy={obj.y + obj.height / 2}
          rx={Math.abs(obj.width / 2)}
          ry={Math.abs(obj.height / 2)}
          fill={obj.fill}
          {...stroke}
        />
      );
    case "text":
      return (
        <text x={obj.x} y={obj.y + (obj.fontSize || 28)} fontSize={obj.fontSize} fill={obj.fill} style={{ userSelect: "none" }}>
          {obj.text}
        </text>
      );
    case "arrow":
      return (
        <line
          x1={obj.x}
          y1={obj.y}
          x2={obj.x + obj.width}
          y2={obj.y + obj.height}
          stroke={obj.stroke}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
          markerEnd="url(#canvas-arrow)"
        />
      );
    case "image":
      return (
        <image href={obj.src} x={obj.x} y={obj.y} width={obj.width} height={obj.height} preserveAspectRatio="xMidYMid slice" />
      );
    case "video":
      return (
        <foreignObject x={obj.x} y={obj.y} width={obj.width} height={obj.height}>
          <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", background: "#000" }}>
            {obj.src ? (
              <video src={obj.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} controls muted />
            ) : (
              <span style={{ color: "#fff" }}>视频</span>
            )}
          </div>
        </foreignObject>
      );
    default:
      return null;
  }
}

function SelectionBox({ obj, zoom }) {
  const b = boundsOf(obj);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const rot = obj.rotation || 0;
  const showHandles = obj.type !== "arrow";
  const hs = HANDLE_HIT / zoom; // 句柄视觉半边长（世界单位，保持屏幕恒定大小）
  const rotateOffset = ROTATE_OFFSET / zoom;
  const content = (
    <>
      <rect
        x={b.minX}
        y={b.minY}
        width={w}
        height={h}
        fill="none"
        stroke="#74b9ff"
        strokeWidth="1.5"
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      {showHandles && (
        <>
          <line
            x1={cx}
            y1={b.minY}
            x2={cx}
            y2={b.minY - rotateOffset}
            stroke="#74b9ff"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <circle cx={cx} cy={b.minY - rotateOffset} r={hs} fill="#74b9ff" pointerEvents="none" />
          {HANDLE_ORDER.map(key => {
            const [sx, sy] = HANDLE_SIGN[key];
            const hx = cx + sx * (w / 2);
            const hy = cy + sy * (h / 2);
            return (
              <rect
                key={key}
                x={hx - hs}
                y={hy - hs}
                width={hs * 2}
                height={hs * 2}
                fill="#ffffff"
                stroke="#74b9ff"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            );
          })}
        </>
      )}
    </>
  );
  return rot ? <g transform={`rotate(${rot} ${cx} ${cy})`}>{content}</g> : content;
}

const TYPE_ICON = { rect: "▭", ellipse: "◯", text: "T", arrow: "↗", image: "▦", video: "▷" };

function LayersPanel({ objects, selectedId, onSelect, onToggleHidden, onReorder, onRemove }) {
  // 顶层在上：数组末尾=最上层，故倒序展示。
  const rows = [...objects].reverse();
  return (
    <aside className="canvas-layers" aria-label="图层面板">
      <header>
        <strong>图层</strong>
        <span>{objects.length}</span>
      </header>
      {rows.length === 0 && <p className="layers-empty">暂无图层</p>}
      <ul>
        {rows.map(obj => {
          // 数组序=层序（末尾=顶层）。边界按钮 disabled 避免无效点击的假反馈。
          const index = objects.findIndex(item => item.id === obj.id);
          const canMoveUp = index < objects.length - 1;
          const canMoveDown = index > 0;
          return (
            <li key={obj.id} className={obj.id === selectedId ? "active" : ""}>
              <button type="button" className="layer-main" onClick={() => onSelect(obj.id)}>
                <span className="layer-icon">{TYPE_ICON[obj.type] || "▢"}</span>
                <em className={obj.hidden ? "muted" : ""}>{obj.name}</em>
              </button>
              <div className="layer-actions">
                <button type="button" title="显隐" onClick={() => onToggleHidden(obj.id)}>
                  {obj.hidden ? "◌" : "◉"}
                </button>
                <button type="button" title="上移一层" disabled={!canMoveUp} onClick={() => onReorder(obj.id, "up")}>
                  ↑
                </button>
                <button type="button" title="下移一层" disabled={!canMoveDown} onClick={() => onReorder(obj.id, "down")}>
                  ↓
                </button>
                <button type="button" title="删除" onClick={() => onRemove(obj.id)}>
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
