// Check localStorage persistence logic

console.log("=== STORAGE PERSISTENCE ANALYSIS ===\n");

console.log("Load logic (line 40-49):");
console.log("  function loadScene() {");
console.log("    try {");
console.log("      const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);");
console.log("      if (!raw) return createScene();");
console.log("      const parsed = JSON.parse(raw);");
console.log("      return Array.isArray(parsed?.objects) ? createScene(parsed.objects) : createScene();");
console.log("    } catch {");
console.log("      return createScene();");
console.log("    }");
console.log("  }\n");

console.log("ISSUES IDENTIFIED:");
console.log("1. Line 45: return Array.isArray(parsed?.objects)");
console.log("   Issue: This checks if parsed.objects is an array");
console.log("   But doesn't validate the array contents are valid shapes");
console.log("   Problem: If stored data has corrupted/missing id/type, it's accepted");
console.log("   Risk: MEDIUM - Could cause UI crashes if shape is malformed\n");

console.log("2. Line 52: useEffect(() => { setHistory(createHistory(loadScene())); }, [])");
console.log("   Issue: Calls loadScene() which calls JSON.parse on potentially large data");
console.log("   This happens on MOUNT - could be slow");
console.log("   Risk: LOW - it's the initial load\n");

console.log("3. Line 83: window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(history.present))");
console.log("   Only persists history.present (the scene)");
console.log("   Does NOT persist viewport pan/zoom (CORRECT - matches RoboNeo spec)");
console.log("   Does NOT persist tool state (CORRECT)\n");

console.log("4. Line 85: } catch { /* localStorage 配额超限/序列化失败：内存态不受影响，仅本次不落盘 */ }");
console.log("   Silently fails if localStorage is unavailable");
console.log("   This is CORRECT - in-memory state continues, just not saved\n");

console.log("RECOMMENDED FIX:");
console.log("  Validate parsed objects before accepting:");
console.log("  function loadScene() {");
console.log("    try {");
console.log("      const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);");
console.log("      if (!raw) return createScene();");
console.log("      const parsed = JSON.parse(raw);");
console.log("      if (!Array.isArray(parsed?.objects)) return createScene();");
console.log("      // Validate each object has required fields");
console.log("      const validated = parsed.objects.filter(obj => ");
console.log("        obj && typeof obj.id === 'string' && SHAPE_TYPES.includes(obj.type)");
console.log("      );");
console.log("      return createScene(validated);");
console.log("    } catch {");
console.log("      return createScene();");
console.log("    }");
console.log("  }\n");

console.log("VERDICT: Storage logic is FUNCTIONAL but lacks input validation.");
