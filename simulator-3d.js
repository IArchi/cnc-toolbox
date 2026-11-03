// Orthographic toolpath view, not a stock-removal or collision simulation.
function projectSimulatorPoint(point, camera) {
  const x = point.x - camera.center.x, y = point.y - camera.center.y;
  const z = (point.z - camera.center.z) * camera.zScale;
  const horizontal = x * Math.cos(camera.yaw) - y * Math.sin(camera.yaw);
  const depth = x * Math.sin(camera.yaw) + y * Math.cos(camera.yaw);
  return { x: horizontal, y: -depth * Math.sin(camera.pitch) - z * Math.cos(camera.pitch) };
}

function setupSimulator3D() {
  const container = refs.preview.parentElement;
  const canvas = document.createElement('canvas');
  canvas.className = 'simulator-3d'; canvas.hidden = true; canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D toolpaths. Arrow keys rotate; Shift and arrows pan; plus and minus zoom.');
  container.append(canvas);
  const toolbar = document.createElement('div'); toolbar.className = 'preview-toolbar simulator-3d-controls';
  const button = (text, action) => {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'secondary-btn'; element.textContent = text;
    element.addEventListener('click', action); toolbar.append(element); return element;
  };
  const twoD = button('2D', () => setMode(false)), threeD = button('3D', () => setMode(true));
  const topButton = button('Top view', () => { camera.pitch = Math.PI / 2; camera.yaw = 0; draw(); });
  const zLabel = document.createElement('label'); zLabel.className = 'simulator-z-scale';
  const labelText = document.createElement('span'); labelText.textContent = 'Z display scale';
  const zSelect = document.createElement('select');
  for (const value of [1, 2, 5, 10]) {
    const option = document.createElement('option'); option.value = String(value); option.textContent = `${value}×`; zSelect.append(option);
  }
  zSelect.value = '1';
  zLabel.append(labelText, zSelect); toolbar.append(zLabel);
  const hint = document.createElement('span'); hint.textContent = 'Drag to rotate · Shift-drag to move · Wheel to zoom · Z scale is visual only';
  toolbar.append(hint); container.before(toolbar);
  const camera = { center: { x: 0, y: 0, z: 0 }, yaw: -Math.PI / 4, pitch: Math.PI / 5, zScale: 1 };
  let active = false, zoom = 1, offset = { x: 0, y: 0 }, drag = null;
  let bounds = null, fittedGenerated = null;
  function fitBounds() {
    if (!state.generated || fittedGenerated === state.generated) return;
    const min = { x: Infinity, y: Infinity, z: 0 }, max = { x: -Infinity, y: -Infinity, z: 0 };
    for (const segment of state.generated.playbackSegments) for (const point of [segment.start, segment.end]) {
      for (const axis of ['x', 'y', 'z']) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
    }
    bounds = { min, max };
    camera.center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    fittedGenerated = state.generated;
  }
  function reset() {
    fittedGenerated = null; zoom = 1; offset = { x: 0, y: 0 };
    camera.yaw = -Math.PI / 4; camera.pitch = Math.PI / 5;
    draw();
  }
  function setMode(value) {
    active = value; canvas.hidden = !active; refs.preview.hidden = active;
    for (const element of [topButton, zLabel, hint]) element.hidden = !active;
    twoD.setAttribute('aria-pressed', String(!active)); threeD.setAttribute('aria-pressed', String(active));
    if (active) draw();
    else { refs.zoomLevel.textContent = state.previewRender ? `${Math.round(state.previewRender.initialView.width / state.previewRender.view.width * 100)}%` : '100%'; updatePlaybackVisualization(); }
  }
  function draw() {
    if (!active || !state.generated) return;
    fitBounds();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    // Fit a bounding sphere so orbiting never changes the model's apparent scale.
    const span = Math.max(1, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, (bounds.max.z - bounds.min.z) * camera.zScale));
    const scale = Math.max(1, Math.min(width, height) - 70) / span * zoom;
    const project = (point) => {
      const projected = projectSimulatorPoint(point, camera);
      return { x: width / 2 + offset.x + projected.x * scale, y: height / 2 + offset.y + projected.y * scale };
    };
    const line = (start, end) => {
      const a = project(start), b = project(end); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
    };
    context.strokeStyle = '#d9dfeb'; context.lineWidth = 1; context.beginPath();
    for (let index = 0; index <= 10; index++) {
      const x = bounds.min.x + (bounds.max.x - bounds.min.x) * index / 10;
      const y = bounds.min.y + (bounds.max.y - bounds.min.y) * index / 10;
      line({ x, y: bounds.min.y, z: 0 }, { x, y: bounds.max.y, z: 0 });
      line({ x: bounds.min.x, y, z: 0 }, { x: bounds.max.x, y, z: 0 });
    }
    context.stroke();
    // Batch by depth band: bounded draw calls even for 200,000 imported segments.
    const batches = new Map();
    const time = state.playback.hasStarted ? state.playback.currentTimeSec : Infinity;
    for (const segment of state.generated.playbackSegments) {
      if (time <= segment.startTimeSec) break;
      const t = Math.min(1, (time - segment.startTimeSec) / (segment.endTimeSec - segment.startTimeSec));
      const end = { x: segment.start.x + (segment.end.x - segment.start.x) * t, y: segment.start.y + (segment.end.y - segment.start.y) * t, z: segment.start.z + (segment.end.z - segment.start.z) * t };
      const depth = Math.max(0, Math.min(1, -(segment.start.z + end.z) / 2 / Math.max(0.001, -bounds.min.z)));
      const color = segment.motionType === 'rapid' ? '#94a3b8' : `hsl(${220 - Math.round(depth * 12) * 15} 80% 42%)`;
      if (!batches.has(color)) batches.set(color, []);
      batches.get(color).push([segment.start, end]);
    }
    for (const [color, segments] of batches) {
      context.strokeStyle = color; context.lineWidth = color === '#94a3b8' ? 1 : 2;
      context.setLineDash(color === '#94a3b8' ? [4, 5] : []); context.beginPath();
      for (const [start, end] of segments) line(start, end);
      context.stroke();
    }
    context.setLineDash([]);
    const origin = { x: bounds.min.x, y: bounds.min.y, z: 0 }, axisLength = span / 8;
    context.font = 'bold 12px system-ui';
    for (const [axis, color] of [['x', '#c53030'], ['y', '#16803c'], ['z', '#0d6efd']]) {
      const end = { ...origin, [axis]: origin[axis] + axisLength / (axis === 'z' ? camera.zScale : 1) };
      context.strokeStyle = color; context.lineWidth = 2; context.beginPath(); line(origin, end); context.stroke();
      const point = project(end); context.fillStyle = color; context.fillText(axis.toUpperCase(), point.x + 5, point.y - 5);
    }
    const position = getPlaybackPosition(state.generated.playbackSegments, state.playback.currentTimeSec);
    const tool = project(position);
    context.fillStyle = '#ea580c'; context.beginPath(); context.arc(tool.x, tool.y, 5, 0, Math.PI * 2); context.fill();
    context.strokeStyle = '#fff'; context.lineWidth = 2; context.stroke();
    refs.zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  }
  function zoomBy(factor) { zoom = Math.max(0.1, Math.min(40, zoom * factor)); draw(); }
  zSelect.addEventListener('change', () => { camera.zScale = Number(zSelect.value); draw(); });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    zoomBy(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01));
  }, { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    if (drag || ![0, 1, 2].includes(event.button)) return;
    event.preventDefault(); canvas.focus();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button !== 0 };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    if (drag.pan) { offset.x += dx; offset.y += dy; }
    else { camera.yaw += dx * 0.01; camera.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.pitch + dy * 0.01)); }
    draw();
  });
  const finish = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, finish);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[event.key]) {
      const [x, y] = moves[event.key];
      if (event.shiftKey) { offset.x += x * 20; offset.y += y * 20; }
      else { camera.yaw += x * 0.1; camera.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.pitch + y * 0.1)); }
      draw();
    } else if (['+', '='].includes(event.key)) zoomBy(1.25);
    else if (event.key === '-') zoomBy(1 / 1.25);
    else if (event.key === 'Home') reset();
    else return;
    event.preventDefault();
  });
  new ResizeObserver(draw).observe(canvas);
  window.simulator3D = { get active() { return active; }, draw, reset, zoom: zoomBy };
  setMode(false);
}

if (typeof module !== 'undefined') module.exports = { projectSimulatorPoint };
