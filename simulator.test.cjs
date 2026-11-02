const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseSimulationGcode } = require('./simulator.js');

test('imports linear, modal and relative moves, comments and original line indexes', () => {
  const result = parseSimulationGcode('%\r\n(comment)\r\nN1 g21 g90 g0 z5\r\ng1 z-1 f120\r\nx10 f600 ; cut\r\ng91\r\ny-5\r\ng0 z6\r\nm30');
  assert.equal(result.segments.length, 5);
  assert.equal(result.segments[0].motionType, 'rapid');
  assert.equal(result.segments[0].lineIndex, 2);
  assert.equal(result.segments[1].motionType, 'plunge');
  assert.equal(result.segments[2].feed, 600);
  assert.deepEqual(result.segments.at(-1).end, { x: 10, y: -5, z: 5 });
  assert.equal(result.lines[4], 'x10 f600 ; cut');
});

test('converts inch coordinates, relative moves and feed rates into millimeters', () => {
  const { segments } = parseSimulationGcode('G20 G90\nG0 X1\nG1 Y2 F10\nG91 X-0.5');
  assert.equal(segments[0].end.x, 25.4);
  assert.equal(segments[1].end.y, 50.8);
  assert.equal(segments[1].feed, 254);
  assert.equal(segments[2].end.x, 12.7);
});

test('XY arcs interpolate Z, preserve line correspondence and support full planar circles', () => {
  for (const code of ['G2', 'G3']) {
    const { segments } = parseSimulationGcode(`G21 G90\nG0 X10\n${code} X0 Y10 Z-2 I-10 J0 F600`);
    assert.ok(segments.length > 10);
    assert.deepEqual(segments.at(-1).end, { x: 0, y: 10, z: -2 });
    assert.ok(segments.slice(1).every((segment) => segment.lineIndex === 2 && Math.abs(Math.hypot(segment.end.x, segment.end.y) - 10) < 0.001));
  }
  const circle = parseSimulationGcode('G0 X10\nG2 I-10 J0 F600');
  assert.deepEqual(circle.segments.at(-1).end, { x: 10, y: 0, z: 0 });
});

test('rejects unsupported dialects instead of silently producing a misleading simulation', () => {
  for (const source of ['G0 X1\nG1 X2', 'G18', 'G93', 'G92 X10', 'G55', 'G43 H1', 'G81 X1', 'M6', 'T2', 'G0 X1 X2', 'G0 G1 X1', 'G1 X1 F0', 'M30\nG0 X1', 'G0 X1\nG80\nX2', 'G0 X1 R3', 'G2 X10 R5 F100', 'G0 X10\nG2 I-10 Z-1 F100', 'G0 X10\nG2 X0 Y20 I-10 F100']) {
    assert.throws(() => parseSimulationGcode(source), /Line \d+:/, source);
  }
  assert.throws(() => parseSimulationGcode('; empty'), /No motion/);
});

test('C2D output is accepted and the shared player keeps original command offsets', () => {
  const app = vm.createContext({
    document: { getElementById: () => ({}) },
    window: { initSqlJs: () => new Promise(() => {}) }, TextDecoder, Uint8Array, console,
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, 'utf8'), app);
  const element = { uuid: 'rectangle', geometryType: 'rectangle', position: [20, 20], width: 10, height: 10 };
  const generated = app.generateGcode({
    document: { safeZ: 8, zeroX: 0, zeroY: 0 }, parseWarnings: [], elementsByUuid: new Map([[element.uuid, element]]),
    toolpaths: [{ type: 'contour', elements: [{ uuid: element.uuid }], tool: { diameter: 6 }, end_depth: 2, stepdown: 1, speeds: { feedrate: 600, plungerate: 120, rpm: 18000 } }],
  }, 'sample.c2d');
  const imported = parseSimulationGcode(generated.gcode);
  const playback = [];
  let cursor = { ...imported.segments[0].start, timeSec: 0 };
  for (const segment of imported.segments) cursor = app.appendPlaybackMotion(playback, cursor, segment.end, segment.feed, segment.motionType, '#0057d9', segment.lineIndex);
  assert.ok(cursor.timeSec > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(app.getPlaybackPosition(playback, cursor.timeSec))), imported.segments.at(-1).end);
  for (const segment of playback) assert.match(imported.lines[segment.gcodeLineIndex], /^G[01]/);
});

test('four-tab navigation lazily loads the simulator and supports keyboard selection', () => {
  const buttons = ['feedrate', 'converter', 'tiling', 'simulator'].map((page) => ({
    dataset: { page }, listeners: {}, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
    focus() { this.focused = true; }, click() { this.listeners.click(); },
  }));
  const pages = Object.fromEntries(buttons.map((button) => [`${button.dataset.page}-page`, {}]));
  const frame = { dataset: { src: './index.html?simulator' }, hasAttribute() { return !!this.src; } };
  const context = vm.createContext({
    document: { querySelectorAll: () => buttons, getElementById: (id) => id === 'simulator-frame' ? frame : pages[id] },
    location: { hash: '' }, window: { addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/navigation.js`, 'utf8'), context);
  assert.equal(frame.src, undefined);
  buttons[1].listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(frame.src, './index.html?simulator');
  assert.equal(pages['converter-page'].hidden, true);
  assert.equal(pages['simulator-page'].hidden, false);
  assert.equal(buttons[3].attrs['aria-selected'], 'true');
  assert.equal(buttons[3].focused, true);
});

test('simulator import loads the shared player and preserves a valid job after a failed replacement', async () => {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      listeners: {}, children: [], dataset: {}, value: '', style: {},
      classList: { add() {}, remove() {} },
      setAttribute() {}, querySelector: node,
      addEventListener(key, callback) { this.listeners[key] = callback; },
      append(...children) { this.children.push(...children); }, prepend(...children) { this.children.unshift(...children); },
    });
    return nodes.get(id);
  };
  const refs = Object.fromEntries(['fileInput', 'uploadView', 'resultView', 'status', 'output'].map((key) => [key, node(key)]));
  refs.status.parentElement = { parentElement: node('layout') };
  const statuses = [], renders = [], resets = [];
  const context = vm.createContext({
    refs, state: {}, PREVIEW_COLORS: ['blue'],
    document: { querySelector: node, createElement: (tag) => ({ ...node(tag), children: [], listeners: {} }) },
    window: { addEventListener() {} },
    stopPlayback() {}, setStatus: (...args) => statuses.push(args),
    resetPlayback: (duration) => resets.push(duration), renderPreview: (...args) => renders.push(args),
    appendPlaybackMotion(segments, current, target, rate, motionType, color, lineIndex) {
      segments.push({ start: current, end: target, lineIndex });
      return { ...target, timeSec: current.timeSec + 1 };
    },
    computeBounds: () => ({ minX: 0, minY: 0, width: 10, height: 10 }),
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/simulator.js`, 'utf8'), context);
  vm.runInContext('setupGcodeSimulator()', context);
  const gcode = 'G21 G90\nG0 Z5\nG1 Z-1 F120\nX10 F600\nM30';
  await refs.fileInput.listeners.change({ target: { files: [{ name: 'job.nc', size: gcode.length, text: async () => gcode }] } });
  const generated = context.state.generated;
  assert.equal(generated.gcode, gcode);
  assert.equal(refs.output.value, gcode);
  assert.equal(renders.length, 1);
  assert.equal(resets[0], 3);
  assert.equal(generated.previewPaths.length, 2);
  assert.equal(generated.gcodeLineOffsets[3], gcode.indexOf('X10'));
  await refs.fileInput.listeners.change({ target: { files: [{ name: 'bad.nc', size: 3, text: async () => 'G92' }] } });
  assert.equal(context.state.generated, generated);
  assert.equal(statuses.at(-1)[1], true);
  assert.equal(renders.length, 1);
  assert.equal(refs.fileInput.value, '');
});
