// 工具常量与「添加」菜单定义。映射 RoboNeo 底部操作栏的工具组与添加 popover。
// 设计依据：docs/research/2026-06-22-roboneo-canvas-toolbar.md

export const TOOL = {
  SELECT: "select",
  HAND: "hand",
  RECT: "rect",
  ELLIPSE: "ellipse",
  TEXT: "text",
  ARROW: "arrow"
};

// 绘制类工具：选中后进入 armed 态，画完自动回 select。
export const DRAW_TOOLS = ["rect", "ellipse", "text", "arrow"];

export function isDrawTool(tool) {
  return DRAW_TOOLS.includes(tool);
}

// 「添加」popover 菜单：顺序/类型 1:1 对齐 RoboNeo（导入图片/视频 + 文字/矩形/圆形/箭头）。
// kind="import" → 触发文件选择器（带 accept）；kind="draw" → 切换为绘制工具。
export const ADD_MENU = [
  { id: "image", label: "导入图片", kind: "import", accept: "image/*", icon: "▦" },
  { id: "video", label: "导入视频", kind: "import", accept: "video/*", icon: "▷" },
  { id: "text", label: "文字", kind: "draw", icon: "T" },
  { id: "rect", label: "矩形", kind: "draw", icon: "▭" },
  { id: "ellipse", label: "圆形", kind: "draw", icon: "◯" },
  { id: "arrow", label: "箭头", kind: "draw", icon: "↗" }
];

// 工具 → 行业标准快捷键（UI 键盘处理与提示共用）。
export const TOOL_SHORTCUTS = {
  v: TOOL.SELECT,
  h: TOOL.HAND,
  r: TOOL.RECT,
  o: TOOL.ELLIPSE,
  t: TOOL.TEXT,
  a: TOOL.ARROW
};
