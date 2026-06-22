// Verify the fitToView zoom clamp bug

import { fitToView, clampZoom, MAX_ZOOM } from './src/canvas/viewport.js';
import { createShape } from './src/canvas/model.js';

console.log("=== fitToView Zoom Clamp Verification ===\n");

console.log("MAX_ZOOM constant:", MAX_ZOOM);
console.log("clampZoom(4.4):", clampZoom(4.4));
console.log("clampZoom(5):", clampZoom(5));
console.log("Why? Because clampZoom limits to [0.1, 4]\n");

// Create very thin object where optimal zoom would exceed MAX_ZOOM
const thinObj = createShape("rect", { x: 0, y: 0, width: 0.1, height: 100 });
const size = { width: 800, height: 600 };
const padding = 80;

console.log("Scenario: Very thin vertical object (width=0.1, height=100)");
console.log(`  Viewport: ${size.width} x ${size.height}, padding=${padding}`);
console.log(`  Bounds: width=0.1, height=100\n`);

const zoomX = (size.width - padding * 2) / 0.1;
const zoomY = (size.height - padding * 2) / 100;
const optimalZoom = Math.min(zoomX, zoomY);

console.log(`  zoomX = (${size.width} - ${padding}*2) / 0.1 = ${zoomX}`);
console.log(`  zoomY = (${size.height} - ${padding}*2) / 100 = ${zoomY}`);
console.log(`  Math.min(zoomX, zoomY) = ${optimalZoom}`);
console.log(`  clampZoom(${optimalZoom}) = ${clampZoom(optimalZoom)}`);

const vp = fitToView([thinObj], size, padding);
console.log(`\n  Returned zoom: ${vp.zoom}`);
console.log(`  Issue: Optimal zoom ${optimalZoom} gets clamped to ${MAX_ZOOM}\n`);

console.log("CONSEQUENCE:");
console.log("  - The thin object WON'T fit in the viewport with the requested padding");
console.log("  - User clicks 'Fit All' expecting object to fill the view");
console.log("  - But zoom is artificially limited to MAX_ZOOM=4");
console.log("  - Object stays small, doesn't actually 'fit'");
console.log("  - This is an EDGE CASE but technically violates the fitToView contract\n");

console.log("VERDICT: This is a logical correctness issue.");
console.log("  fitToView should achieve its stated goal within zoom constraints.");
console.log("  When zoom is clamped, fitToView should acknowledge this");
console.log("  (e.g., comment 'object too thin for viewport constraints')");
