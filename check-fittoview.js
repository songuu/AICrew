// Deep dive into fitToView edge cases

import { fitToView, MIN_ZOOM, MAX_ZOOM } from './src/canvas/viewport.js';
import { createShape } from './src/canvas/model.js';

console.log("=== fitToView DEEP ANALYSIS ===\n");

console.log("Function (line 51-66):");
console.log(`export function fitToView(objects, size, padding = 80) {
  const bounds = getBounds(objects);
  if (!bounds || (bounds.width === 0 && bounds.height === 0)) {
    return createViewport();
  }
  const zoomX = (size.width - padding * 2) / (bounds.width || 1);
  const zoomY = (size.height - padding * 2) / (bounds.height || 1);
  const zoom = clampZoom(Math.min(zoomX, zoomY));
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;
  return {
    x: size.width / 2 - centerX * zoom,
    y: size.height / 2 - centerY * zoom,
    zoom
  };
}\n`);

console.log("TEST 1: Edge case - single point object (width=0, height=0)");
const obj1 = createShape("rect", { x: 100, y: 100, width: 0, height: 0 });
const vp1 = fitToView([obj1], { width: 800, height: 600 }, 80);
console.log(`  Bounds: width=0, height=0`);
console.log(`  Condition check (line 53): !bounds || (bounds.width === 0 && bounds.height === 0)`);
console.log(`  Actual: bounds is NOT null (it's a valid bounds object with width: 0, height: 0)`);
console.log(`  So condition triggers: return createViewport()`);
console.log(`  Result: ${JSON.stringify(vp1)}`);
console.log(`  PASS: ${vp1.x === 0 && vp1.y === 0 && vp1.zoom === 1 ? 'YES' : 'NO'}\n`);

console.log("TEST 2: Very thin object (width=0.1, height=100)");
const obj2 = createShape("rect", { x: 0, y: 0, width: 0.1, height: 100 });
const size2 = { width: 800, height: 600 };
const vp2 = fitToView([obj2], size2, 80);
console.log(`  Bounds: width=0.1, height=100`);
console.log(`  zoomX = (800 - 160) / 0.1 = 6400`);
console.log(`  zoomY = (600 - 160) / 100 = 4.4`);
console.log(`  zoom = clampZoom(Math.min(6400, 4.4)) = clampZoom(4.4)`);
console.log(`  Result zoom: ${vp2.zoom}`);
console.log(`  Expected: 4.4`);
console.log(`  PASS: ${vp2.zoom === 4.4 ? 'YES' : 'NO'}\n`);

console.log("TEST 3: Very wide object (width=1000, height=0.1)");
const obj3 = createShape("rect", { x: 0, y: 0, width: 1000, height: 0.1 });
const size3 = { width: 800, height: 600 };
const vp3 = fitToView([obj3], size3, 80);
console.log(`  Bounds: width=1000, height=0.1`);
console.log(`  zoomX = (800 - 160) / 1000 = 0.64`);
console.log(`  zoomY = (600 - 160) / 0.1 = 4400`);
console.log(`  zoom = clampZoom(Math.min(0.64, 4400)) = clampZoom(0.64)`);
console.log(`  Result zoom: ${vp3.zoom}`);
console.log(`  Expected: 0.64`);
console.log(`  PASS: ${vp3.zoom === 0.64 ? 'YES' : 'NO'}\n`);

console.log("TEST 4: zoom clamp behavior - very large objects");
const obj4 = createShape("rect", { x: 0, y: 0, width: 1e10, height: 1e10 });
const size4 = { width: 800, height: 600 };
const vp4 = fitToView([obj4], size4, 80);
console.log(`  Bounds: width=1e10, height=1e10`);
console.log(`  zoomX = (800 - 160) / 1e10 ≈ 6.4e-8`);
console.log(`  zoomY = (600 - 160) / 1e10 ≈ 4.4e-8`);
console.log(`  Math.min ≈ 4.4e-8`);
console.log(`  clampZoom(4.4e-8) = MIN_ZOOM = 0.1`);
console.log(`  Result zoom: ${vp4.zoom}`);
console.log(`  Expected: ${MIN_ZOOM}`);
console.log(`  PASS: ${vp4.zoom === MIN_ZOOM ? 'YES' : 'NO'}\n`);

console.log("TEST 5: Very small viewport");
const obj5 = createShape("rect", { x: 0, y: 0, width: 100, height: 100 });
const size5 = { width: 10, height: 10 };
const vp5 = fitToView([obj5], size5, 2);
console.log(`  Bounds: width=100, height=100`);
console.log(`  zoomX = (10 - 4) / 100 = 0.06`);
console.log(`  zoomY = (10 - 4) / 100 = 0.06`);
console.log(`  zoom = clampZoom(0.06) = MIN_ZOOM = 0.1`);
console.log(`  Result zoom: ${vp5.zoom}`);
console.log(`  Expected: clamped to ${MIN_ZOOM}`);
console.log(`  PASS: ${vp5.zoom === MIN_ZOOM ? 'YES' : 'NO'}\n`);

console.log("TEST 6: Center calculation with offset bounds");
const obj6 = createShape("rect", { x: 1000, y: 2000, width: 200, height: 300 });
const size6 = { width: 800, height: 600 };
const vp6 = fitToView([obj6], size6, 80);
console.log(`  Bounds: minX=1000, minY=2000, width=200, height=300`);
console.log(`  Center: (1100, 2150)`);
console.log(`  Expected x = 400 - 1100*zoom`);
console.log(`  Expected y = 300 - 2150*zoom`);
const expectedX = 400 - 1100 * vp6.zoom;
const expectedY = 300 - 2150 * vp6.zoom;
console.log(`  Actual: ${vp6}`);
console.log(`  PASS: ${Math.abs(vp6.x - expectedX) < 0.01 && Math.abs(vp6.y - expectedY) < 0.01 ? 'YES' : 'NO'}\n`);

console.log("=== fitToView analysis complete ===");
