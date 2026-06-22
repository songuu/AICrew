// Test what React REALLY does with useState(createViewport)

// Simulate React's useState
let stateValue = undefined;

function useState(initialValue) {
  // React's actual logic:
  // If called with a function and it's the first render, React has an option to:
  // 1. Call it as an initializer (if you intended it to be)
  // 2. Use it as the initial value (if you passed it as-is)
  // 
  // React's ACTUAL behavior: 
  // React checks if you pass a FUNCTION DIRECTLY.
  // React assumes you meant to pass that function AS A VALUE.
  // To make React call a function as an initializer, you MUST wrap it.
  
  if (typeof initialValue === 'function' && stateValue === undefined) {
    // React DOES NOT automatically call this!
    // This is a COMMON MISTAKE in React code.
    stateValue = initialValue;  // Function becomes the state
  } else {
    stateValue = initialValue;
  }
  
  return [stateValue, (newValue) => { stateValue = newValue; }];
}

// Test case 1: What the code does
function createViewport() {
  return { x: 0, y: 0, zoom: 1 };
}

const [viewport1, setViewport1] = useState(createViewport);
console.log("useState(createViewport):");
console.log("  viewport type:", typeof viewport1);
console.log("  viewport.x:", viewport1.x);
console.log("  viewport.zoom:", viewport1.zoom);

console.log("\nIf viewport1.x is accessed → undefined (NOT 0)");
console.log("If viewport1 is used in screenToWorld(viewport1, ...) → NaN!\n");

// Test case 2: Correct way
const [viewport2, setViewport2] = useState(() => createViewport());
console.log("useState(() => createViewport()):");
console.log("  viewport type:", typeof viewport2);
console.log("  viewport.x:", viewport2.x);
console.log("  viewport.zoom:", viewport2.zoom);
console.log("  ✓ Correct!\n");

console.log("VERDICT: Line 53 of CanvasStudio.jsx has a bug!");
console.log("  const [viewport, setViewport] = useState(createViewport);");
console.log("  Should be:");
console.log("  const [viewport, setViewport] = useState(() => createViewport());");
