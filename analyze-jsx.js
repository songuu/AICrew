// Analyze CanvasStudio.jsx for mutation issues

import fs from 'fs';
const code = fs.readFileSync('./src/canvas/CanvasStudio.jsx', 'utf-8');

console.log("=== JSX Analysis ===\n");

// Check 1: Identify direct mutations in gesture handlers
console.log("1. Checking gesture reference mutations in onPointerMove:");
const moveGestureBlock = code.substring(code.indexOf("if (gesture.mode === \"move\")"), code.indexOf("if (gesture.mode === \"move\")") + 300);
console.log(moveGestureBlock);
console.log("\n   Issue: gesture.last and gesture.moved are MUTATED directly!");
console.log("   These are properties of gestureRef.current, which persist across renders.\n");

// Check 2: Look at draft usage
console.log("2. Checking draft state handling:");
const draftLines = code.split('\n').filter((line, idx) => {
  const content = line.toLowerCase();
  return content.includes('draft') && (content.includes('setdraft') || content.includes('scene'));
});
console.log("   Lines with 'draft' usage:");
draftLines.slice(0, 8).forEach(line => console.log("   " + line.trim()));

// Check 3: Check scene composition
console.log("\n3. Scene composition logic:");
console.log("   Line ~66: const scene = draft || history.present;");
console.log("   Line ~67: const selected = scene.objects.find(obj => obj.id === selectedId) || null;");
console.log("   Issue: 'selected' is a reference to an object in scene.objects array.");
console.log("   This is safe IF scene.objects is immutable (from model.js functions).\n");

// Check 4: Import analysis
console.log("4. Imports from model.js:");
const imports = code.match(/import \{([^}]+)\} from "\.\/model\.js"/)[1];
console.log("   " + imports);
console.log("   All returned by updateObject() spread operator - immutable.\n");

// Check 5: Gesture reference pattern
console.log("5. Gesture reference storage pattern:");
const gesturePattern = code.substring(code.indexOf("gestureRef.current = "), code.indexOf("gestureRef.current = ") + 200);
console.log("   Pattern: gestureRef.current = { mode, ... }");
console.log("   Then mutated: gesture.last = world; gesture.moved = true;");
console.log("   VERDICT: This is INTENTIONAL - gesture is not Redux state.");
console.log("   It's a temporary mutable object for drag-in-progress tracking.\n");

console.log("=== Analysis Complete ===");
