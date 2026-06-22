// Trace move gesture logic
console.log("=== MOVE GESTURE TRACE ===\n");

console.log("Line 204 (onPointerDown):");
console.log("  gestureRef.current = { mode: 'move', id: hitId, last: world, baseScene: scene, workScene: scene, moved: false }");
console.log("  Note: workScene = scene (reference equality, NOT COPY)\n");

console.log("Line 238-248 (onPointerMove):");
console.log("  const dx = world.x - gesture.last.x;");
console.log("  const dy = world.y - gesture.last.y;");
console.log("  gesture.last = world;        // MUTATION of ref");
console.log("  gesture.moved = true;         // MUTATION of ref");
console.log("  const next = {");
console.log("    ...gesture.workScene,");
console.log("    objects: gesture.workScene.objects.map(obj => ");
console.log("      (obj.id === gesture.id ? { ...obj, x: obj.x + dx, y: obj.y + dy } : obj)");
console.log("    )");
console.log("  };");
console.log("  gesture.workScene = next;     // MUTATION of ref");
console.log("  setDraft(next);               // Schedule re-render with new scene\n");

console.log("ISSUE IDENTIFIED:");
console.log("  gesture.workScene starts as a REFERENCE to the original scene object.");
console.log("  During move, we DON'T mutate scene - we create new scene object.");
console.log("  But we MUTATE gesture.workScene to point to the new scene.");
console.log("  This is safe because gestureRef is NOT React state.\n");

console.log("However, there's a subtle issue:");
console.log("  If setDraft(next) batches/suspends, gesture.workScene still points to 'next'.");
console.log("  The next pointerMove will use gesture.workScene.objects.map(...)");
console.log("  So we're always reading from the draft, not the base.\n");

console.log("VERDICT: This is CORRECT architecture for streaming updates.");
console.log("  - Each move calculates dx/dy from gesture.last");
console.log("  - Each move creates NEW scene immutably (spread + map)");
console.log("  - gesture.workScene accumulates edits without re-rendering");
console.log("  - setDraft(next) triggers re-render to show live preview");
console.log("  - onPointerUp commits once\n");
