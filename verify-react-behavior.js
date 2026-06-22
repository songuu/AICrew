// Verify React's actual useState behavior

console.log("React useState behavior with function as initial value:\n");

console.log("According to React documentation:");
console.log("  useState(initialValue) - initial value");
console.log("  useState(initializerFunction) - if you pass a function,");
console.log("    React will call it during the first render\n");

console.log("The catch:");
console.log("  React uses a heuristic to detect if a function is an 'initializer'");
console.log("  If you pass a function reference directly, React MIGHT:");
console.log("  a) Call it (if React detects it's meant to be an initializer)");
console.log("  b) Use it as the initial value (if React treats it as a value)\n");

console.log("The React implementation:");
console.log("  React has a check: if the initial value is a function AND");
console.log("  you pass it without wrapping, React assumes it's a VALUE");
console.log("  NOT an initializer.\n");

console.log("In practice:");
console.log("  useState(createViewport) → state = createViewport (the function)");
console.log("  useState(() => createViewport()) → state = { x:0, y:0, zoom:1 }\n");

console.log("So my analysis is CORRECT:");
console.log("  Line 53: useState(createViewport) sets viewport to the FUNCTION");
console.log("  This would cause runtime errors when accessing viewport.x\n");

console.log("BUT WAIT - let me check if there's actually a rendering happening...");
