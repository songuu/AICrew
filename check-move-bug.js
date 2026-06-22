// Check for potential move gesture accumulation bug

console.log("=== MOVE GESTURE BUG ANALYSIS ===\n");

console.log("SCENARIO: Moving object left by 10px twice (two move events)");
console.log("Initial scene: obj at x=100\n");

console.log("EVENT 1: pointerMove(screen to world = 90)");
console.log("  gesture.last = {x: 100, y: 0}  (from pointerDown)");
console.log("  world = {x: 90, y: 0}");
console.log("  dx = 90 - 100 = -10");
console.log("  next.objects[].x = 100 + (-10) = 90  ✓");
console.log("  gesture.last = {x: 90, y: 0}  (UPDATED)");
console.log("  gesture.workScene = next  (UPDATED)\n");

console.log("EVENT 2: pointerMove(screen to world = 80)");
console.log("  gesture.last = {x: 90, y: 0}  (from previous)");
console.log("  world = {x: 80, y: 0}");
console.log("  dx = 80 - 90 = -10");
console.log("  next.objects[].x = gesture.workScene.objects[].x + (-10)");
console.log("                   = 90 + (-10) = 80  ✓");
console.log("  Result: Object correctly at x=80\n");

console.log("HOWEVER: There's a code issue at line 245:");
console.log("  const next = {");
console.log("    ...gesture.workScene,");
console.log("    objects: gesture.workScene.objects.map(obj => ...)");
console.log("  };");
console.log("  gesture.workScene = next;\n");

console.log("This is CORRECT because:");
console.log("  - gesture.workScene.objects contains the CURRENT state");
console.log("  - We spread it and map to create a new scene");
console.log("  - So each move is cumulative (correct)");
console.log("  - We're not re-reading from baseScene or scene\n");

console.log("POTENTIAL ISSUE FOUND at line 195:");
console.log("  gestureRef.current = { mode: \"draw\", id: shape.id, startWorld: world, baseScene, workScene: baseScene }");
console.log("  Line 232: const next = updateObject(gesture.baseScene, gesture.id, patch);");
console.log("           (uses baseScene, not workScene!)");
console.log("  Line 233: gesture.workScene = next;\n");

console.log("This is CORRECT for DRAW:");
console.log("  - We always update from baseScene (the initial empty shape)");
console.log("  - So patch applies relative to start, not to previous");
console.log("  - This is correct for resize operations\n");

console.log("BUT in MOVE (line 245):");
console.log("  We DON'T use baseScene, we use workScene");
console.log("  This is CORRECT because we accumulate position changes.\n");

console.log("VERDICT: Move gesture is CORRECTLY implemented.");
