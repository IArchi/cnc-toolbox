function sectionSourceRequirements(source) {
  const clean = source.replace(/\([^()]*\)/g, "").replace(/;[^\r\n]*/g, "");
  const safeZ = [...clean.matchAll(/Z\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)].reduce((max, match) => Math.max(max, Number(match[1])), 0);
  if (!Number.isFinite(safeZ) || safeZ <= 0) throw new Error("Le fichier ne définit pas de Z de dégagement positif. Corriger le G-code source avant le découpage.");
  const segments = parseTilingGcode(source, safeZ, { arcs: true, initialTool: true });
  const cuts = segments.filter((segment) => Math.min(segment.start.z, segment.end.z) < 0);
  if (cuts.some((segment) => Math.min(segment.start.x, segment.end.x, segment.start.y, segment.end.y) < 0)) throw new Error("Les usinages doivent être du côté X/Y positif du zéro G54 initial. Exporter le fichier avec cette origine.");
  return { safeZ, segments, cuts,
    width: cuts.reduce((max, segment) => Math.max(max, segment.start.x, segment.end.x), 0),
    height: cuts.reduce((max, segment) => Math.max(max, segment.start.y, segment.end.y), 0) };
}

// G54 stays fixed: the physical panel movement is represented by local Y coordinates in each file.
function planGcodeSections(source, config) {
  config = { ...config, margin: config.margin ?? 5 };
  for (const key of ["stockWidth", "stockHeight"]) {
    if (key in config && (!Number.isFinite(config[key]) || config[key] <= 0)) throw new Error("Renseigner la largeur et la hauteur réelles de la plaque, en mm.");
  }
  if (config.stockWidth != null && config.machineWidth != null && config.stockWidth > config.machineWidth) throw new Error("La plaque dépasse la largeur utile X : le déplacement est possible uniquement suivant Y.");
  if (config.machineWidth != null && (!Number.isFinite(config.machineWidth) || config.machineWidth <= 0)) throw new Error("La largeur utile X doit être positive.");
  for (const key of ["machineHeight", "toolDiameter", "holeDepth"]) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new Error(`Valeur positive requise : ${key}.`);
  }
  if (!Number.isFinite(config.margin) || config.margin < 0) throw new Error("Marge invalide.");
  const radius = config.toolDiameter / 2;
  const hasReference = config.indexX != null && config.indexY != null;
  if (hasReference && (![config.indexX, config.indexY].every(Number.isFinite) || config.indexX < 0)) throw new Error("Le repère doit avoir des coordonnées finies et un X positif ou nul.");
  if (hasReference && config.machineWidth != null && config.indexX > config.machineWidth) throw new Error("Le repère dépasse la largeur utile X.");
  // Mirror the selected point's rear clearance at the front, never closer than cutter radius + margin.
  // Before selection, provisional tiles reserve 5% of Y (or the required cutter clearance) at each end.
  const referenceY = hasReference ? config.indexY : config.machineHeight - Math.max(config.machineHeight * 0.05, radius + config.margin);
  const receiverY = Math.max(radius + config.margin, Math.min(config.machineHeight - referenceY, referenceY - config.toolDiameter - config.margin));
  const advance = referenceY - receiverY;
  if (advance < config.toolDiameter + config.margin) throw new Error("Placer le repère plus haut dans la première section pour permettre le glissement. La position d'alignement et le dégagement sont calculés automatiquement.");
  if (referenceY > config.machineHeight) throw new Error("Le centre du repère ne peut pas dépasser la hauteur utile Y maximale.");
  const { safeZ, segments, cuts, height: maxY } = sectionSourceRequirements(source);
  if (cuts.some((segment) => [segment.start, segment.end].some((point) => (config.stockWidth != null && (point.x < 0 || point.x > config.stockWidth)) || (config.stockHeight != null && point.y > config.stockHeight)))) throw new Error("Le parcours dépasse les dimensions de la plaque. Vérifier les dimensions et l'origine du G-code.");
  const count = Math.max(1, 1 + Math.ceil(Math.max(0, maxY - config.machineHeight) / advance));
  if (count > 100) throw new Error("Plus de 100 sections : vérifier les positions d'indexation et la course Y.");
  let plunge = Infinity, observedStepdown = Infinity, descent = 0;
  for (const segment of segments) {
    if (segment.breakBefore || segment.end.z >= segment.start.z - 1e-6) {
      if (descent > 1e-6) observedStepdown = Math.min(observedStepdown, descent);
      descent = 0;
    }
    if (segment.end.z < segment.start.z - 1e-6 && segment.end.z < 0) {
      const dz = segment.start.z - segment.end.z;
      const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y, dz);
      plunge = Math.min(plunge, segment.feed * dz / length);
      descent += Math.min(0, segment.start.z) - segment.end.z;
    }
  }
  if (descent > 1e-6) observedStepdown = Math.min(observedStepdown, descent);
  if (!Number.isFinite(plunge) || !Number.isFinite(observedStepdown)) throw new Error("Aucune descente d'usinage exploitable dans le G-code pour déduire la plongée et les passes du repère.");
  // ponytail: the CAM stepdown is not encoded in G-code; use observed descent runs, capped for axial drilling.
  const stepdown = Math.min(observedStepdown, config.toolDiameter / 2, 2);
  if (![plunge, stepdown].every((value) => Number.isFinite(value) && value > 0) || Math.ceil(config.holeDepth / stepdown) > 1000) throw new Error("Plongée ou profondeur par passe invalide, ou plus de 1000 passes de perçage.");
  const last = cuts.at(-1);
  const plan = { ...config, warnings: [], receiverY, hasReference, segments, cuts, advance, count, maxY, safeZ, plunge, stepdown, observedStepdown,
    feed: cuts.reduce((min, segment) => Math.min(min, segment.feed), Infinity), rpm: last.rpm,
    overlap: config.machineHeight - advance,
    tiles: Array.from({ length: count }, (_, index) => ({ low: index * advance, high: Math.min(maxY, index * advance + config.machineHeight) })) };
  if (count > 1 && hasReference) {
    const holeRows = Array.from({ length: count - 1 }, (_, index) => config.indexY + index * advance);
    if (config.stockWidth != null && (config.indexX < radius || config.indexX + radius > config.stockWidth)) throw new Error("Le trou entier doit rester dans la largeur de la plaque.");
    if (config.stockHeight != null && holeRows.some((y) => y < radius || y + radius > config.stockHeight)) throw new Error("Un trou de référence dépasse la hauteur de la plaque. Descendre le repère.");
    for (const y of holeRows) {
      if (cuts.some((segment) => sectionPointDistance({ x: config.indexX, y }, segment.start, segment.end) < config.toolDiameter + config.margin + 0.01)) plan.warnings.push(`Le repère croise ou approche un usinage. Veuillez le déplacer.`);
    }
  }
  return plan;
}

function sectionPointDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function suggestSectionReference(plan) {
  if (plan.count === 1) return null;
  const edge = plan.toolDiameter / 2 + plan.margin;
  const clearance = plan.toolDiameter + plan.margin + 0.01;
  const maxX = plan.stockWidth ?? plan.cuts.reduce((max, segment) => Math.max(max, segment.start.x, segment.end.x), 0);
  const y = plan.machineHeight - Math.max(plan.machineHeight * 0.05, edge);
  if (y + (plan.count - 2) * plan.advance + edge > (plan.stockHeight ?? plan.maxY)) return null;
  let best = null, bestDistance = clearance;
  // ponytail: bounded scan of continuous uncut columns within the inferred drawing width.
  // This avoids guessing whether an enclosed island is scrap; real stock and clamps still need confirmation.
  for (let i = 0; i <= 80; i++) {
    const x = Math.round((edge + (maxX - 2 * edge) * i / 80) * 10) / 10;
    if (x < edge || x > maxX - edge) continue;
    let distance = Math.min(x, maxX - x);
    for (const segment of plan.cuts) {
      const low = Math.min(segment.start.x, segment.end.x), high = Math.max(segment.start.x, segment.end.x);
      distance = Math.min(distance, x < low ? low - x : x > high ? x - high : 0);
      if (distance <= bestDistance) break;
    }
    if (distance > bestDistance) { bestDistance = distance; best = { x, y }; }
  }
  return best;
}

function generateGcodeSections(plan) {
  if (plan.warnings?.length) throw new Error(plan.warnings[0]);
  if (plan.count > 1 && !plan.hasReference) throw new Error("Renseigner les coordonnées du repère avant de générer les sections.");
  return plan.tiles.map((tile, index) => {
    const offset = tile.low;
    const lines = [`(Section ${index + 1} / ${plan.count} - G54 XY fixe - avancement cumule ${tilingNumber(offset)} mm)`, "G21", "G90", "G17", "G94", "G54", "G40", "G49", `G0 Z${tilingNumber(plan.safeZ)}`];
    if (index < plan.count - 1) {
      lines.push("(Trou de reference - diametre de la fraise - perce avant les decoupes)", `M3 S${tilingNumber(plan.rpm)}`, `G0 X${tilingNumber(plan.indexX)} Y${tilingNumber(plan.indexY)}`);
      const passes = Math.ceil(plan.holeDepth / plan.stepdown);
      for (let pass = 1; pass <= passes; pass++) {
        lines.push(`G1 Z${tilingNumber(-Math.min(plan.holeDepth, pass * plan.stepdown))} F${tilingNumber(plan.plunge)}`, `G0 Z${tilingNumber(plan.safeZ)}`);
      }
      lines.push("M5");
    }
    let cursor = null, spindle = null;
    for (const segment of plan.segments) {
      const clipped = clipTilingSegment(segment, tile.low, tile.high, index === plan.count - 1);
      if (!clipped) { cursor = null; continue; }
      const start = { ...clipped.start, y: clipped.start.y - offset };
      const end = { ...clipped.end, y: clipped.end.y - offset };
      const command = `M${segment.spindle} S${tilingNumber(segment.rpm)}`;
      if (command !== spindle) { lines.push(`G0 Z${tilingNumber(plan.safeZ)}`, "M5", command); spindle = command; cursor = null; }
      if (!cursor || segment.breakBefore || ["x", "y", "z"].some((axis) => Math.abs(cursor[axis] - start[axis]) > 1e-7)) {
        lines.push(`G0 Z${tilingNumber(plan.safeZ)}`, `G0 X${tilingNumber(start.x)} Y${tilingNumber(start.y)}`, `G1 Z${tilingNumber(start.z)} F${tilingNumber(plan.plunge)}`);
      }
      lines.push(`G1 ${tilingPoint(end)} F${tilingNumber(segment.feed)}`);
      cursor = end;
    }
    lines.push(`G0 Z${tilingNumber(plan.safeZ)}`, "M5", "G0 X0 Y0", "M30");
    return { name: `section_${index + 1}.nc`, gcode: lines.join("\n"), instruction: index === 0
      ? `Panneau contre le guide latéral et la butée frontale, puis bridé. G54 XY au coin d'appui, sans décalage temporaire, Z0 dessus panneau. ${plan.count > 1 ? "Le trou de référence est percé en premier, puis la section est usinée." : "Une seule section : aucun repère nécessaire."}`
      : `Après alignement manuel du dernier trou avec une pige à X=${tilingNumber(plan.indexX)}, Y=${tilingNumber(plan.receiverY)}, rebrider et dégager en Z avant de revenir à X0/Y0. Ne pas changer G54 XY. Les Y de ce fichier sont déjà adaptés à ${tilingNumber(offset)} mm d'avancement cumulé. ${index < plan.count - 1 ? "Un nouveau repère est percé en premier pour le prochain déplacement." : "Dernière section, sans nouveau repère."}` };
  });
}

function navigateSectionPreview(svg, initialView, onChange, savedView) {
  let view = { ...(savedView || initialView) }, drag = null;
  const update = () => {
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
    onChange({ ...view }, Math.round(initialView.width / view.width * 100));
  };
  const coordinates = (event) => {
    const matrix = svg.getScreenCTM(); if (!matrix) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const zoom = (factor, anchor) => {
    const current = initialView.width / view.width;
    const ratio = current / Math.max(0.5, Math.min(40, current * factor));
    const center = anchor || { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    view = { x: center.x + (view.x - center.x) * ratio, y: center.y + (view.y - center.y) * ratio, width: view.width * ratio, height: view.height * ratio };
    update();
  };
  svg.style.touchAction = "none";
  svg.style.cursor = "grab";
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const anchor = coordinates(event); if (!anchor) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1);
    zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01), anchor);
  }, { passive: false });
  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const point = coordinates(event); if (!point) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...view }, scale: Math.hypot(svg.getScreenCTM().a, svg.getScreenCTM().b) };
    svg.setPointerCapture(event.pointerId); svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    view.x = drag.view.x - (event.clientX - drag.x) / drag.scale;
    view.y = drag.view.y - (event.clientY - drag.y) / drag.scale;
    update();
  });
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null; svg.style.cursor = "grab";
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) svg.addEventListener(event, finish);
  update();
  return { zoom, fit() { view = { ...initialView }; update(); } };
}

// ZIP storage mode: no new dependency and no browser multiple-download permission prompt.
function sectionArchive(files) {
  const encoder = new TextEncoder(), chunks = [], directory = [];
  let offset = 0, directorySize = 0;
  const header = (size) => { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; };
  for (const file of files) {
    const name = encoder.encode(file.name), data = encoder.encode(file.gcode);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30), central = header(46);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true);
    local.view.setUint32(14, crc, true); local.view.setUint32(18, data.length, true); local.view.setUint32(22, data.length, true); local.view.setUint16(26, name.length, true);
    central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true); central.view.setUint16(6, 20, true);
    central.view.setUint32(16, crc, true); central.view.setUint32(20, data.length, true); central.view.setUint32(24, data.length, true); central.view.setUint16(28, name.length, true); central.view.setUint32(42, offset, true);
    chunks.push(local.bytes, name, data); directory.push(central.bytes, name);
    offset += 30 + name.length + data.length; directorySize += 46 + name.length;
  }
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true); end.view.setUint32(12, directorySize, true); end.view.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end.bytes], { type: "application/zip" });
}

function renderGcodeSections(plan, container, select) {
  container.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const padding = Math.max(20, plan.toolDiameter * 3);
  const xs = [...plan.cuts.flatMap((segment) => [segment.start.x, segment.end.x]), plan.indexX ?? 0];
  const minX = xs.reduce((min, value) => Math.min(min, value), 0) - padding, maxX = xs.reduce((max, value) => Math.max(max, value), plan.machineWidth ?? 0) + padding;
  const height = Math.max(plan.stockHeight ?? plan.maxY, plan.machineHeight) + padding;
  svg.setAttribute("viewBox", `${minX} 0 ${maxX - minX} ${height + padding}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMid meet");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Glisser le repère orange pour le déplacer, ou saisir X et Y dans les champs prévus.");
  const controls = document.createElement("div"); controls.className = "tiling-actions";
  const add = (parent, name, attrs) => {
    const element = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    parent.append(element); return element;
  };
  const colors = ["#0057a3", "#a13276", "#00804b", "#ba5200"];
  if (plan.stockWidth != null && plan.stockHeight != null) add(svg, "rect", { x: 0, y: height - plan.stockHeight, width: plan.stockWidth, height: plan.stockHeight, fill: "#f5ead5", stroke: "#76654a", "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-stock": "" });
  const handles = [];
  const targets = [];
  for (const [index, tile] of plan.tiles.entries()) {
    const color = colors[index % colors.length];
    const group = add(svg, "g", { "data-section": index + 1 });
    const y = (value) => height - value;
    add(group, "rect", { x: 0, y: y(tile.high), width: plan.machineWidth ?? maxX - padding, height: tile.high - tile.low, fill: color, "fill-opacity": 0.07, stroke: color, "stroke-dasharray": "6 4", "vector-effect": "non-scaling-stroke" });
    const parts = [];
    for (const segment of plan.cuts) {
      const clipped = clipTilingSegment(segment, tile.low, tile.high, index === plan.count - 1);
      if (clipped) parts.push(`M${clipped.start.x},${y(clipped.start.y)}L${clipped.end.x},${y(clipped.end.y)}`);
    }
    add(group, "path", { d: parts.join(" "), fill: "none", stroke: color, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" });
    let marker = null;
    if (plan.hasReference && index < plan.count - 1) {
      marker = add(group, "g", {});
      const halo = add(marker, "circle", { cx: plan.indexX, cy: y(plan.indexY + tile.low), r: plan.toolDiameter / 2, fill: "#ef8d23", "fill-opacity": 0.22, "pointer-events": "none" });
      add(marker, "circle", { cx: plan.indexX, cy: y(plan.indexY + tile.low), r: plan.toolDiameter / 2, fill: "#ef8d23", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke" });
      const target = add(marker, "circle", { cx: plan.indexX, cy: y(plan.indexY + tile.low), r: plan.toolDiameter / 2, fill: "transparent", "pointer-events": "all" });
      targets.push({ halo, target });
      add(marker, "title", {}).textContent = "Saisir le halo et glisser pour déplacer tous les repères";
      handles.push(marker);
      marker.referenceIndex = index;
    }
    const label = document.createElement("label"), checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      group.style.display = checkbox.checked ? "" : "none";
      if (marker) marker.style.display = checkbox.checked ? "" : "none";
    });
    label.className = "tiling-confirm"; label.style.color = color;
    label.append(checkbox, document.createTextNode(`Section ${index + 1} · Y ${tilingNumber(tile.low)}–${tilingNumber(tile.high)}`));
    controls.append(label);
  }
  const receiver = plan.hasReference && plan.count > 1 ? add(svg, "circle", { cx: plan.indexX, cy: height - plan.receiverY, r: plan.toolDiameter / 2, fill: "none", stroke: "#e77800", "stroke-dasharray": "3 3", "vector-effect": "non-scaling-stroke" }) : null;
  // Keep handles above every section: overlapping tile rectangles must not intercept dragging.
  const handleLayer = add(svg, "g", { "data-reference-handles": "" });
  for (const marker of handles) handleLayer.append(marker);
  let activeHandle = null;
  for (const handle of select ? handles : []) {
    handle.style.cursor = "grab";
    handle.style.touchAction = "none";
    let drag = null;
    const coordinates = (event) => {
      const matrix = svg.getScreenCTM(); if (!matrix) return null;
      const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
      return point.matrixTransform(matrix.inverse());
    };
    handle.addEventListener("pointerdown", (event) => {
      if (activeHandle || event.button !== 0) return;
      const start = coordinates(event); if (!start) return;
      event.preventDefault();
      event.stopPropagation?.();
      handle.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, start };
      activeHandle = handle;
      handle.style.cursor = "grabbing";
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const point = coordinates(event); if (!point) return;
      const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
      for (const marker of handles) marker.setAttribute("transform", `translate(${dx} ${dy})`);
      if (receiver) receiver.setAttribute("transform", `translate(${dx} 0)`);
    });
    const finish = (event, cancelled = false) => {
      if (!drag || event.pointerId !== drag.id) return;
      const start = drag.start, point = cancelled ? null : coordinates(event);
      drag = null;
      activeHandle = null;
      for (const marker of handles) marker.setAttribute("transform", "translate(0 0)");
      if (receiver) receiver.setAttribute("transform", "translate(0 0)");
      handle.style.cursor = "grab";
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (point && Math.hypot(point.x - start.x, point.y - start.y) > 0.01) {
        const targetY = plan.indexY + handle.referenceIndex * plan.advance - point.y + start.y;
        // A later hole moves with both the base reference and the recalculated advance.
        // Invert that mapping so the grabbed hole stays under the pointer after dropping.
        let low = 0, high = plan.machineHeight;
        for (let iteration = 0; iteration < 50; iteration++) {
          const y = (low + high) / 2;
          const receiver = Math.max(plan.toolDiameter / 2 + plan.margin, Math.min(plan.machineHeight - y, y - plan.toolDiameter - plan.margin));
          if (y + handle.referenceIndex * (y - receiver) < targetY) low = y;
          else high = y;
        }
        select({ x: Math.min(plan.machineWidth ?? Infinity, Math.max(0, Math.round((plan.indexX + point.x - start.x) * 10) / 10)), y: Math.min(plan.machineHeight, Math.round((low + high) / 2 * 10) / 10) });
      }
    };
    handle.addEventListener("pointerup", (event) => finish(event));
    handle.addEventListener("pointercancel", (event) => finish(event, true));
    handle.addEventListener("lostpointercapture", (event) => finish(event, true));
  }
  container.append(controls, svg);
  // Use real circle radii for hit testing, not a non-scaling stroke whose screen-space
  // hit area can drift from the circle after SVG scaling/reparenting in browsers.
  const sizeHandles = () => {
    const matrix = svg.getScreenCTM(); if (!matrix) return;
    const scale = Math.hypot(matrix.a, matrix.b);
    if (!(scale > 0)) return;
    for (const { halo, target } of targets) {
      halo.setAttribute("r", Math.max(plan.toolDiameter / 2, 14 / scale));
      target.setAttribute("r", Math.max(plan.toolDiameter / 2, 24 / scale));
    }
  };
  container.navigation = navigateSectionPreview(svg, { x: minX, y: 0, width: maxX - minX, height: height + padding }, (view, percent) => {
    container.sectionView = view;
    const level = document.getElementById?.("tiling-zoom-level");
    if (level) level.textContent = `${percent}%`;
    sizeHandles();
  }, container.sectionView);
  sizeHandles();
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      if (!svg.isConnected) { observer.disconnect(); return; }
      sizeHandles();
    });
    observer.observe(svg);
  }
}

function sectionChecklist(plan, index) {
  const steps = index === 0 ? [
    "Plaquer le panneau contre le guide latéral permanent et la butée frontale, puis le brider.",
    "Vérifier G54 XY au coin d'appui, sans G92 ; faire Z0 sur le dessus du panneau.",
  ] : [
    "Broche arrêtée, outil complètement dégagé : retirer la butée frontale si ce n'est pas déjà fait. Ne plus la remettre pendant les déplacements.",
    `Déplacer la pige lisse, broche arrêtée, à X=${tilingNumber(plan.indexX)}, Y=${tilingNumber(plan.receiverY)}, au-dessus du panneau.`,
    `Desserrer les brides puis glisser le panneau d'environ ${tilingNumber(plan.advance)} mm vers −Y, toujours plaqué au guide latéral.`,
    "Aligner le dernier trou de référence avec la pige de même diamètre, puis engager doucement la pige sans rotation, sans forcer ni fléchir l'outil.",
    "Rebrider le panneau sans le déplacer. Dégager la pige verticalement avant tout déplacement XY. Remonter la fraise si une pige distincte a été utilisée et refaire seulement le Z si nécessaire.",
    `Avec Z au-dessus de tous les obstacles (au moins ${tilingNumber(plan.safeZ)} mm si suffisant), revenir à X0/Y0. Ne pas remettre XY à zéro et ne pas ramener Z à 0.`,
  ];
  steps.push(`Simuler et exécuter section_${index + 1}.nc. ${index < plan.count - 1 ? `Le trou Ø${tilingNumber(plan.toolDiameter)} à X=${tilingNumber(plan.indexX)}, Y=${tilingNumber(plan.indexY)} est percé en premier pour le prochain déplacement.` : "Pas de nouveau trou dans cette dernière section."}`);
  steps.push("Attendre la fin du programme, la remontée de l'outil et l'arrêt complet de la broche avant de toucher au panneau.");
  return steps;
}

if (typeof document !== "undefined" && document.getElementById("tiling-form")) {
  const form = document.getElementById("tiling-form"), source = document.getElementById("tiling-source");
  const errorMessage = document.getElementById("tiling-error"), preview = document.getElementById("tiling-selection");
  const showError = (message = "") => { errorMessage.textContent = message; errorMessage.hidden = !message; };
  const exportButton = document.getElementById("tiling-export"), canvas = document.getElementById("tiling-preview");
  const refX = document.getElementById("tiling-reference-x"), refY = document.getElementById("tiling-reference-y");
  const next = document.getElementById("tiling-next"), liveInfo = document.getElementById("tiling-live-info");
  let plan = null, displayedPlan = null, version = 0, step = 1, requirements = null;
  function showStep(value) {
    step = value;
    document.getElementById("tiling-upload-step").hidden = value !== 1;
    document.getElementById("tiling-settings-step").hidden = value !== 2;
    preview.hidden = value !== 3;
    document.getElementById(value === 2 ? "tiling-settings-title" : value === 3 ? "tiling-back" : "tiling-file").focus();
  }
  const clear = () => { plan = null; displayedPlan = null; exportButton.disabled = true; };
  document.getElementById("tiling-zoom-out").addEventListener("click", () => canvas.navigation?.zoom(1 / 1.25));
  document.getElementById("tiling-zoom-in").addEventListener("click", () => canvas.navigation?.zoom(1.25));
  document.getElementById("tiling-zoom-fit").addEventListener("click", () => canvas.navigation?.fit());
  function updateMinimums() {
    if (!requirements) return;
    const field = (name) => form.elements.namedItem(name);
    const machineMin = Math.ceil(Math.max(requirements.width, Number(field("stockWidth").value) || 0) * 10) / 10;
    const stockMinX = Math.max(1, Math.ceil(requirements.width * 10) / 10);
    const stockMinY = Math.max(1, Math.ceil(requirements.height * 10) / 10);
    const diameter = Number(field("toolDiameter").value) || 0;
    const minY = Math.ceil((2 * diameter + 15) * 10) / 10;
    field("machineWidth").min = String(Math.max(1, machineMin));
    field("machineHeight").min = String(minY);
    field("stockWidth").min = String(stockMinX); field("stockHeight").min = String(stockMinY);
    for (const [name, text] of Object.entries({ machineWidth: `Minimum ${tilingNumber(machineMin)} mm (plaque comprise)`, machineHeight: `Minimum théorique pour le repère : ${tilingNumber(minY)} mm ; sans tiling : ${tilingNumber(requirements.height)} mm`, stockWidth: `Minimum selon le G-code : ${tilingNumber(stockMinX)} mm`, stockHeight: `Minimum selon le G-code : ${tilingNumber(stockMinY)} mm` })) {
      const input = field(name);
      let help = input.parentElement.querySelector("small");
      if (!help) { help = document.createElement("small"); input.parentElement.append(help); }
      help.textContent = text;
    }
  }
  form.addEventListener("input", () => {
    ++version; canvas.sectionView = null; refX.value = ""; refY.value = ""; clear(); updateMinimums(); calculateSections();
  });
  async function loadFile(file) {
    const current = ++version; clear(); source.value = ""; requirements = null; next.disabled = true;
    canvas.sectionView = null;
    refX.value = ""; refY.value = "";
    if (!file) return;
    showError();
    try {
      if (!/\.(nc|gcode)$/i.test(file.name)) throw new Error("Importer un fichier .nc ou .gcode exporté depuis Carbide Create.");
      const text = await file.text(); if (current !== version) return;
      const parsed = sectionSourceRequirements(text);
      source.value = text; requirements = parsed;
      document.getElementById("tiling-file-summary").textContent = `${file.name} · parcours X0–${tilingNumber(parsed.width)} / Y0–${tilingNumber(parsed.height)} mm`;
      // These are drawing minima, not inferred stock dimensions: the user confirms the actual blank.
      form.elements.namedItem("stockWidth").value = Math.max(1, Math.ceil(parsed.width));
      form.elements.namedItem("stockHeight").value = Math.max(1, Math.ceil(parsed.height));
      updateMinimums(); showStep(2); calculateSections();
    } catch (error) { if (current === version) showError(error.message); }
  }
  document.getElementById("tiling-file").addEventListener("change", (event) => loadFile(event.target.files[0]));
  const dropZone = document.getElementById("tiling-drop-zone");
  dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (event) => { event.preventDefault(); dropZone.classList.remove("drag-over"); loadFile(event.dataTransfer.files[0]); });
  document.getElementById("tiling-change-file").addEventListener("click", () => { ++version; showStep(1); showError(); document.getElementById("tiling-file").value = ""; });
  document.getElementById("tiling-back").addEventListener("click", () => { showStep(2); updateMinimums(); });
  next.addEventListener("click", () => {
    if (!form.reportValidity() || !plan) return;
    showStep(3); renderGcodeSections(plan, document.getElementById("tiling-preview"), selectReference);
  });
  function calculateSections(point) {
    ++version; const previous = displayedPlan;
    plan = null; exportButton.disabled = true;
    try {
      const c = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim() ? Number(value) : null]));
      if (requirements && !form.checkValidity()) throw new Error("Compléter les six informations et respecter les minima indiqués sous les champs.");
      if (point) { c.indexX = point.x; c.indexY = point.y; }
      plan = planGcodeSections(source.value, c);
      if (!plan.hasReference && plan.count > 1) {
        const suggestion = suggestSectionReference(plan);
        if (suggestion) {
          plan = planGcodeSections(source.value, { ...c, indexX: suggestion.x, indexY: suggestion.y });
        }
      }
      if (plan.hasReference) { refX.value = plan.indexX; refY.value = plan.indexY; }
      if (step === 3) renderGcodeSections(plan, document.getElementById("tiling-preview"), selectReference);
      displayedPlan = plan;
      exportButton.disabled = (plan.count > 1 && !plan.hasReference) || plan.warnings.length > 0;
      next.disabled = false;
      liveInfo.textContent = `${plan.count} section(s) prévues · avancement ${tilingNumber(plan.advance)} mm · recouvrement ${tilingNumber(plan.overlap)} mm. Les dimensions et le nombre de sections sont actualisés en direct.`;
      preview.hidden = step !== 3;
      showError(plan.warnings[0] || (!plan.hasReference && plan.count > 1 ? "Aucune bande libre commune trouvée automatiquement. Renseignez les coordonnées du repère ou réservez une bande de matière dans le dessin." : ""));
    } catch (error) {
      plan = null;
      next.disabled = true;
      liveInfo.textContent = error.message;
      showError(`Plan refusé : ${error.message}`);
      if (previous && step === 3) {
        renderGcodeSections(previous, document.getElementById("tiling-preview"), selectReference);
        displayedPlan = previous;
        preview.hidden = false;
        refX.value = previous.hasReference ? previous.indexX : "";
        refY.value = previous.hasReference ? previous.indexY : "";
      }
    }
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); calculateSections(); if (step === 2 && plan) next.click(); });
  function selectReference(point) {
    calculateSections(point);
  }
  for (const field of [refX, refY]) field.addEventListener("input", () => {
    calculateSections();
  });
  exportButton.addEventListener("click", () => {
    try {
      if (!plan) throw new Error("Calculer les sections d'abord.");
      const files = generateGcodeSections(plan);
      const archive = sectionArchive(files);
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a"); link.href = url; link.download = "sections-gcode.zip"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      showError();
    } catch (error) { showError(error.message); }
  });
}

if (typeof module !== "undefined") module.exports = { sectionSourceRequirements, planGcodeSections, suggestSectionReference, generateGcodeSections, renderGcodeSections, navigateSectionPreview, sectionArchive, sectionChecklist };
