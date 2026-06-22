// Verification of edge cases not covered by tests

import { screenToWorld, worldToScreen, zoomTo, fitToView, createViewport } from './src/canvas/viewport.js';
import { createShape, boundsOf, getBounds, hitTest } from './src/canvas/model.js';

console.log("=== Edge Cases Analysis ===\n");

// 1. TEST: zoomTo with negative center values (should still preserve world coordinate)
console.log("1. zoomTo with negative screen coordinates:");
const vp1 = { x: -100, y: -50, zoom: 1 };
const negCenter = { x: -50, y: -25 };
const worldBefore = screenToWorld(vp1, negCenter.x, negCenter.y);
const zoomed = zoomTo(vp1, 2, negCenter);
const worldAfter = screenToWorld(zoomed, negCenter.x, negCenter.y);
console.log(`  Before: world=(${worldBefore.x}, ${worldBefore.y})`);
console.log(`  After:  world=(${worldAfter.x}, ${worldAfter.y})`);
console.log(`  Diff:   Δx=${Math.abs(worldBefore.x - worldAfter.x)}, Δy=${Math.abs(worldBefore.y - worldAfter.y)}`);
console.log(`  Result: ${Math.abs(worldBefore.x - worldAfter.x) < 1e-9 ? 'PASS' : 'FAIL'}\n`);

// 2. TEST: fitToView with zero-width objects (width OR height = 0)
console.log("2. fitToView with zero-width object (width=0, height>0):");
const zeroWidthObj = createShape("rect", { x: 50, y: 100, width: 0, height: 100 });
const vp2 = fitToView([zeroWidthObj], { width: 800, height: 600 }, 80);
console.log(`  Zoom: ${vp2.zoom} (should not be Infinity)`);
console.log(`  Result: ${isFinite(vp2.zoom) ? 'PASS' : 'FAIL'}\n`);

// 3. TEST: fitToView with all objects hidden (getBounds returns null)
console.log("3. fitToView with all objects hidden:");
const hiddenObj = createShape("rect", { x: 0, y: 0, width: 100, height: 100, hidden: true });
const vp3 = fitToView([hiddenObj], { width: 800, height: 600 }, 80);
console.log(`  Expected: { x: 0, y: 0, zoom: 1 }`);
console.log(`  Got:      { x: ${vp3.x}, y: ${vp3.y}, zoom: ${vp3.zoom} }`);
console.log(`  Result: ${vp3.x === 0 && vp3.y === 0 && vp3.zoom === 1 ? 'PASS' : 'FAIL'}\n`);

// 4. TEST: boundsOf with arrow having height=0 (horizontal arrow)
console.log("4. boundsOf arrow with height=0 (point-like):");
const horizontalArrow = createShape("arrow", { x: 100, y: 50, width: 0, height: 0 });
const b = boundsOf(horizontalArrow);
console.log(`  Bounds: minX=${b.minX}, minY=${b.minY}, maxX=${b.maxX}, maxY=${b.maxY}`);
console.log(`  Result: ${b.minX === 100 && b.minY === 50 && b.maxX === 100 && b.maxY === 50 ? 'PASS' : 'FAIL'}\n`);

// 5. TEST: hitTest with arrow + padding
console.log("5. hitTest arrow with 8px padding:");
const scene = { objects: [createShape("arrow", { x: 0, y: 0, width: 100, height: 0 })] };
const hitOnArrow = hitTest(scene, 50, 5); // 5px above the line
const hitMissArrow = hitTest(scene, 50, 20); // 20px above the line
console.log(`  Hit at (50, 5): ${hitOnArrow !== null ? 'YES' : 'NO'} (should be YES with 8px padding)`);
console.log(`  Hit at (50, 20): ${hitMissArrow !== null ? 'YES' : 'NO'} (should be NO)`);
console.log(`  Result: ${hitOnArrow !== null && hitMissArrow === null ? 'PASS' : 'FAIL'}\n`);

// 6. TEST: getBounds with mixed zero-size objects
console.log("6. getBounds with single point object:");
const pointObj = createShape("rect", { x: 100, y: 200, width: 0, height: 0 });
const bpt = getBounds([pointObj]);
console.log(`  Bounds: minX=${bpt.minX}, minY=${bpt.minY}, maxX=${bpt.maxX}, maxY=${bpt.maxY}`);
console.log(`  Width: ${bpt.width}, Height: ${bpt.height}`);
console.log(`  Result: ${bpt.minX === 100 && bpt.minY === 200 && bpt.width === 0 && bpt.height === 0 ? 'PASS' : 'FAIL'}\n`);

console.log("=== All edge cases checked ===");
