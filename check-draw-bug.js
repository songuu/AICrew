// Check draw gesture state machine

import { createViewport, screenToWorld } from './src/canvas/viewport.js';
import { createScene, createShape, addObject, updateObject } from './src/canvas/model.js';

console.log("=== DRAW GESTURE BUG HUNT ===\n");

console.log("Code at line 220-234 (draw mode, onPointerMove):");
console.log("  if (gesture.mode === \"draw\") {");
console.log("    let patch;");
console.log("    if (toolRef.current === TOOL.ARROW) {");
console.log("      patch = { x: gesture.startWorld.x, y: gesture.startWorld.y,");
console.log("                width: world.x - gesture.startWorld.x,");
console.log("                height: world.y - gesture.startWorld.y };");
console.log("    } else {");
console.log("      patch = {");
console.log("        x: Math.min(gesture.startWorld.x, world.x),");
console.log("        y: Math.min(gesture.startWorld.y, world.y),");
console.log("        width: Math.abs(world.x - gesture.startWorld.x),");
console.log("        height: Math.abs(world.y - gesture.startWorld.y)");
console.log("      };");
console.log("    }");
console.log("    const next = updateObject(gesture.baseScene, gesture.id, patch);");
console.log("    gesture.workScene = next;");
console.log("    setDraft(next);");
console.log("  }\n");

// Simulate rect draw
console.log("TEST 1: Drawing rect from (0,0) to (100,100)");
const rect = createShape("rect", { x: 0, y: 0, width: 0, height: 0 });
console.log(`  Start: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height}`);

const scene = addObject(createScene(), rect);
const startWorld = { x: 0, y: 0 };
const endWorld = { x: 100, y: 100 };

const patch = {
  x: Math.min(startWorld.x, endWorld.x),
  y: Math.min(startWorld.y, endWorld.y),
  width: Math.abs(endWorld.x - startWorld.x),
  height: Math.abs(endWorld.y - startWorld.y)
};
const updated = updateObject(scene, rect.id, patch);
const result = updated.objects[0];
console.log(`  Result: x=${result.x}, y=${result.y}, w=${result.width}, h=${result.height}`);
console.log(`  Expected: x=0, y=0, w=100, h=100`);
console.log(`  PASS: ${result.x === 0 && result.y === 0 && result.width === 100 && result.height === 100 ? 'YES' : 'NO'}\n`);

// Simulate rect draw backwards
console.log("TEST 2: Drawing rect from (100,100) to (0,0) (backwards)");
const rect2 = createShape("rect", { x: 100, y: 100, width: 0, height: 0 });
const scene2 = addObject(createScene(), rect2);
const startWorld2 = { x: 100, y: 100 };
const endWorld2 = { x: 0, y: 0 };

const patch2 = {
  x: Math.min(startWorld2.x, endWorld2.x),
  y: Math.min(startWorld2.y, endWorld2.y),
  width: Math.abs(endWorld2.x - startWorld2.x),
  height: Math.abs(endWorld2.y - startWorld2.y)
};
const updated2 = updateObject(scene2, rect2.id, patch2);
const result2 = updated2.objects[0];
console.log(`  Start: x=${rect2.x}, y=${rect2.y}, w=${rect2.width}, h=${rect2.height}`);
console.log(`  Result: x=${result2.x}, y=${result2.y}, w=${result2.width}, h=${result2.height}`);
console.log(`  Expected: x=0, y=0, w=100, h=100`);
console.log(`  PASS: ${result2.x === 0 && result2.y === 0 && result2.width === 100 && result2.height === 100 ? 'YES' : 'NO'}\n`);

// Simulate arrow draw
console.log("TEST 3: Drawing arrow from (0,0) to (100,100)");
const arrow = createShape("arrow", { x: 0, y: 0, width: 0, height: 0 });
const scene3 = addObject(createScene(), arrow);
const startWorldA = { x: 0, y: 0 };
const endWorldA = { x: 100, y: 100 };

const patchA = {
  x: startWorldA.x,
  y: startWorldA.y,
  width: endWorldA.x - startWorldA.x,
  height: endWorldA.y - startWorldA.y
};
const updated3 = updateObject(scene3, arrow.id, patchA);
const result3 = updated3.objects[0];
console.log(`  Start: x=${arrow.x}, y=${arrow.y}, w=${arrow.width}, h=${arrow.height}`);
console.log(`  Result: x=${result3.x}, y=${result3.y}, w=${result3.width}, h=${result3.height}`);
console.log(`  Expected: x=0, y=0, w=100, h=100`);
console.log(`  PASS: ${result3.x === 0 && result3.y === 0 && result3.width === 100 && result3.height === 100 ? 'YES' : 'NO'}\n`);

// CRITICAL TEST: Arrow drawn backwards
console.log("TEST 4: Drawing arrow from (100,100) to (0,0) (backwards)");
const arrow2 = createShape("arrow", { x: 100, y: 100, width: 0, height: 0 });
const scene4 = addObject(createScene(), arrow2);
const startWorldA2 = { x: 100, y: 100 };
const endWorldA2 = { x: 0, y: 0 };

const patchA2 = {
  x: startWorldA2.x,
  y: startWorldA2.y,
  width: endWorldA2.x - startWorldA2.x,
  height: endWorldA2.y - startWorldA2.y
};
const updated4 = updateObject(scene4, arrow2.id, patchA2);
const result4 = updated4.objects[0];
console.log(`  Start: x=${arrow2.x}, y=${arrow2.y}, w=${arrow2.width}, h=${arrow2.height}`);
console.log(`  Result: x=${result4.x}, y=${result4.y}, w=${result4.width}, h=${result4.height}`);
console.log(`  Expected: x=100, y=100, w=-100, h=-100 (end point relative)`);
console.log(`  PASS: ${result4.x === 100 && result4.y === 100 && result4.width === -100 && result4.height === -100 ? 'YES' : 'NO'}\n`);

console.log("=== All draw gesture tests complete ===");
