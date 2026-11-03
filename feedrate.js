(() => {
  const root = document.getElementById('feedrate-page');
  if (!root) return;
  const STORAGE_KEY = 'feedrate-calculator';
  const MM_PER_INCH = 25.4;
  const MIN_FEED_RATE = 100;
  const materialsDatabase = {
    'Softwood / MDF': { base: 0.07, min: 0.055, max: 0.09 },
    'Hardwood / Plywood': { base: 0.055, min: 0.045, max: 0.07 },
    'PVC Foam': { base: 0.09, min: 0.07, max: 0.12 },
    'POM / PMMA / PC': { base: 0.04, min: 0.03, max: 0.05 },
    'Copper / Brass': { base: 0.02, min: 0.015, max: 0.025 },
  };
  const rpmPresets = { makita: [10000, 12000, 17000, 22000, 27000, 34000], dewalt: [16000, 18200, 20400, 22600, 24800, 27000] };
  const defaults = { flutes: 2, diameter: 6, thickness: 18, toolType: 'End Mill', material: 'Hardwood / Plywood', unitMode: 'mm', rpmMode: 'makita', rpmManual: 18000, rpmPreset: '3' };
  const ids = ['calculator-form', 'flutes', 'diameter', 'thickness', 'toolType', 'material', 'unitMode', 'rpmMode', 'rpmManual', 'rpmPreset', 'rpmPresetHelp', 'result-warning', 'feedRateResult', 'feedRateValue', 'feedRateHelp', 'depthPerPassValue', 'depthPerPassHelp', 'plungeRateValue', 'plungeRateHelp'];
  const elements = Object.fromEntries(ids.map((id) => [id, root.querySelector(`#${id}`)]));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const unit = () => elements.unitMode.value === 'inch' ? 'inch' : 'mm';
  const decimal = (value, digits) => value.toFixed(digits).replace(/\.?0+$/, '');
  const fromMm = (value) => unit() === 'inch' ? value / MM_PER_INCH : value;
  const formatFeed = (value) => unit() === 'inch' ? `${decimal(value / MM_PER_INCH, 2)} in/min` : `${Math.round(value).toLocaleString('en-US')} mm/min`;
  let dimensions = { diameter: 6, thickness: 18 };
  function readDimensions() {
    for (const key of ['diameter', 'thickness']) dimensions[key] = Number(elements[key].value) * (unit() === 'inch' ? MM_PER_INCH : 1);
  }
  function displayDimensions() {
    for (const key of ['diameter', 'thickness']) {
      elements[key].min = unit() === 'inch' ? '0.01' : '0.1';
      elements[key].step = unit() === 'inch' ? '0.01' : '0.1';
      elements[key].value = dimensions[key] > 0 ? decimal(fromMm(dimensions[key]), unit() === 'inch' ? 2 : 1) : '';
    }
    for (const label of root.querySelectorAll('[data-length-unit]')) label.textContent = unit() === 'inch' ? '(inches)' : '(mm)';
    for (const button of root.querySelectorAll('[data-unit-mode]')) {
      const active = button.dataset.unitMode === unit();
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  function syncRpm(preset) {
    const mode = elements.rpmMode.value;
    for (const button of root.querySelectorAll('[data-rpm-mode]')) {
      const active = button.dataset.rpmMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const panel of root.querySelectorAll('[data-rpm-panel]')) panel.hidden = panel.dataset.rpmPanel !== (mode === 'manual' ? 'manual' : 'preset');
    const options = rpmPresets[mode] || [];
    const recommended = mode === 'makita' ? 3 : 2;
    elements.rpmPreset.innerHTML = options.map((rpm, index) => `<option value="${index + 1}">Position ${index + 1} · ${rpm.toLocaleString('en-US')} RPM${index + 1 === recommended ? ' (default)' : ''}</option>`).join('');
    elements.rpmPreset.value = options[Number(preset) - 1] ? String(preset) : String(recommended);
  }
  function getChipLoad(material, diameter, type) {
    const data = materialsDatabase[material] || materialsDatabase['Hardwood / Plywood'];
    return clamp(data.base * Math.sqrt(diameter / 6) * (type === 'VBit' ? 0.6 : type === 'Drill' ? 0.5 : 1), data.min, data.max);
  }
  function calculate(values, rpm) {
    const step = Math.max(0.01, Math.min(values.thickness, values.diameter * (values.toolType === 'Drill' ? 1 : 0.5)));
    let feed = rpm * values.flutes * getChipLoad(values.material, values.diameter, values.toolType);
    const ratio = step / values.diameter;
    if (ratio > 0.75) feed *= 1 - Math.min(1, (ratio - 0.75) / 0.75) * 0.15;
    const rounded = Math.round(feed);
    feed = Math.max(rounded, MIN_FEED_RATE);
    const plunge = clamp(Math.round(feed * 0.2 * (step > values.diameter * 0.5 ? 0.7 : 1)), 50, feed);
    return { step, feed, plunge, limit: rounded < MIN_FEED_RATE ? 'min' : null };
  }
  function updateCalculator() {
    const values = { ...dimensions, flutes: Number(elements.flutes.value), toolType: elements.toolType.value, material: elements.material.value, unitMode: unit(), rpmMode: elements.rpmMode.value, rpmManual: Number(elements.rpmManual.value), rpmPreset: elements.rpmPreset.value };
    const rpm = values.rpmMode === 'manual' ? values.rpmManual : rpmPresets[values.rpmMode]?.[Number(values.rpmPreset) - 1];
    elements.rpmPresetHelp.textContent = rpm ? `Approximately ${rpm.toLocaleString('en-US')} RPM; check your specific model.` : 'Choose a speed dial position.';
    const valid = [values.diameter, values.thickness, values.flutes, rpm].every((value) => Number.isFinite(value) && value > 0) && Number.isInteger(values.flutes) && values.flutes <= 12 && materialsDatabase[values.material];
    elements['result-warning'].hidden = Boolean(valid);
    if (!valid) {
      for (const id of ['feedRateValue', 'depthPerPassValue', 'plungeRateValue']) elements[id].textContent = '—';
      elements.feedRateResult.classList.toggle('is-limited', false);
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* Calculation remains available without storage. */ }
    const result = calculate(values, rpm);
    elements.depthPerPassValue.textContent = `${decimal(fromMm(result.step), unit() === 'inch' ? 2 : 1)} ${unit() === 'inch' ? 'in' : 'mm'}`;
    elements.feedRateValue.textContent = formatFeed(result.feed);
    elements.plungeRateValue.textContent = formatFeed(result.plunge);
    elements.depthPerPassHelp.textContent = `${values.toolType === 'Drill' ? 100 : 50}% of the diameter, capped by material thickness.`;
    elements.feedRateHelp.textContent = 'RPM × flute count × chip load.' + (values.toolType === 'VBit' ? ' Reduced chip load for V-bits.' : values.toolType === 'Drill' ? ' Reduced chip load for drills.' : '');
    if (result.limit === 'min') elements.feedRateHelp.textContent += ` Raised to the calculator minimum: ${formatFeed(MIN_FEED_RATE)}. Check chip load with the manufacturer.`;
    elements.plungeRateHelp.textContent = '20% of the XY feed rate, reduced further for deep plunges.';
    elements.feedRateResult.classList.toggle('is-limited', Boolean(result.limit));
  }
  elements.material.innerHTML = Object.keys(materialsDatabase).map((material) => `<option value="${material}">${material}</option>`).join('');
  let saved = defaults;
  try { saved = { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { /* Use defaults for unavailable or corrupt storage. */ }
  for (const id of ['flutes', 'rpmManual']) elements[id].value = saved[id];
  elements.unitMode.value = saved.unitMode === 'inch' ? 'inch' : 'mm';
  elements.toolType.value = ['End Mill', 'VBit', 'Drill'].includes(saved.toolType) ? saved.toolType : defaults.toolType;
  elements.material.value = Object.hasOwn(materialsDatabase, saved.material) ? saved.material : defaults.material;
  elements.rpmMode.value = ['manual', 'makita', 'dewalt'].includes(saved.rpmMode) ? saved.rpmMode : defaults.rpmMode;
  dimensions = { diameter: Number(saved.diameter), thickness: Number(saved.thickness) };
  displayDimensions(); syncRpm(saved.rpmPreset);
  elements['calculator-form'].addEventListener('submit', (event) => event.preventDefault());
  for (const event of ['input', 'change']) elements['calculator-form'].addEventListener(event, () => { readDimensions(); updateCalculator(); });
  for (const button of root.querySelectorAll('[data-unit-mode]')) button.addEventListener('click', () => {
    if (unit() === button.dataset.unitMode) return;
    elements.unitMode.value = button.dataset.unitMode;
    displayDimensions(); updateCalculator();
  });
  for (const button of root.querySelectorAll('[data-rpm-mode]')) button.addEventListener('click', () => {
    if (elements.rpmMode.value === button.dataset.rpmMode) return;
    elements.rpmMode.value = button.dataset.rpmMode;
    syncRpm(); updateCalculator();
  });
  updateCalculator();
})();
