function parseSimulationGcode(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const segments = [];
  let position = { x: 0, y: 0, z: 0 }, units = 1, absolute = true, motion = null, feed = null, ended = false;
  for (const [lineIndex, original] of lines.entries()) {
    const fail = (message) => { throw new Error(`Line ${lineIndex + 1}: ${message}`); };
    const line = original.replace(/\([^()]*\)/g, '').replace(/;.*/, '').trim().toUpperCase();
    if (!line || line === '%') continue;
    if (ended) fail('Motion after program end.');
    const words = [...line.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)];
    if (!words.length || line.replace(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g, '').trim()) fail('Unsupported command or syntax.');
    const values = {}, groups = new Set();
    const group = (name) => { if (groups.has(name)) fail('Conflicting modal commands.'); groups.add(name); };
    for (const [, letter, text] of words) {
      const value = Number(text);
      if (!Number.isFinite(value)) fail('Invalid numeric value.');
      if (letter === 'N') continue;
      if (letter === 'G') {
        if ([0, 1, 2, 3].includes(value)) { group('motion'); motion = value; }
        else if ([20, 21].includes(value)) { group('units'); units = value === 20 ? 25.4 : 1; }
        else if ([90, 91].includes(value)) { group('distance'); absolute = value === 90; }
        else if (value === 80) { group('motion'); motion = null; }
        else if (![17, 40, 49, 54, 94, 91.1].includes(value)) fail(`Unsupported command: G${value}.`);
      } else if (letter === 'M') {
        if ([2, 30].includes(value)) ended = true;
        else if (![3, 4, 5, 7, 8, 9].includes(value)) fail(`Unsupported command: M${value}.`);
      } else if (['X', 'Y', 'Z', 'F', 'S', 'I', 'J', 'R'].includes(letter)) {
        if (letter in values) fail('Conflicting modal commands.');
        values[letter] = value;
      } else fail(`Unsupported command: ${letter}.`);
    }
    if ('F' in values) {
      feed = values.F * units;
      if (!(feed > 0) || !Number.isFinite(feed)) fail('A positive F feed rate is required before feed motion.');
    }
    if (!['X', 'Y', 'Z', 'I', 'J', 'R'].some((axis) => axis in values)) continue;
    if (ended) fail('Motion after program end.');
    if (motion === null) fail('Unsupported command or syntax.');
    if (motion !== 0 && !feed) fail('A positive F feed rate is required before feed motion.');
    const end = Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis,
      axis.toUpperCase() in values ? values[axis.toUpperCase()] * units + (absolute ? 0 : position[axis]) : position[axis]]));
    if (!Object.values(end).every(Number.isFinite)) fail('Invalid numeric value.');
    const add = (start, target) => {
      if (segments.length >= 200000) fail('Too many motions to simulate (200,000 maximum).');
      segments.push({ start, end: target, feed: motion === 0 ? 3000 : feed, motionType: motion === 0 ? 'rapid' : start.x === target.x && start.y === target.y ? 'plunge' : 'cut', lineIndex });
    };
    if (motion === 2 || motion === 3) {
      if ('R' in values || !('I' in values || 'J' in values) || end.x === position.x && end.y === position.y && end.z !== position.z) fail('XY arc: relative I/J centers required; R radius and full helical circles are not supported.');
      const center = { x: position.x + (values.I || 0) * units, y: position.y + (values.J || 0) * units };
      const radius = Math.hypot(position.x - center.x, position.y - center.y);
      if (!Number.isFinite(radius) || radius <= 0 || Math.abs(Math.hypot(end.x - center.x, end.y - center.y) - radius) > 0.02) fail('Inconsistent arc radii.');
      const angle = Math.atan2(position.y - center.y, position.x - center.x);
      let sweep = Math.atan2(end.y - center.y, end.x - center.x) - angle;
      if (motion === 2 && sweep >= -1e-10) sweep -= Math.PI * 2;
      if (motion === 3 && sweep <= 1e-10) sweep += Math.PI * 2;
      // Match the tiling parser's 0.01 mm chord-error ceiling; reject oversized arcs before allocating.
      const count = Math.ceil(Math.abs(sweep) / Math.min(Math.PI / 12, 2 * Math.acos(Math.max(-1, 1 - 0.01 / radius))));
      if (!Number.isFinite(count) || count > 200000 - segments.length) fail('Too many motions to simulate (200,000 maximum).');
      let previous = position;
      for (let step = 1; step <= count; step++) {
        const t = step / count;
        const point = step === count ? end : { x: center.x + radius * Math.cos(angle + sweep * t), y: center.y + radius * Math.sin(angle + sweep * t), z: position.z + (end.z - position.z) * t };
        add(previous, point); previous = point;
      }
    } else {
      if (['I', 'J', 'R'].some((key) => key in values)) fail('Arc parameters on linear motion.');
      if (Math.hypot(end.x - position.x, end.y - position.y, end.z - position.z) > 0) add(position, end);
    }
    position = end;
  }
  if (!segments.length) throw new Error('No motion to simulate.');
  return { lines, segments };
}

function setupGcodeSimulator() {
  const card = document.querySelector('#upload-view .upload-card');
  card.querySelector('.eyebrow').textContent = 'G-code';
  card.querySelector('h1').textContent = 'Preview your G-code';
  card.querySelector('.lede').textContent = 'Import a G-code file to follow tool motion, inspect coordinates and step through program lines.';
  card.querySelector('.upload-cta').textContent = 'Choose a G-code file';
  card.querySelector('.upload-hint').textContent = '.nc, .gcode or .tap · XY preview · I/J arcs';
  refs.fileInput.accept = '.nc,.gcode,.tap';
  refs.uploadView.setAttribute('aria-label', 'Import G-code');
  refs.status.parentElement.parentElement.prepend(refs.status);
  refs.status.style.gridColumn = '1 / -1';
  const bar = document.createElement('div'); bar.className = 'simulator-file-bar';
  const fileName = document.createElement('p'); fileName.setAttribute('data-no-translate', '');
  const change = document.createElement('button'); change.type = 'button'; change.className = 'secondary-btn'; change.textContent = 'Change file';
  change.addEventListener('click', () => refs.fileInput.click());
  bar.append(fileName, change); refs.resultView.prepend(bar);
  let version = 0;
  async function load(file) {
    if (!file) return;
    const current = ++version;
    stopPlayback();
    try {
      if (!/\.(nc|gcode|tap)$/i.test(file.name)) throw new Error('Import a .nc, .gcode or .tap file.');
      if (file.size > 10 * 1024 * 1024) throw new Error('File too large (10 MB maximum).');
      setStatus(`Reading ${file.name}...`);
      const text = await file.text();
      if (current !== version) return;
      const imported = parseSimulationGcode(text);
      const playbackSegments = [], paths = [];
      let cursor = { ...imported.segments[0].start, timeSec: 0 };
      for (const segment of imported.segments) {
        const color = segment.motionType === 'rapid' ? '#7e8ca0' : PREVIEW_COLORS[0];
        cursor = appendPlaybackMotion(playbackSegments, cursor, segment.end, segment.feed, segment.motionType, color, segment.lineIndex);
        const previous = paths.at(-1);
        if (previous?.color === color) previous.paths[0].points.push([segment.end.x, segment.end.y]);
        else paths.push({ color, paths: [{ points: [[segment.start.x, segment.start.y], [segment.end.x, segment.end.y]], closed: false }] });
      }
      if (!Number.isFinite(cursor.timeSec)) throw new Error('Invalid numeric value.');
      let offset = 0;
      const offsets = imported.lines.map((line) => { const start = offset; offset += line.length + 1; return start; });
      const points = imported.segments.flatMap((segment) => [[segment.start.x, segment.start.y], [segment.end.x, segment.end.y]]);
      const bounds = computeBounds(points);
      const parsed = { elements: [], toolpaths: [], document: { width: bounds.width, height: bounds.height, zeroX: -bounds.minX, zeroY: -bounds.minY } };
      state.generated = { gcode: imported.lines.join('\n'), gcodeLines: imported.lines, gcodeLineOffsets: offsets, playbackSegments, previewPaths: paths, totalDurationSec: cursor.timeSec };
      state.fileName = file.name;
      refs.output.value = state.generated.gcode;
      refs.output.setAttribute('aria-label', 'Imported source G-code');
      refs.uploadView.classList.add('hidden'); refs.resultView.classList.remove('hidden');
      resetPlayback(cursor.timeSec);
      renderPreview(parsed, state.generated);
      fileName.textContent = file.name;
      setStatus('');
    } catch (error) { if (current === version) setStatus(error.message, true); }
    finally { if (current === version) refs.fileInput.value = ''; }
  }
  refs.fileInput.addEventListener('change', (event) => load(event.target.files?.[0]));
  card.addEventListener('dragover', (event) => { event.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', (event) => { event.preventDefault(); card.classList.remove('drag-over'); load(event.dataTransfer.files?.[0]); });
  window.addEventListener('pagehide', stopPlayback);
}

if (typeof window !== 'undefined' && typeof location !== 'undefined') {
  window.isGcodeSimulator = new URLSearchParams(location.search).has('simulator');
  if (window.isGcodeSimulator) document.body.classList.add('gcode-simulator');
}
if (typeof module !== 'undefined') module.exports = { parseSimulationGcode };
