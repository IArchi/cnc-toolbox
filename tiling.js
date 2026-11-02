// ponytail: linear, absolute GRBL only; reject other dialects rather than guess their modal state.
function parseTilingGcode(source, safeZ, options = {}) {
  let position = { x: 0, y: 0, z: safeZ };
  let metric = false, absolute = false, motion = null, feed = null, spindle = null;
  let ended = false, parseSpeed = null, breakBefore = true, tool = null;
  const segments = [];
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const fail = (message) => { throw new Error(`Ligne ${index + 1} : ${message}`); };
    const line = original.replace(/\([^()]*\)/g, "").replace(/;.*/, "").trim().toUpperCase();
    if (!line || line === "%") continue;
    if (ended) fail("commande après la fin du programme.");
    const words = [...line.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)];
    if (!words.length || line.replace(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g, "").trim()) fail("syntaxe non prise en charge.");
    const values = {};
    let nextMotion = null, nextSpindle = spindle;
    const groups = new Set();
    const group = (name) => { if (groups.has(name)) fail(`commandes ${name} contradictoires.`); groups.add(name); };
    for (const [, letter, text] of words) {
      const value = Number(text);
      if (!Number.isFinite(value)) fail("nombre invalide.");
      if (letter === "N") continue;
      if (letter === "G") {
        if ([0, 1, ...(options.arcs ? [2, 3] : [])].includes(value)) { group("mouvement"); nextMotion = value; }
        else if (value === 21) { group("unités"); metric = true; }
        else if (value === 90) { group("coordonnées"); absolute = true; }
        else if (!(options.arcs && value === 91.1) && ![17, 94, 54, 40, 49, 80].includes(value)) fail(`G${value} non pris en charge (mm, absolu, plan XY uniquement).`);
      } else if (letter === "M") {
        if ([3, 4, 5].includes(value)) { group("broche"); nextSpindle = value; }
        else if (options.initialTool && value === 6 && !segments.length) { /* Initial manual tool setup only. */ }
        else if ([2, 30].includes(value)) { group("fin"); ended = true; }
        else fail(`M${value} non pris en charge.`);
      } else if (options.initialTool && letter === "T") {
        if (segments.length) fail("sélection d'outil après le début des usinages : fournir un fichier par fraise.");
        if (tool !== null && tool !== value) fail("changement d'outil : fournir un fichier par fraise.");
        tool = value;
      } else if (["X", "Y", "Z", "F", "S", ...(options.arcs ? ["I", "J", "R"] : [])].includes(letter)) {
        if (letter in values) fail(`${letter} répété.`);
        values[letter] = value;
      } else fail(`${letter} non pris en charge.`);
    }
    if ("F" in values) { if (values.F <= 0) fail("avance non positive."); feed = values.F; }
    if ("S" in values) { if (values.S <= 0) fail("vitesse de broche non positive."); }
    // Keep the last commanded speed even when a later M3 omits S.
    if ("S" in values) parseSpeed = values.S;
    spindle = nextSpindle;
    if (nextMotion !== null) motion = nextMotion;
    if (!["X", "Y", "Z", "I", "J", "R"].some((axis) => axis in values)) continue;
    if (ended) fail("mouvement combiné à une fin de programme.");
    if (!metric || !absolute || motion === null) fail("G21, G90 et G0/G1 requis avant les déplacements.");
    const end = { x: values.X ?? position.x, y: values.Y ?? position.y, z: values.Z ?? position.z };
    if (end.z > safeZ + 1e-6) fail("Z source supérieur au Z de sécurité configuré.");
    if (motion === 0) {
      if ("I" in values || "J" in values || "R" in values) fail("paramètres d'arc sur mouvement rapide.");
      const retract = end.x === position.x && end.y === position.y && end.z >= position.z;
      if (Math.min(position.z, end.z) < 0 && !retract) fail("rapide sous la surface du panneau.");
      breakBefore = true;
    }
    if (motion === 1 || motion === 2 || motion === 3) {
      if (!feed || ![3, 4].includes(spindle) || !parseSpeed) fail("avance et broche M3/M4 S… requises pour l'usinage.");
      if (motion === 2 || motion === 3) {
        if ("R" in values || !("I" in values || "J" in values)) fail("arc : centres I/J relatifs requis, rayon R non pris en charge.");
        const center = { x: position.x + (values.I || 0), y: position.y + (values.J || 0) };
        const radius = Math.hypot(position.x - center.x, position.y - center.y);
        if (radius <= 0 || Math.abs(Math.hypot(end.x - center.x, end.y - center.y) - radius) > 0.02) fail("rayons d'arc incohérents.");
        const angle = Math.atan2(position.y - center.y, position.x - center.x);
        let sweep = Math.atan2(end.y - center.y, end.x - center.x) - angle;
        if (motion === 2 && sweep >= -1e-10) sweep -= Math.PI * 2;
        if (motion === 3 && sweep <= 1e-10) sweep += Math.PI * 2;
        // ponytail: flatten arcs to <= 0.01 mm chord error before Y clipping; never flatten other planes.
        const steps = Math.max(1, Math.ceil(Math.abs(sweep) / Math.min(Math.PI / 12, 2 * Math.acos(Math.max(-1, 1 - 0.01 / radius)))));
        if (!Number.isFinite(steps) || steps > 100000) fail("arc trop volumineux.");
        let previous = { ...position };
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          const point = step === steps ? end : { x: center.x + radius * Math.cos(angle + t * sweep), y: center.y + radius * Math.sin(angle + t * sweep), z: position.z + t * (end.z - position.z) };
          segments.push({ start: previous, end: point, feed, spindle, rpm: parseSpeed, breakBefore: step === 1 && breakBefore });
          previous = point;
        }
        breakBefore = false;
      } else if (Math.hypot(end.x - position.x, end.y - position.y, end.z - position.z) > 1e-9) {
        if ("I" in values || "J" in values || "R" in values) fail("paramètres d'arc sur mouvement linéaire.");
        segments.push({ start: { ...position }, end, feed, spindle, rpm: parseSpeed, breakBefore });
        breakBefore = false;
      }
    }
    position = end;
  }
  if (!segments.some((segment) => Math.min(segment.start.z, segment.end.z) < 0)) throw new Error("Aucun usinage sous Z=0 dans le G-code.");
  return segments;
}

function validateTilingConfig(c) {
  for (const key of ["machineWidth", "machineHeight", "stockWidth", "stockLength", "stockThickness", "holeDiameter", "holeDepth", "toolDiameter", "stepdown", "feed", "plunge", "rpm", "safeZ"]) {
    if (!Number.isFinite(c[key]) || c[key] <= 0) throw new Error(`Valeur positive requise : ${key}.`);
  }
  for (const key of ["stockX", "receiverY", "indexY"]) {
    if (!Number.isFinite(c[key]) || c[key] < 0) throw new Error(`Coordonnée invalide : ${key}.`);
  }
  if (c.toolDiameter >= c.holeDiameter) throw new Error("La fraise doit être plus petite que les trous.");
  if (c.indexY <= c.receiverY) throw new Error("Le Y des nouveaux trous doit dépasser le Y de réception.");
  if (c.stockX + c.stockWidth > c.machineWidth) throw new Error("Le panneau dépasse la course X (tilling suivant Y uniquement).");
  if (c.holeDepth < c.stockThickness) throw new Error("Les trous d'indexation doivent traverser le panneau pour recevoir les tourillons du martyr.");
  if (!Array.isArray(c.guidePoints) || !c.guidePoints.length || c.guidePoints.some((p) => p.length !== 2 || !p.every(Number.isFinite))) throw new Error("Coordonnées des trous latéraux invalides.");
  if (!Array.isArray(c.indexXs) || c.indexXs.length !== 2 || !c.indexXs.every(Number.isFinite)) throw new Error("Indiquer exactement deux abscisses d'indexation.");
  const radius = c.holeDiameter / 2;
  const holes = [...c.guidePoints, ...c.indexXs.flatMap((x) => [[x, c.receiverY], [x, c.indexY]])];
  for (const [x, y] of holes) {
    if (x - radius < 0 || x + radius > c.machineWidth || y - radius < 0 || y + radius > c.machineHeight) throw new Error("Un trou dépasse les courses de la machine.");
  }
  for (const [x] of c.guidePoints) {
    if (x + radius > c.stockX + 1e-6) throw new Error("Le guidage latéral doit rester à gauche du panneau.");
  }
  for (const x of c.indexXs) {
    if (x - radius < c.stockX || x + radius > c.stockX + c.stockWidth) throw new Error("Les trous d'indexation doivent être à l'intérieur du panneau.");
  }
  for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
    if (Math.hypot(holes[i][0] - holes[j][0], holes[i][1] - holes[j][1]) < c.holeDiameter) throw new Error("Deux trous se chevauchent.");
  }
  if (Math.ceil(c.stockLength / (c.indexY - c.receiverY)) > 1000 || Math.ceil(c.holeDepth / c.stepdown) > 1000 || c.holeDiameter / c.toolDiameter > 100) throw new Error("Paramètres trop fins : plus de 1000 sections/passes ou rapport trou/fraise > 100.");
}

function tilingNumber(value) { return Number(value.toFixed(4)).toString(); }
function tilingPoint(p) { return `X${tilingNumber(p.x)} Y${tilingNumber(p.y)} Z${tilingNumber(p.z)}`; }
function tilingHeader(label, c) {
  return [`(${label})`, "G21", "G90", "G17", "G94", "G54", "G40", `G0 Z${tilingNumber(c.safeZ)}`];
}
function tilingFooter(lines, c) { lines.push(`G0 Z${tilingNumber(c.safeZ)}`, "M5", "M30"); }

function appendTilingPockets(lines, points, c) {
  lines.push(`M3 S${tilingNumber(c.rpm)}`, "(Poches - fraise cylindrique a coupe au centre)");
  const outerRadius = (c.holeDiameter - c.toolDiameter) / 2;
  const rings = Math.ceil(outerRadius / (c.toolDiameter * 0.4));
  const passes = Math.ceil(c.holeDepth / c.stepdown);
  for (const [x, y] of points) {
    lines.push(`(Trou X${tilingNumber(x)} Y${tilingNumber(y)})`, `G0 Z${tilingNumber(c.safeZ)}`, `G0 X${tilingNumber(x)} Y${tilingNumber(y)}`, `G1 Z0 F${tilingNumber(c.plunge)}`);
    for (let pass = 1; pass <= passes; pass++) {
      lines.push(`G1 X${tilingNumber(x)} Y${tilingNumber(y)} F${tilingNumber(c.feed)}`, `G1 Z${tilingNumber(-Math.min(c.holeDepth, pass * c.stepdown))} F${tilingNumber(c.plunge)}`);
      for (let ring = 1; ring <= rings; ring++) {
        const radius = outerRadius * ring / rings;
        lines.push(`G1 X${tilingNumber(x + radius)} Y${tilingNumber(y)} F${tilingNumber(c.feed)}`);
        for (let point = 1; point <= 128; point++) {
          const angle = point * 2 * Math.PI / 128;
          lines.push(`G1 X${tilingNumber(x + radius * Math.cos(angle))} Y${tilingNumber(y + radius * Math.sin(angle))}`);
        }
      }
    }
    lines.push(`G0 Z${tilingNumber(c.safeZ)}`);
  }
}

function clipTilingSegment(segment, low, high, last) {
  const dy = segment.end.y - segment.start.y;
  let from = 0, to = 1;
  if (Math.abs(dy) < 1e-10) {
    // A path exactly on a seam belongs to the following section, never both.
    if (segment.start.y < low || segment.start.y > high || (!last && segment.start.y === high)) return null;
  } else {
    const a = (low - segment.start.y) / dy, b = (high - segment.start.y) / dy;
    from = Math.max(0, Math.min(a, b));
    to = Math.min(1, Math.max(a, b));
    if (to - from < 1e-10) return null;
  }
  const point = (t) => Object.fromEntries(["x", "y", "z"].map((axis) => [axis, segment.start[axis] + t * (segment.end[axis] - segment.start[axis])]));
  return { ...segment, start: point(from), end: point(to) };
}

function generateTiling(source, c) {
  validateTilingConfig(c);
  const segments = parseTilingGcode(source, c.safeZ);
  const advance = c.indexY - c.receiverY;
  const count = Math.ceil(c.stockLength / advance);
  const cutterRadius = c.toolDiameter / 2;
  for (const segment of segments) for (const p of [segment.start, segment.end]) {
    if (p.x < 0 || p.x > c.stockWidth || p.y < 0 || p.y > c.stockLength) throw new Error("Le G-code dépasse les dimensions du panneau (origine attendue en bas à gauche).");
    if (p.x + c.stockX - cutterRadius < 0 || p.x + c.stockX + cutterRadius > c.machineWidth) throw new Error("La fraise dépasse la course X.");
    if (p.z < -c.stockThickness - 1) throw new Error("Le G-code descend de plus de 1 mm sous le panneau.");
  }
  const initLines = tilingHeader("Initialisation du martyr - Z0 sur le martyr nu", c);
  appendTilingPockets(initLines, [...c.guidePoints, ...c.indexXs.map((x) => [x, c.receiverY])], c);
  tilingFooter(initLines, c);
  const files = [{ name: "00-initialisation-martyr.nc", gcode: initLines.join("\n"), instruction: "Retirer le panneau. Faire le zéro Z sur le martyr et usiner le guidage gauche et les deux logements de réception. Poser les butées latérales, sans tourillons de réception pour la première section." }];
  for (let tile = 0; tile < count; tile++) {
    const low = tile * advance, high = Math.min(c.stockLength, low + advance);
    const lines = tilingHeader(`Section ${tile + 1} - panneau Y ${tilingNumber(low)} a ${tilingNumber(high)} - Z0 sur le panneau`, c);
    let cursor = null, spindle = null;
    for (const segment of segments) {
      const clipped = clipTilingSegment(segment, low, high, tile === count - 1);
      if (!clipped) { cursor = null; continue; }
      const translate = (p) => ({ x: p.x + c.stockX, y: p.y - low + c.receiverY, z: p.z });
      const start = translate(clipped.start), end = translate(clipped.end);
      if (Math.min(start.y, end.y) - cutterRadius < 0 || Math.max(start.y, end.y) + cutterRadius > c.machineHeight) throw new Error("La fraise dépasse la course Y : ajuster la réception et l'avancement.");
      if (Math.min(start.z, end.z) < 0) {
        const obstacles = [...c.guidePoints, ...(tile > 0 ? c.indexXs.map((x) => [x, c.receiverY]) : []), ...(tile < count - 1 ? c.indexXs.map((x) => [x, c.indexY]) : [])];
        for (const [x, y] of obstacles) {
          const dx = end.x - start.x, dy = end.y - start.y;
          const lengthSquared = dx * dx + dy * dy;
          const t = lengthSquared ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared)) : 0;
          if (Math.hypot(x - start.x - t * dx, y - start.y - t * dy) < c.holeDiameter / 2 + cutterRadius) throw new Error(`Section ${tile + 1} : un usinage croise un trou de guidage ou d'indexation. Déplacer les trous ou le parcours.`);
        }
      }
      const spindleCommand = `M${segment.spindle} S${tilingNumber(segment.rpm)}`;
      if (spindle !== spindleCommand) { lines.push(`G0 Z${tilingNumber(c.safeZ)}`, spindleCommand); spindle = spindleCommand; cursor = null; }
      if (!cursor || segment.breakBefore || ["x", "y", "z"].some((axis) => Math.abs(cursor[axis] - start[axis]) > 1e-7)) {
        lines.push(`G0 Z${tilingNumber(c.safeZ)}`, `G0 X${tilingNumber(start.x)} Y${tilingNumber(start.y)}`, `G1 Z${tilingNumber(start.z)} F${tilingNumber(c.plunge)}`);
      }
      lines.push(`G1 ${tilingPoint(end)} F${tilingNumber(segment.feed)}`);
      cursor = end;
    }
    if (tile < count - 1) {
      if (low + advance + c.holeDiameter / 2 > c.stockLength) throw new Error("Le panneau est trop court pour les derniers trous d'indexation complets.");
      lines.push(`G0 Z${tilingNumber(c.safeZ)}`, "M5");
      appendTilingPockets(lines, c.indexXs.map((x) => [x, c.indexY]), c);
    }
    tilingFooter(lines, c);
    files.push({ name: `${String(tile + 1).padStart(2, "0")}-section.nc`, gcode: lines.join("\n"), instruction: tile === 0
      ? `Positionner le coin inférieur gauche du panneau en X=${tilingNumber(c.stockX)}, Y=${tilingNumber(c.receiverY)} contre les butées. Brider, refaire Z0 sur le panneau sans changer X/Y. Usiner la section puis ses deux trous à Y=${tilingNumber(c.indexY)}.`
      : `Broche arrêtée et outil dégagé : retirer les tourillons, glisser le panneau vers −Y de ${tilingNumber(advance)} mm, le plaquer à gauche puis insérer les deux tourillons à Y=${tilingNumber(c.receiverY)} dans le panneau et le martyr. Rebrider, vérifier Z0 sans changer X/Y. ${tile < count - 1 ? "Cette section prépare les trous du prochain avancement." : "Dernière section, sans nouveaux trous."}` });
  }
  return { files, advance, count };
}

if (typeof module !== "undefined") module.exports = { generateTiling, parseTilingGcode, clipTilingSegment };
