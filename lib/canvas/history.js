// 通用快照命令栈：undo/redo。与具体场景结构无关（present 可为任意不可变值）。
// history = { past: T[], present: T, future: T[] }。
// 视口 pan/zoom 不入栈——只有对象变更经 commit 进入历史（与 Figma 行为一致）。

export function createHistory(present) {
  return { past: [], present, future: [] };
}

/**
 * 提交新现态：旧现态压入 past，清空 future（新分支废弃 redo）。
 */
export function commit(history, nextPresent) {
  return { past: [...history.past, history.present], present: nextPresent, future: [] };
}

export function undo(history) {
  if (!history.past.length) return history;
  const past = history.past.slice(0, -1);
  const present = history.past[history.past.length - 1];
  return { past, present, future: [history.present, ...history.future] };
}

export function redo(history) {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}
