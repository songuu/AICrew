// Quick test of React useState behavior with function reference

import { useState } from 'react';

export function TestComponent() {
  // Wrong way (according to my analysis):
  const [wrongViewport, setWrongViewport] = useState(createViewport);
  
  // Right way:
  const [rightViewport, setRightViewport] = useState(() => createViewport());
  
  console.log("wrongViewport type:", typeof wrongViewport);
  console.log("wrongViewport:", wrongViewport);
  console.log("rightViewport type:", typeof rightViewport);
  console.log("rightViewport:", rightViewport);
  
  return null;
}

function createViewport() {
  return { x: 0, y: 0, zoom: 1 };
}
