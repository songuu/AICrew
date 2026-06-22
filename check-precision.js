// Check floating point precision in viewport math

import { screenToWorld, worldToScreen, zoomTo } from './src/canvas/viewport.js';

console.log("=== FLOATING POINT PRECISION ANALYSIS ===\n");

// TEST 1: Large coordinate values
console.log("TEST 1: Large world coordinates");
const vp1 = { x: 1e6, y: 1e6, zoom: 1 };
const w1 = { x: 1e6, y: 1e6 };
const s1 = worldToScreen(vp1, w1.x, w1.y);
const w1Back = screenToWorld(vp1, s1.x, s1.y);
console.log(`  World: (${w1.x}, ${w1.y})`);
console.log(`  Screen: (${s1.x}, ${s1.y})`);
console.log(`  Back: (${w1Back.x}, ${w1Back.y})`);
console.log(`  Error: Δx=${Math.abs(w1.x - w1Back.x)}, Δy=${Math.abs(w1.y - w1Back.y)}`);
console.log(`  PASS: ${Math.abs(w1.x - w1Back.x) < 1 && Math.abs(w1.y - w1Back.y) < 1 ? 'YES' : 'NO'}\n`);

// TEST 2: Extreme zoom with pan offset
console.log("TEST 2: High zoom with large offset");
const vp2 = { x: -1e4, y: 1e4, zoom: 100 };
const w2 = { x: 10, y: 10 };
const s2 = worldToScreen(vp2, w2.x, w2.y);
const w2Back = screenToWorld(vp2, s2.x, s2.y);
console.log(`  World: (${w2.x}, ${w2.y})`);
console.log(`  Screen: (${s2.x}, ${s2.y})`);
console.log(`  Back: (${w2Back.x}, ${w2Back.y})`);
console.log(`  Error: Δx=${Math.abs(w2.x - w2Back.x)}, Δy=${Math.abs(w2.y - w2Back.y)}`);
console.log(`  PASS: ${Math.abs(w2.x - w2Back.x) < 0.01 && Math.abs(w2.y - w2Back.y) < 0.01 ? 'YES' : 'NO'}\n`);

// TEST 3: Accumulative rounding through multiple zoomTo operations
console.log("TEST 3: Accumulative rounding through chained zooms");
let vp = { x: 0, y: 0, zoom: 1 };
const center = { x: 400, y: 300 };
const worldBefore = screenToWorld(vp, center.x, center.y);
console.log(`  Initial world at center: (${worldBefore.x}, ${worldBefore.y})`);

// Chain 5 zoom operations
for (let i = 0; i < 5; i++) {
  vp = zoomTo(vp, vp.zoom * 1.1, center);
}
const worldAfter = screenToWorld(vp, center.x, center.y);
console.log(`  Final world at center: (${worldAfter.x}, ${worldAfter.y})`);
console.log(`  Error: Δx=${Math.abs(worldBefore.x - worldAfter.x)}, Δy=${Math.abs(worldBefore.y - worldAfter.y)}`);
console.log(`  PASS: ${Math.abs(worldBefore.x - worldAfter.x) < 0.01 && Math.abs(worldBefore.y - worldAfter.y) < 0.01 ? 'YES' : 'NO'}\n`);

// TEST 4: zoomTo formula correctness
console.log("TEST 4: zoomTo formula verification");
const vp3 = { x: 100, y: 200, zoom: 2 };
const center3 = { x: 500, y: 400 };
const worldBefore3 = screenToWorld(vp3, center3.x, center3.y);

// zoomTo code:
// const world = screenToWorld(viewport, center.x, center.y);
// return { x: center.x - world.x * zoom, y: center.y - world.y * zoom, zoom };

const nextZoom = 4;
const world3 = screenToWorld(vp3, center3.x, center3.y);
const newVp3 = {
  x: center3.x - world3.x * nextZoom,
  y: center3.y - world3.y * nextZoom,
  zoom: nextZoom
};
const worldAfter3 = screenToWorld(newVp3, center3.x, center3.y);

console.log(`  Before zoom: world=(${worldBefore3.x}, ${worldBefore3.y})`);
console.log(`  After zoom: world=(${worldAfter3.x}, ${worldAfter3.y})`);
console.log(`  Error: Δx=${Math.abs(worldBefore3.x - worldAfter3.x)}, Δy=${Math.abs(worldBefore3.y - worldAfter3.y)}`);
console.log(`  PASS: ${Math.abs(worldBefore3.x - worldAfter3.x) < 1e-9 && Math.abs(worldBefore3.y - worldAfter3.y) < 1e-9 ? 'YES' : 'NO'}\n`);

console.log("=== Precision analysis complete ===");
