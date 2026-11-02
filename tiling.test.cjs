const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateTiling, parseTilingGcode, clipTilingSegment } = require("./tiling.js");

const config = {
  machineWidth: 1000, machineHeight: 1000, stockWidth: 900, stockLength: 2400,
  stockThickness: 18, stockX: 30.1, guidePoints: [[20, 50], [20, 500], [20, 950]],
  indexXs: [100, 850], receiverY: 50, indexY: 980, holeDiameter: 20.2,
  holeDepth: 22, toolDiameter: 6, stepdown: 2, feed: 1000, plunge: 200, rpm: 18000, safeZ: 8,
};
const source = "G21\nG90\nG17\nG94\nG54\nG0 Z8\nM3 S18000\nG0 X400 Y0\nG1 Z-3 F200\nG1 Y2400 F1000\nG0 Z8\nM5\nM30";

test("930 mm advance yields independent sections and an initialization program", () => {
  const result = generateTiling(source, config);
  assert.equal(result.advance, 930);
  assert.equal(result.count, 3);
  assert.equal(result.files.length, 4);
  assert.equal((result.files[0].gcode.match(/\(Trou /g) || []).length, 5);
  assert.equal((result.files[1].gcode.match(/\(Trou /g) || []).length, 2);
  assert.equal((result.files[2].gcode.match(/\(Trou /g) || []).length, 2);
  assert.ok(!result.files[3].gcode.includes("(Trou "));
  for (const file of result.files) {
    assert.ok(file.gcode.startsWith("("));
    assert.ok(file.gcode.endsWith("G0 Z8\nM5\nM30"));
    // Every generated program must itself satisfy the supported dialect.
    assert.ok(parseTilingGcode(file.gcode, config.safeZ).length > 0);
  }
  assert.ok(result.files[1].gcode.includes("G1 X430.1 Y980 Z-3 F1000"));
  assert.ok(result.files[2].gcode.includes("G0 X430.1 Y50"));
  assert.ok(result.files[3].gcode.includes("G1 X430.1 Y590 Z-3 F1000"));
});

test("clipping interpolates XYZ, preserves feeds, and owns boundary lines only once", () => {
  const segment = { start: { x: 0, y: 0, z: 0 }, end: { x: 100, y: 200, z: -10 }, feed: 123 };
  const clipped = clipTilingSegment(segment, 50, 150, false);
  assert.deepEqual(clipped.start, { x: 25, y: 50, z: -2.5 });
  assert.deepEqual(clipped.end, { x: 75, y: 150, z: -7.5 });
  assert.equal(clipped.feed, 123);
  const boundary = { ...segment, start: { x: 0, y: 100, z: -3 }, end: { x: 100, y: 100, z: -3 } };
  assert.equal(clipTilingSegment(boundary, 0, 100, false), null);
  assert.ok(clipTilingSegment(boundary, 100, 200, true));
});

test("tabs and ramps keep their interpolated Z at the seam", () => {
  const ramp = source.replace("G1 Y2400 F1000", "G1 Y2400 Z-12 F777");
  const result = generateTiling(ramp, config);
  assert.ok(result.files[1].gcode.includes("Y980 Z-6.4875 F777"));
  assert.ok(result.files[2].gcode.includes("G1 Z-6.4875 F200"));
  assert.ok(result.files[3].gcode.includes("Y590 Z-12 F777"));
});

test("pockets clear their center, respect stepdown and reach configured depth and diameter", () => {
  const program = generateTiling(source, config).files[0].gcode;
  const segments = parseTilingGcode(program, 8);
  const first = segments.filter((s) => s.start.x >= 9.9 && s.start.x <= 30.1 && s.start.y < 61);
  assert.ok(first.some((s) => s.end.z === -22 && s.end.x === 20 && s.end.y === 50));
  assert.ok(first.some((s) => Math.abs(s.end.x - 27.1) < 0.0001)); // cutter center + radius 3 = 30.1
  for (const s of segments) {
    if (s.end.z < s.start.z && s.end.z < 0) assert.ok(s.start.z - s.end.z <= 2.00001);
  }
});

test("parser rejects unsupported modal states rather than silently changing a job", () => {
  for (const command of ["G2 X5 I2", "G91", "G20", "G92 X0", "G55", "G53 G0 X0", "M6", "G81 Z-5", "G90.1", "G93", "G4 P1", "T1", "G1 XNaN", "G0 G1 X0", "G1 X1 X2"]) {
    assert.throws(() => parseTilingGcode(source.replace("G1 Y2400 F1000", command), 8), /Ligne/);
  }
  assert.throws(() => parseTilingGcode(source.replace("G21\n", ""), 8), /G21/);
  assert.throws(() => parseTilingGcode(source.replace("M3 S18000", "M5"), 8), /broche/);
  assert.throws(() => parseTilingGcode(source.replace("G0 Z8\nM5", "G0 Y10\nM5"), 8), /rapide sous/);
  assert.throws(() => parseTilingGcode(source + "\nG0 X0", 8), /après la fin/);
});

test("reject invalid geometry, unsafe holes, out-of-range cuts and indexing collisions", () => {
  for (const change of [
    { indexY: 50 }, { stockWidth: 1000 }, { holeDiameter: 6 }, { holeDepth: 10 },
    { guidePoints: [[0, 50]] }, { guidePoints: [[40, 50]] }, { indexXs: [100, 100] },
    { indexXs: [10, 850] }, { safeZ: NaN }, { stepdown: 0 }, { stockLength: 930.1 },
  ]) assert.throws(() => generateTiling(source, { ...config, ...change }));
  assert.throws(() => generateTiling(source.replace("X400", "X950"), config), /dépasse/);
  assert.throws(() => generateTiling(source.replace("X400", "X69.9"), config), /croise un trou/);
});

test("a short job and exact multiples have no redundant index holes or empty last section", () => {
  for (const length of [500, 930, 1860]) {
    const result = generateTiling(source.replace("Y2400", `Y${length}`), { ...config, stockLength: length });
    assert.equal(result.count, Math.ceil(length / 930));
    assert.ok(!result.files.at(-1).gcode.includes("(Trou "));
  }
});

test("modal feed and speed, comments, lowercase and line numbers are accepted", () => {
  const segments = parseTilingGcode("n1 g21 g90 (mm)\ns17000\nm3\ng0 z8\ng0 x20 y20\ng1 z-2 f123\ny30 ; cut\ng0 z8\nm30", 8);
  assert.equal(segments[1].feed, 123);
  assert.equal(segments[1].rpm, 17000);
});

test("the existing C2D generator feeds the tiling workflow without a dialect conversion", () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const app = vm.createContext({
    document: { getElementById: () => ({}) },
    window: { initSqlJs: () => new Promise(() => {}) }, TextDecoder, Uint8Array, console,
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, "utf8"), app);
  const element = { uuid: "long-contour", geometryType: "rectangle", position: [400, 1200], width: 100, height: 2300 };
  const generated = app.generateGcode({
    document: { safeZ: 8, zeroX: 0, zeroY: 0 }, parseWarnings: [],
    elementsByUuid: new Map([[element.uuid, element]]),
    toolpaths: [{ type: "contour", elements: [{ uuid: element.uuid }], tool: { diameter: 6 },
      end_depth: 6, stepdown: 2, speeds: { feedrate: 1000, plungerate: 200, rpm: 18000 } }],
  }, "long-panel.c2d");
  const result = generateTiling(generated.gcode, config);
  assert.equal(result.count, 3);
  for (const file of result.files) assert.ok(parseTilingGcode(file.gcode, 8).length);
});

test("navigation switches views with an inline calculator and no iframe load", () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const buttons = ["feedrate", "converter", "tiling"].map((page) => ({
    dataset: { page }, attrs: {}, listeners: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
    focus() { this.focused = true; },
    click() { this.listeners.click(); },
  }));
  const pages = Object.fromEntries(buttons.map((button) => [`${button.dataset.page}-page`, { hidden: false }]));
  const frame = { dataset: { src: "./feedrate_calculator.html" }, hasAttribute() { return !!this.src; } };
  const windowListeners = {};
  const context = vm.createContext({
    document: { querySelectorAll: () => buttons, getElementById: (id) => id === "feedrate-frame" ? frame : pages[id] },
    location: { hash: "" }, window: { addEventListener(key, callback) { windowListeners[key] = callback; } },
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/navigation.js`, "utf8"), context);
  assert.equal(pages["converter-page"].hidden, false);
  assert.equal(pages["tiling-page"].hidden, true);
  assert.equal(frame.src, undefined);
  assert.equal(buttons[1].attrs["aria-selected"], "true");
  assert.deepEqual(buttons.map((button) => button.tabIndex), [-1, 0, -1]);
  buttons[2].listeners.click();
  assert.equal(pages["converter-page"].hidden, true);
  assert.equal(pages["tiling-page"].hidden, false);
  assert.equal(buttons[2].attrs["aria-current"], "page");
  buttons[0].listeners.click();
  assert.equal(frame.src, undefined);
  assert.equal(pages["feedrate-page"].hidden, false);
  assert.equal(pages["tiling-page"].hidden, true);
  const press = (index, key) => {
    let prevented = false;
    buttons[index].listeners.keydown({ key, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(press(0, "ArrowLeft"), true);
  assert.equal(buttons[2].focused, true);
  assert.equal(context.location.hash, "tiling");
  assert.deepEqual(buttons.map((button) => button.attrs["aria-selected"]), ["false", "false", "true"]);
  assert.deepEqual(buttons.map((button) => button.tabIndex), [-1, -1, 0]);
  assert.equal(press(2, "ArrowRight"), true);
  assert.equal(context.location.hash, "feedrate");
  press(0, "End");
  assert.equal(context.location.hash, "tiling");
  press(2, "Home");
  assert.equal(context.location.hash, "feedrate");
  assert.equal(press(0, "Tab"), false);
  context.location.hash = "#converter";
  windowListeners.hashchange();
  assert.equal(pages["converter-page"].hidden, false);
  context.location.hash = "#unknown";
  windowListeners.hashchange();
  assert.equal(buttons[1].attrs["aria-selected"], "true");
});
