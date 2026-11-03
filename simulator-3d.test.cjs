const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { projectSimulatorPoint } = require('./simulator-3d.js');

test('orthographic projection separates pass depths and scales only visual Z', () => {
  const camera = { center: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, zScale: 1 };
  const point = { x: 10, y: 20, z: -3 };
  assert.deepEqual(projectSimulatorPoint(point, camera), { x: 10, y: 3 });
  assert.deepEqual(projectSimulatorPoint(point, { ...camera, zScale: 5 }), { x: 10, y: 15 });
  const top = projectSimulatorPoint(point, { ...camera, pitch: Math.PI / 2 });
  assert.ok(Math.abs(top.y + 20) < 1e-10); // Same XY orientation as the 2D SVG: positive Y points up.
  assert.ok(projectSimulatorPoint({ x: 0, y: 1, z: 0 }, { ...camera, pitch: Math.PI / 5 }).y < 0);
  assert.equal(point.z, -3);
});

test('3D view follows playback, supports orbit, pan, zoom, reset and return to 2D', () => {
  const strokes = [], labels = [];
  let path = [];
  const context2d = {
    setTransform() {}, clearRect() {}, setLineDash() {}, beginPath() { path = []; },
    moveTo(x, y) { path.push(['M', x, y]); }, lineTo(x, y) { path.push(['L', x, y]); },
    stroke() { strokes.push({ color: this.strokeStyle, path: [...path] }); },
    arc() {}, fill() {}, fillText(text) { labels.push(text); },
  };
  const nodes = [];
  const node = (tag) => {
    const element = {
      tag, children: [], attrs: {}, listeners: {}, clientWidth: 800, clientHeight: 500,
      setAttribute(key, value) { this.attrs[key] = value; },
      append(...children) { this.children.push(...children); }, before() {},
      addEventListener(key, callback) { this.listeners[key] = callback; },
      getContext: () => context2d, focus() {}, setPointerCapture() {},
      hasPointerCapture: () => true, releasePointerCapture() {},
    };
    nodes.push(element); return element;
  };
  const segments = [
    { start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: -1 }, startTimeSec: 0, endTimeSec: 1, motionType: 'plunge' },
    { start: { x: 0, y: 0, z: -1 }, end: { x: 10, y: 0, z: -1 }, startTimeSec: 1, endTimeSec: 2, motionType: 'cut' },
    { start: { x: 10, y: 0, z: -1 }, end: { x: 10, y: 0, z: -2 }, startTimeSec: 2, endTimeSec: 3, motionType: 'plunge' },
  ];
  const state = { generated: { playbackSegments: segments }, playback: { currentTimeSec: 0, hasStarted: false } };
  const refs = { preview: { parentElement: node('container') }, zoomLevel: {} };
  let twoDUpdates = 0;
  const context = vm.createContext({
    document: { createElement: node }, refs, state,
    window: { devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} },
    getPlaybackPosition: () => segments[0].start,
    updatePlaybackVisualization() { twoDUpdates++; },
  });
  vm.runInContext(readFileSync(`${__dirname}/simulator-3d.js`, 'utf8'), context);
  context.setupSimulator3D();
  const canvas = nodes.find((entry) => entry.tag === 'canvas');
  const button = (text) => nodes.find((entry) => entry.textContent === text);
  assert.equal(context.window.simulator3D.active, false);
  button('3D').listeners.click();
  assert.equal(canvas.hidden, false);
  assert.equal(refs.preview.hidden, true);
  assert.ok(strokes.some((stroke) => stroke.color.startsWith('hsl')));
  state.playback.hasStarted = true;
  strokes.length = 0;
  context.window.simulator3D.draw();
  assert.ok(!strokes.some((stroke) => stroke.color.startsWith('hsl')));
  state.playback.currentTimeSec = 0.5;
  strokes.length = 0;
  context.window.simulator3D.draw();
  assert.equal(strokes.filter((stroke) => stroke.color.startsWith('hsl')).length, 1);
  const before = JSON.stringify(strokes);
  canvas.listeners.pointerdown({ button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {} });
  strokes.length = 0;
  canvas.listeners.pointermove({ pointerId: 1, clientX: 30, clientY: 20 });
  assert.notEqual(JSON.stringify(strokes), before);
  canvas.listeners.pointercancel({ pointerId: 1 });
  assert.equal(button('Pan'), undefined);
  assert.equal(button('Front view'), undefined);
  strokes.length = 0;
  context.window.simulator3D.draw();
  const startX = strokes[0].path[0][1];
  canvas.listeners.pointerdown({ button: 0, shiftKey: true, pointerId: 2, clientX: 0, clientY: 0, preventDefault() {} });
  strokes.length = 0;
  canvas.listeners.pointermove({ pointerId: 2, clientX: 40, clientY: 0 });
  assert.equal(strokes[0].path[0][1], startX + 40);
  canvas.listeners.pointerup({ pointerId: 2 });
  canvas.listeners.keydown({ key: '+', preventDefault() {} });
  assert.equal(refs.zoomLevel.textContent, '125%');
  context.window.simulator3D.reset();
  assert.equal(refs.zoomLevel.textContent, '100%');
  const select = nodes.find((entry) => entry.tag === 'select');
  select.value = '5'; select.listeners.change();
  assert.ok(labels.every((label) => ['X', 'Y', 'Z'].includes(label)));
  button('2D').listeners.click();
  assert.equal(canvas.hidden, true);
  assert.equal(refs.preview.hidden, false);
  assert.ok(twoDUpdates > 0);
});
