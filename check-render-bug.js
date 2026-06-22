// Check SVG rendering and coordinate transforms

console.log("=== SVG RENDERING & COORDINATE ANALYSIS ===\n");

console.log("Transform at line 380 in CanvasStudio.jsx:");
console.log("  <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>\n");

console.log("This applies:");
console.log("  1. Translate by (viewport.x, viewport.y)");
console.log("  2. Scale by viewport.zoom");
console.log("  The order MATTERS in SVG!\n");

console.log("SVG transform order: operations apply RIGHT-TO-LEFT");
console.log("  transform=\"translate(x y) scale(z)\" means: scale FIRST, then translate");
console.log("  So a point (px, py) in object coords becomes:");
console.log("    1. (px * z, py * z) after scale");
console.log("    2. (px * z + x, py * z + y) after translate\n");

console.log("But viewport model assumes:");
console.log("  screenX = worldX * zoom + x");
console.log("  screenY = worldY * zoom + y\n");

console.log("Let's verify they match:");
console.log("  SVG: (px * z) + x");
console.log("  Model: px * z + x");
console.log("  ✓ MATCH!\n");

console.log("TEST: Object at world (100, 50), viewport at (200, 300), zoom=2");
console.log("  Expected screen: (100*2 + 200, 50*2 + 300) = (400, 400)");
console.log("  SVG applies: translate(200, 300) scale(2)");
console.log("  To (100, 50): scale gives (200, 100), translate gives (400, 400)");
console.log("  ✓ MATCH!\n");

console.log("Now check CanvasObject rendering (line 471-506):");
console.log("  Each object uses obj.x, obj.y directly");
console.log("  SVG g-transform converts to screen coords");
console.log("  This is CORRECT.\n");

console.log("HOWEVER, check ellipse rendering (line 478-486):");
console.log("  <ellipse");
console.log("    cx={obj.x + obj.width / 2}");
console.log("    cy={obj.y + obj.height / 2}");
console.log("    rx={Math.abs(obj.width / 2)}");
console.log("    ry={Math.abs(obj.height / 2)}");
console.log("    ...");
console.log("  />\n");

console.log("ISSUE ANALYSIS:");
console.log("  Ellipse center is at (x + w/2, y + h/2)");
console.log("  BUT boundsOf for non-arrow returns:");
console.log("    minX: obj.x");
console.log("    minY: obj.y");
console.log("    maxX: obj.x + obj.width");
console.log("    maxY: obj.y + obj.height\n");

console.log("  This assumes the object bounds are a RECTANGLE from (x,y) to (x+w, y+h)");
console.log("  For ellipse, the actual bounds SHOULD be from (x+w/2-w/2, ...) = (x, y)");
console.log("  But it's RENDERED as a circle/ellipse centered at (x+w/2, y+h/2)");
console.log("  with radii (w/2, h/2).\n");

console.log("  The BOUNDS are CORRECT in hitTest sense:");
console.log("  If an ellipse has obj.x=100, obj.y=100, obj.width=80, obj.height=80");
console.log("  Its bounding box is [100, 100, 180, 180]");
console.log("  Its rendered center is (140, 140)");
console.log("  Points within [100,180] x [100,180] COULD hit the ellipse");
console.log("  The hitTest uses bounding box, not ellipse geometry");
console.log("  This is an INTENTIONAL simplification (point-in-bbox not point-in-ellipse)\n");

console.log("VERDICT: Rendering is CORRECT for canvas semantics.");
console.log("         hitTest is INTENTIONALLY bbox-based, not shape-aware.\n");
