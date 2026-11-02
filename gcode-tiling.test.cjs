const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { test } = require("node:test");
const app = vm.createContext({ console, TextEncoder, Blob });
for (const file of ["tiling.js", "gcode-tiling.js"]) vm.runInContext(fs.readFileSync(`${__dirname}/${file}`, "utf8"), app);
const config = { machineHeight: 100, indexY: 95, indexX: 95,
  toolDiameter: 6, holeDepth: 3, margin: 2 };
const source = "(Carbide Create)\nG21\nG90\nG17\nG54\nT1 M6\nG0 Z8\nM3 S18000\nG0 X150 Y0\nG1 Z-12 F200\nG1 Y250 F1000\nG0 Z8\nM5\nM30";
function simulate(program, height = 100) {
  const position = { x: 0, y: 0, z: 8 }, moves = [];
  for (const line of program.split("\n")) {
    if (!/^G[01] /.test(line)) continue;
    const start = { ...position };
    for (const [, axis, text] of line.matchAll(/([XYZ])([+-]?[\d.]+)/g)) position[axis.toLowerCase()] = Number(text);
    assert.ok(position.y >= -0.0002 && position.y <= height + 0.0002, `local Y out of bounds: ${line}`);
    moves.push({ start, end: { ...position }, feed: line.startsWith("G1 ") });
  }
  return moves;
}

test("95 to 5 is 90 mm: one cutter-size hole first, local Y sections and fixed G54", () => {
  const plan = app.planGcodeSections(source, config);
  assert.equal(plan.advance, 90); assert.equal(plan.overlap, 10); assert.equal(plan.count, 3);
  const files = app.generateGcodeSections(plan);
  assert.deepEqual(Array.from(files, (file) => file.name), ["section_1.nc", "section_2.nc", "section_3.nc"]);
  for (const [index, file] of files.entries()) {
    assert.ok(!/G92|G10\b/.test(file.gcode));
    assert.equal((file.gcode.match(/Trou de reference/g) || []).length, index < 2 ? 1 : 0);
    const moves = simulate(file.gcode);
    const drilling = moves.filter((move) => move.feed && move.end.x === 95);
    if (index < 2) {
      assert.ok(drilling.length > 0);
      assert.ok(drilling.every((move) => move.end.x === 95 && move.end.y === 95));
      assert.ok(drilling.some((move) => move.end.z === -3));
      assert.ok(file.gcode.indexOf("G0 X95 Y95") < file.gcode.indexOf("G0 X150"));
    } else assert.equal(drilling.length, 0);
    assert.ok(file.gcode.endsWith("G0 Z8\nM5\nG0 X0 Y0\nM30"));
  }
  assert.ok(files[1].gcode.includes("G0 X150 Y0"));
  assert.ok(files[2].gcode.includes("G1 X150 Y70 Z-12 F1000"));
});

test("reference drilling inherits source values and ignores obsolete manual overrides", () => {
  const shallowSource = source.replace("Z-12 F200", "Z-0.5 F123");
  const plan = app.planGcodeSections(shallowSource, { ...config, toolDiameter: 2, stepdown: 10, plunge: 999, safeZ: 1, holeDepth: 1.5 });
  assert.equal(plan.holeDepth, 1.5); // source goes to -12; alignment does not require a through-hole
  const file = app.generateGcodeSections(plan)[0].gcode;
  for (const depth of [0.5, 1, 1.5]) assert.ok(file.includes(`G1 Z-${depth} F123\nG0 Z8`));
  assert.equal(plan.plunge, 123); assert.equal(plan.stepdown, 0.5); assert.equal(plan.safeZ, 8);
  assert.throws(() => app.planGcodeSections(source.replaceAll("Z8", "Z0"), config), /dégagement positif/);
});

test("ramp descent uses vertical speed, aggregates linearized runs, and caps axial depth", () => {
  const ramp = source.replace("G1 Z-12 F200\nG1 Y250 F1000", "G1 Z0 F200\nG1 X153 Z-4 F500\nG1 Y250 F1000");
  const plan = app.planGcodeSections(ramp, config);
  assert.equal(plan.plunge, 400); // 500 * 4 / sqrt(3² + 4²)
  assert.equal(plan.observedStepdown, 4); assert.equal(plan.stepdown, 2);
  const html = fs.readFileSync(`${__dirname}/index.html`, "utf8").split('<main id="tiling-page"')[1];
  for (const name of ["safeZ", "stepdown", "plunge", "margin"]) assert.ok(!html.includes(`name="${name}"`));
});

test("provisional preview works before a point is selected, but export is blocked", () => {
  const plan = app.planGcodeSections(source, { ...config, indexX: null, indexY: null });
  assert.equal(plan.hasReference, false);
  assert.throws(() => app.generateGcodeSections(plan), /Renseigner les coordonnées/);
  const single = app.planGcodeSections(source.replace("Y250", "Y80"), { ...config, indexX: null, indexY: null });
  assert.equal(single.count, 1);
  assert.ok(!app.generateGcodeSections(single)[0].gcode.includes("Trou de reference"));
});

test("suggests a high reference in the widest common uncut column and validates every repeat", () => {
  const provisional = app.planGcodeSections(source, { ...config, indexX: null, indexY: null });
  const point = app.suggestSectionReference(provisional);
  assert.ok(point);
  assert.equal(point.y, 95);
  assert.ok(point.x > 50 && point.x < 100);
  const plan = app.planGcodeSections(source, { ...config, indexX: point.x, indexY: point.y });
  assert.equal(plan.count, 3);
  assert.equal(app.generateGcodeSections(plan).length, 3);
  const blockedSource = source.replace("G1 Y250 F1000", "G1 X0 Y250 F1000");
  const blocked = app.planGcodeSections(blockedSource, { ...config, indexX: null, indexY: null });
  assert.equal(app.suggestSectionReference(blocked), null);
  const single = app.planGcodeSections(source.replace("Y250", "Y80"), { ...config, indexX: null, indexY: null });
  assert.equal(app.suggestSectionReference(single), null);
});

test("oversized stock does not add empty trailing sections but still bounds reference holes", () => {
  const settings = { ...config, machineWidth: 1000, stockWidth: 900, stockHeight: 400 };
  const plan = app.planGcodeSections(source, settings);
  assert.equal(plan.count, 3); // stop at the last source cut, not the stock edge
  assert.equal(plan.tiles.at(-1).high, 250);
  const files = app.generateGcodeSections(plan);
  assert.equal(files.length, 3);
  assert.ok(!files.at(-1).gcode.includes("Trou de reference"));
  const short = app.planGcodeSections(source.replace("Y250", "Y80"), settings);
  assert.equal(short.count, 1);
  assert.equal(app.generateGcodeSections(short).length, 1);
  assert.ok(!app.generateGcodeSections(short)[0].gcode.includes("Trou de reference"));
  const proposed = app.suggestSectionReference(app.planGcodeSections(source, { ...settings, indexX: null, indexY: null }));
  assert.ok(proposed.x > 150); // use unmachined stock, not just the drawing bounds
  assert.ok(app.planGcodeSections(source, { ...settings, indexX: proposed.x, indexY: proposed.y }));
  for (const change of [{ stockWidth: null }, { stockHeight: 0 }, { stockWidth: 1001 }, { stockWidth: 100 }, { stockHeight: 200 }, { indexX: 899 }]) {
    assert.throws(() => app.planGcodeSections(source, { ...settings, ...change }));
  }
});

test("all repeated hole positions are checked, without inventing a receiving hole", () => {
  const collision = source.replace("G0 Z8\nM5", "G0 Z8\nG0 X95 Y180\nG1 Z-1 F200\nG1 Y190 F1000\nG0 Z8\nM5");
  const colliding = app.planGcodeSections(collision, config);
  assert.match(colliding.warnings[0], /Y=185/);
  assert.throws(() => app.generateGcodeSections(colliding), /Y=185/);
  const atReceiver = source.replace("G0 Z8\nM5", "G0 Z8\nG0 X95 Y4\nG1 Z-1 F200\nG1 Y6 F1000\nG0 Z8\nM5");
  assert.ok(app.planGcodeSections(atReceiver, config));
   for (const change of [{ indexX: NaN }, { indexX: -1 }, { indexY: 101 }, { indexY: 6 }, { holeDepth: 0 }]) assert.throws(() => app.planGcodeSections(source, { ...config, ...change }));
});

test("ramp clipping preserves interpolated Z, modal feed, and local Y", () => {
  const plan = app.planGcodeSections(source.replace("Y250 F1000", "Y250 Z-17 F777"), config);
  const files = app.generateGcodeSections(plan);
  assert.ok(files[0].gcode.includes("G1 X150 Y100 Z-14 F777"));
  assert.ok(files[1].gcode.includes(`G1 Z-13.8 F${Number(plan.plunge.toFixed(4))}`));
  for (const file of files) simulate(file.gcode);
});

test("950 to 50 means 900 mm, not 90 mm", () => {
  const plan = app.planGcodeSections(source.replace("Y250", "Y2500"), { ...config, machineHeight: 1000, indexY: 950 });
  assert.equal(plan.receiverY, 50);
  assert.equal(plan.advance, 900); assert.equal(plan.count, 3);
  for (const file of app.generateGcodeSections(plan)) simulate(file.gcode, 1000);
});

test("alignment follows the selected rear clearance and respects cutter clearance automatically", () => {
  const plan = app.planGcodeSections(source, { ...config, indexY: 90 });
  assert.equal(plan.receiverY, 10);
  assert.equal(plan.advance, 80);
  const lower = app.planGcodeSections(source, { ...config, indexY: 40 });
  assert.equal(lower.advance, 8); // receiver adapts instead of rejecting the lower half of the workspace
  assert.ok(lower.count > plan.count);
  const nearEdge = app.planGcodeSections(source, { ...config, indexY: 97 });
  assert.equal(nearEdge.receiverY, 5); // radius 3 + margin 2, not an unsafe 3 mm
  assert.equal(nearEdge.advance, 92);
  const changedTool = app.planGcodeSections(source, { ...config, toolDiameter: 8, margin: 4 });
  assert.equal(changedTool.receiverY, 8);
  assert.equal(changedTool.advance, 87);
  assert.match(app.sectionChecklist(plan, 1).join(" "), /X=95, Y=10/);
  assert.equal(app.planGcodeSections(source, { ...config, receiverY: -500 }).receiverY, 5); // obsolete input cannot override automatic alignment
  const html = fs.readFileSync(`${__dirname}/index.html`, "utf8");
  assert.ok(!html.includes('name="receiverY"'));
  for (const file of app.generateGcodeSections(nearEdge)) simulate(file.gcode);
});

test("arcs supported and unsafe source dialects refused", () => {
  const arc = "G21\nG90\nG17\nG91.1\nG54\nT1 M6\nG0 Z8\nM3 S12000\nG0 X150 Y10\nG1 Z-2 F100\nG3 X150 Y10 I0 J10 F500\nG0 Z8\nM5\nM30";
  assert.ok(app.planGcodeSections(arc, config).cuts.length > 20);
  for (const command of ["G92 Y0", "G10 L20 P1 Y0", "G91", "G20", "G55", "T2 M6", "M6"]) assert.throws(() => app.planGcodeSections(source.replace("G1 Y250 F1000", command), config));
});

test("preview supports captured drag and drop, ignores clicks and cancels interrupted drags", () => {
  const nodes = [];
  app.document = { createElementNS: (_ns, name) => create(name), createElement: (name) => create(name), createTextNode: (text) => text };
  function create(name) {
    const node = { name, attrs: {}, children: [], style: {}, listeners: {},
      setAttribute(key, value) { this.attrs[key] = value; }, append(...items) { this.children.push(...items); },
      addEventListener(key, callback) { this.listeners[key] = callback; },
      setPointerCapture(id) { this.captured = id; },
      hasPointerCapture(id) { return this.captured === id; },
      releasePointerCapture() { this.captured = null; },
      getScreenCTM() { return { a: 2, b: 0, c: 0, d: 2, e: 140, f: 80, inverse: () => ({}) }; },
      createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x / 2, y: this.y / 2 }; } }; },
    }; nodes.push(node); return node;
  }
   const plan = app.planGcodeSections(source, { ...config, machineWidth: 1000, stockWidth: 200, stockHeight: 250 });
   let selected;
  app.renderGcodeSections(plan, { replaceChildren() {}, append() {} }, (point) => { selected = point; });
  const inputs = nodes.filter((node) => node.name === "input"), groups = nodes.filter((node) => node.name === "g" && node.attrs["data-section"]);
  assert.equal(inputs.length, 3);
  inputs[1].checked = false; inputs[1].listeners.change(); assert.equal(groups[1].style.display, "none");
   const svg = nodes.find((node) => node.name === "svg");
   const [viewX, , viewWidth] = svg.attrs.viewBox.split(" ").map(Number);
    assert.ok(viewX <= 0 && viewX + viewWidth >= 1000); // full machine width, not the X150 drawing extent
    assert.equal(svg.attrs.preserveAspectRatio, "xMinYMid meet");
    const stock = nodes.find((node) => node.attrs && "data-stock" in node.attrs);
    assert.equal(stock.attrs.x, 0);
    for (const group of groups) {
      const area = group.children.find((node) => node.name === "rect");
      assert.equal(area.attrs.x, stock.attrs.x);
      assert.equal(area.attrs.width, 1000);
    }
   assert.equal(svg.listeners.click, undefined);
    const handles = nodes.filter((node) => node.name === "g" && node.listeners.pointerdown);
   assert.equal(handles.length, 2);
   const handleLayer = nodes.find((node) => "data-reference-handles" in node.attrs);
   assert.deepEqual(handleLayer.children, handles);
   assert.equal(svg.children.at(-1), handleLayer);
    for (const [index, marker] of handles.entries()) {
      const target = marker.children.find((child) => child.attrs?.["pointer-events"] === "all");
      const hole = marker.children.find((child) => child.attrs?.fill === "#ef8d23" && !child.attrs["fill-opacity"]);
      const halo = marker.children.find((child) => child.attrs?.["fill-opacity"] === 0.22);
      assert.equal(target.attrs.r, 12); // 24 screen pixels / 2 pixels per SVG unit
      assert.equal(halo.attrs.r, 7);
      assert.equal(target.attrs["stroke-width"], undefined);
      for (const circle of [hole, halo, target]) {
        assert.equal(circle.attrs.cx, plan.indexX);
        assert.equal(circle.attrs.cy, 270 - plan.indexY - index * plan.advance);
      }
   }
   assert.equal(handles[1].style.display, "none");
   inputs[1].checked = true; inputs[1].listeners.change();
   assert.equal(handles[1].style.display, "");
   const handle = handles[0];
  const event = (x, y, pointerId = 1) => ({ clientX: x, clientY: y, pointerId, button: 0, preventDefault() {} });
  handle.listeners.pointerdown(event(194, 350)); // grab off-center, preserve the grab offset
  handle.listeners.pointermove(event(174, 354));
   assert.equal(handle.attrs.transform, "translate(-10 2)");
   assert.equal(handles[1].attrs.transform, "translate(-10 2)");
  assert.equal(selected, undefined); // validate only at drop
  handle.listeners.pointerup(event(174, 354));
  assert.equal(selected.x, 85); assert.equal(selected.y, 93);
  assert.equal(handle.captured, null);
  selected = undefined;
  handle.listeners.pointerdown(event(190, 350));
  handle.listeners.pointerup(event(190, 350));
  assert.equal(selected, undefined); // click without movement does not recalculate
   for (const cancellation of ["pointercancel", "lostpointercapture"]) {
    handle.listeners.pointerdown(event(190, 350));
    handle.listeners.pointermove(event(170, 354));
    handle.listeners[cancellation](event(170, 354));
    assert.equal(selected, undefined);
     assert.equal(handle.attrs.transform, "translate(0 0)");
     assert.equal(handles[1].attrs.transform, "translate(0 0)");
   }
   // Dragging a later section's marker updates the same base point, not its global Y.
   const later = handles[1];
   later.listeners.pointerdown(event(190, 170));
   later.listeners.pointermove(event(210, 166));
   for (const marker of handles) assert.equal(marker.attrs.transform, "translate(10 -2)");
   handle.listeners.pointerdown(event(190, 350, 2)); // ignore a second simultaneous pointer
   assert.equal(handle.captured, null);
   later.listeners.pointerup(event(210, 166));
   assert.equal(selected.x, 105); assert.equal(selected.y, 96);
   const updated = app.planGcodeSections(source, { ...config, indexX: selected.x, indexY: selected.y });
   assert.equal(updated.indexY + updated.advance, plan.indexY + plan.advance + 2);
   for (const marker of handles) assert.equal(marker.attrs.transform, "translate(0 0)");
  const steps = app.sectionChecklist(plan, 1).join(" ");
  assert.match(steps, /X=95, Y=5/); assert.match(steps, /90 mm/);
  assert.match(steps, /broche arrêtée/); assert.match(steps, /Dégager la pige verticalement/);
  assert.match(steps, /Ne pas remettre XY à zéro/);
  delete app.document;
});

test("reference can reach the maximum center travel Y and X is not limited to drawing bounds", () => {
  const top = app.planGcodeSections(source, { ...config, indexY: 100, indexX: 500 });
  assert.equal(top.indexY, 100);
  assert.equal(top.receiverY, 5);
  assert.equal(top.advance, 95);
  const lower = app.planGcodeSections(source, { ...config, indexY: 85, indexX: 500 });
  assert.ok(top.advance > lower.advance);
  assert.ok(top.count <= lower.count);
  const edge = app.planGcodeSections(source, { ...config, indexX: 0 });
  assert.equal(edge.indexX, 0);
  for (const file of app.generateGcodeSections(top)) simulate(file.gcode);
  for (const x of [0, 500, 1000]) {
    const fullWidth = app.planGcodeSections(source, { ...config, machineWidth: 1000, indexX: x });
    assert.equal(fullWidth.indexX, x);
  }
  assert.throws(() => app.planGcodeSections(source, { ...config, machineWidth: 1000, indexX: 1001 }), /largeur utile X/);
});

test("preview zoom, fit, wheel anchoring and captured panning preserve view state", () => {
  const svg = { attrs: {}, style: {}, listeners: {}, clientHeight: 500,
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    getScreenCTM() { return { a: 2, b: 0, inverse: () => ({}) }; },
    createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x / 2, y: this.y / 2 }; } }; },
    setPointerCapture(id) { this.captured = id; }, hasPointerCapture(id) { return this.captured === id; }, releasePointerCapture() { this.captured = null; },
  };
  let view, percent;
  const initial = { x: 0, y: 0, width: 1000, height: 500 };
  const nav = app.navigateSectionPreview(svg, initial, (value, zoom) => { view = value; percent = zoom; });
  nav.zoom(2); assert.equal(percent, 200); assert.equal(view.width, 500);
  nav.zoom(0.5); assert.equal(percent, 100);
  svg.listeners.wheel({ preventDefault() {}, clientX: 200, clientY: 100, deltaY: -50, deltaMode: 0 });
  assert.ok(view.width < 1000);
  nav.fit(); assert.equal(view.x, 0); assert.equal(percent, 100);
  const event = (x, y) => ({ clientX: x, clientY: y, pointerId: 4, button: 0, preventDefault() {} });
  svg.listeners.pointerdown(event(100, 100));
  svg.listeners.pointermove(event(120, 140)); assert.equal(view.x, -10); assert.equal(view.y, -20);
  svg.listeners.pointermove(event(140, 160)); assert.equal(view.x, -20); assert.equal(view.y, -30);
  svg.listeners.pointercancel(event(140, 160)); assert.equal(svg.captured, null);
  const saved = { ...view };
  app.navigateSectionPreview(svg, initial, (value) => { view = value; }, saved);
  assert.equal(view.x, -20); // point relocation must not reset the zoom/pan
});

test("one ZIP contains every section as an exact stored file with valid CRC and directory offsets", async () => {
  const files = [{ name: "section_1.nc", gcode: "123456789" }, { name: "section_2.nc", gcode: "G21\nM30" }];
  const blob = app.sectionArchive(files);
  assert.equal(blob.type, "application/zip");
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), files.length);
  let directory = view.getUint32(end + 16, true);
  for (const [index, file] of files.entries()) {
    assert.equal(view.getUint32(directory, true), 0x02014b50);
    const offset = view.getUint32(directory + 42, true), length = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true);
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength)), file.name);
    assert.equal(new TextDecoder().decode(bytes.slice(offset + 30 + nameLength, offset + 30 + nameLength + length)), file.gcode);
    if (index === 0) assert.equal(view.getUint32(offset + 14, true), 0xcbf43926); // published CRC-32 test vector
    directory += 46 + nameLength;
  }
  assert.equal(directory, end);
  const html = fs.readFileSync(`${__dirname}/index.html`, "utf8");
  const sidebar = html.split('<aside class="panel tiling-sidebar"')[1].split("</aside>")[0];
  assert.ok(!sidebar.includes("tiling-plan-summary"));
  assert.ok(!sidebar.includes("tiling-confirm"));
  assert.equal((sidebar.match(/<button /g) || []).length, 1);
});

test("onboarding import advances to live settings, validates minima and opens the workspace", async () => {
  const elements = new Map(), values = { machineWidth: "1000", machineHeight: "100", toolDiameter: "6", holeDepth: "3", stockWidth: "", stockHeight: "" };
  function node(id = "") {
    return { id, value: "", hidden: false, checked: false, disabled: false, textContent: "", children: [], listeners: {}, attrs: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
      focus() { this.focused = true; }, setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
      querySelector() { return this.children.find((child) => child.id === "small"); },
      classList: { add() {}, remove() {} },
      click() { return this.listeners.click?.(); },
    };
  }
  function get(id) { if (!elements.has(id)) elements.set(id, node(id)); return elements.get(id); }
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const input = node(key); input.value = value; input.parentElement = node(`${key}-label`); return [key, input];
  }));
  const form = get("tiling-form");
  form.elements = { namedItem: (name) => fields[name] };
  form.checkValidity = form.reportValidity = () => Object.values(fields).every((field) => field.value !== "" && Number(field.value) >= Number(field.min || 0));
  class FormDataMock {
    *[Symbol.iterator]() {
      for (const [key, field] of Object.entries(fields)) yield [key, String(field.value)];
      yield ["indexX", String(get("tiling-reference-x").value)];
      yield ["indexY", String(get("tiling-reference-y").value)];
    }
  }
  const context = vm.createContext({ console, FormData: FormDataMock, document: { getElementById: get, createElement: node } });
  for (const file of ["tiling.js", "gcode-tiling.js"]) vm.runInContext(fs.readFileSync(`${__dirname}/${file}`, "utf8"), context);
  vm.runInContext("renderGcodeSections = (plan) => { globalThis.renderedPlan = plan; }", context);
  await get("tiling-file").listeners.change({ target: { files: [{ name: "panel.nc", text: async () => source }] } });
  assert.equal(get("tiling-upload-step").hidden, true);
  assert.equal(get("tiling-settings-step").hidden, false);
  assert.equal(get("tiling-selection").hidden, true);
  assert.equal(fields.stockWidth.value, 150);
  assert.equal(fields.stockHeight.value, 250);
  assert.equal(fields.stockWidth.min, "150");
  assert.equal(fields.stockHeight.min, "250");
  assert.equal(fields.machineHeight.min, "27");
  assert.equal(get("tiling-next").disabled, false);
  assert.match(get("tiling-live-info").textContent, /section/);
  fields.stockWidth.value = "140";
  form.listeners.input();
  assert.equal(get("tiling-next").disabled, true);
  assert.match(get("tiling-live-info").textContent, /minima/);
  fields.stockWidth.value = "400";
  form.listeners.input();
  assert.equal(get("tiling-next").disabled, false);
  await get("tiling-next").click();
  assert.equal(get("tiling-settings-step").hidden, true);
  assert.equal(get("tiling-selection").hidden, false);
  assert.equal(get("tiling-error").hidden, true);
   assert.equal(get("tiling-export").disabled, false);
  assert.equal(context.renderedPlan.stockWidth, 400);
  fields.machineHeight.value = "300"; form.listeners.input();
  assert.equal(context.renderedPlan.count, 1); // live recalc, no calculate button
  get("tiling-back").click();
  assert.equal(get("tiling-settings-step").hidden, false);
  assert.ok(!get("tiling-settings-sidebar").children.includes(form));
  const html = fs.readFileSync(`${__dirname}/index.html`, "utf8");
  assert.ok(!html.includes("Calculer les sections</button>"));
});

test("preview survives repeated invalid selections and manual edits while export stays blocked", () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, checked: false, textContent: "", listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      replaceChildren() {}, append() {}, focus() {}, setAttribute() {}, removeAttribute() {},
      reportValidity() { return true; }, checkValidity() { return true; },
      click() { this.listeners.click?.(); } });
    return elements.get(id);
  }
  const fields = { ...config, indexX: null, indexY: null };
  class FormDataMock {
    *[Symbol.iterator]() {
      for (const [key, value] of Object.entries(fields)) yield [key, String(key === "indexX" ? element("tiling-reference-x").value : key === "indexY" ? element("tiling-reference-y").value : value)];
    }
  }
  const context = vm.createContext({ console, FormData: FormDataMock, document: { getElementById: element } });
  vm.runInContext(fs.readFileSync(`${__dirname}/tiling.js`, "utf8"), context);
  vm.runInContext(fs.readFileSync(`${__dirname}/gcode-tiling.js`, "utf8"), context);
  vm.runInContext("renderGcodeSections = (plan, container, select) => { globalThis.selectPoint = select; globalThis.renderedPlan = plan; }", context);
  element("tiling-source").value = source;
  const submit = () => element("tiling-form").listeners.submit({ preventDefault() {} });
  const preview = element("tiling-selection"), status = element("tiling-error");
  submit(); element("tiling-next").listeners.click(); assert.equal(preview.hidden, false);
  for (const y of [200, 220]) {
    element("tiling-reference-x").value = "95"; element("tiling-reference-y").value = String(y);
    submit();
    assert.equal(preview.hidden, false);
    assert.match(status.textContent, /Plan refusé/);
    element("tiling-export").listeners.click();
    assert.match(status.textContent, /Calculer les sections/);
  }
   element("tiling-reference-x").value = "95"; element("tiling-reference-y").value = "95"; submit();
  assert.equal(preview.hidden, false); assert.equal(status.hidden, true);
  element("tiling-reference-y").value = "250";
  element("tiling-reference-y").listeners.input();
  assert.equal(preview.hidden, false); assert.match(status.textContent, /Plan refusé/);
  // Exercise the real click callback repeatedly; no requestSubmit/native validation is needed.
  for (const point of [{ x: 90, y: 94 }, { x: 85, y: 93 }, { x: 80, y: 92 }]) {
    context.selectPoint(point);
    assert.equal(preview.hidden, false);
    assert.equal(status.hidden, true);
    assert.equal(context.renderedPlan.indexX, point.x);
    assert.equal(context.renderedPlan.indexY, point.y);
    assert.equal(element("tiling-reference-x").value, point.x);
    assert.equal(element("tiling-export").disabled, false);
  }
  context.selectPoint({ x: 150, y: 95 }); // collides with source cut
  assert.match(status.textContent, /croise ou approche/);
  assert.equal(element("tiling-reference-x").value, 150);
  assert.equal(context.renderedPlan.indexX, 150);
  assert.equal(element("tiling-export").disabled, true);
  context.selectPoint({ x: 75, y: 95 });
  assert.equal(status.hidden, true);
  assert.equal(context.renderedPlan.indexX, 75);
});
