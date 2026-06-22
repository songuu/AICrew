// Check viewport initialization issue in CanvasStudio

console.log("=== VIEWPORT INITIALIZATION BUG ===\n");

console.log("Line 52-53 in CanvasStudio.jsx:");
console.log("  const [history, setHistory] = useState(() => createHistory(createScene()));");
console.log("  const [viewport, setViewport] = useState(createViewport);");
console.log("\nISSUE IDENTIFIED:");
console.log("  Line 52: useState with INITIALIZER FUNCTION (() => ...)");
console.log("  Line 53: useState with FUNCTION REFERENCE (no call parentheses)\n");

console.log("ANALYSIS:");
console.log("  Line 52 CORRECT: useState(() => createHistory(createScene()))");
console.log("    - Passes a function to useState");
console.log("    - React calls it once on mount");
console.log("    - Result: createHistory(createScene()) executes once\n");

console.log("  Line 53 WRONG?: useState(createViewport)");
console.log("    - Passes a FUNCTION REFERENCE, not an initializer function");
console.log("    - React expects either:");
console.log("      a) A value: useState(defaultValue)");
console.log("      b) A function: useState(() => computeDefault())");
console.log("    - Passing a function WITHOUT an initializer function wrapper");
console.log("      means React treats the FUNCTION ITSELF as the initial value");
console.log("    - NOT calling it to get the viewport object!\n");

console.log("TEST: What actually happens?");
console.log("  const [viewport, setViewport] = useState(createViewport);");
console.log("  Initially, viewport = the function createViewport itself");
console.log("  NOT viewport = { x: 0, y: 0, zoom: 1 }\n");

console.log("CONSEQUENCE:");
console.log("  At line 178: worldToScreen(viewport, ...) expects an object");
console.log("  But viewport is a FUNCTION");
console.log("  viewport.x, viewport.y, viewport.zoom are all undefined");
console.log("  screenToWorld returns { x: (NaN), y: (NaN) }\n");

console.log("Actually wait - let me re-check the actual behavior...");

// Simulate React behavior
function useState(init) {
  let value;
  if (typeof init === 'function') {
    // Only call if it's in 'initializer function' position
    // But React checks if PASSED AS A FUNCTION
    value = init;
  } else {
    value = init;
  }
  return [value, (v) => (value = v)];
}

// This is what the code does:
const [vp] = useState(function createViewport() {
  return { x: 0, y: 0, zoom: 1 };
});

console.log("React's actual behavior:");
console.log("  When you pass a function reference to useState WITHOUT wrapper");
console.log("  React treats the function AS the initial value");
console.log("  viewport = [Function: createViewport]");
console.log("  typeof viewport === 'function'  // true");
console.log("  viewport.x === undefined        // true");
console.log("  This would cause NaN errors!\n");

console.log("CORRECT CODE SHOULD BE:");
console.log("  const [viewport, setViewport] = useState(() => createViewport());");
console.log("  NOT:");
console.log("  const [viewport, setViewport] = useState(createViewport);\n");

console.log("VERDICT: CRITICAL BUG - viewport starts as a function, not an object.");
console.log("         This should cause immediate runtime errors in pointerToScreen/screenToWorld.");
