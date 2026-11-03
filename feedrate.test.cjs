const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { translateLanguageText: translate } = require('./language.js');

test('inline calculator initializes, converts units and preserves settings without polluting shared globals', () => {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', dataset: {}, attrs: {}, listeners: {},
      classList: { toggle() {} },
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(key, callback) { this.listeners[key] = callback; },
    });
    return nodes.get(id);
  };
  const unitButtons = ['mm', 'inch'].map((mode) => Object.assign(node(mode), { dataset: { unitMode: mode } }));
  const rpmButtons = ['manual', 'makita', 'dewalt'].map((mode) => Object.assign(node(mode), { dataset: { rpmMode: mode } }));
  const calculationButtons = ['feed', 'rpm'].map((mode) => Object.assign(node(`calculate-${mode}`), { dataset: { calculationMode: mode } }));
  const rpmPanels = ['manual', 'preset'].map((mode) => Object.assign(node(`panel-${mode}`), { dataset: { rpmPanel: mode } }));
  const labels = [node('diameter-label'), node('thickness-label')];
  const root = {
    querySelector: (selector) => node(selector.slice(1)),
    querySelectorAll: (selector) => selector === '[data-unit-mode]' ? unitButtons : selector === '[data-length-unit]' ? labels : selector === '[data-rpm-mode]' ? rpmButtons : selector === '[data-calculation-mode]' ? calculationButtons : selector === '[data-rpm-panel]' ? rpmPanels : [],
  };
  const storage = new Map();
  const sentinel = () => 'shared';
  const context = vm.createContext({
    document: { getElementById: () => root },
    clamp: sentinel,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  vm.runInContext(readFileSync(`${__dirname}/feedrate.js`, 'utf8'), context);
  assert.equal(context.clamp, sentinel);
  assert.equal(node('feedRateValue').textContent, '1,870 mm/min');
  assert.equal(node('depthPerPassValue').textContent, '3 mm');
  assert.equal(node('plungeRateValue').textContent, '374 mm/min');
  unitButtons[1].listeners.click();
  assert.equal(node('diameter').value, '0.24');
  assert.ok(labels.every((label) => label.textContent === '(inches)'));
  assert.deepEqual(unitButtons.map((button) => button.attrs['aria-pressed']), ['false', 'true']);
  assert.match(node('feedRateValue').textContent, /in\/min/);
  unitButtons[0].listeners.click();
  assert.equal(node('diameter').value, '6');
  rpmButtons[0].listeners.click();
  node('rpmManual').value = '18000';
  node('calculator-form').listeners.input();
  assert.equal(node('feedRateValue').textContent, '1,980 mm/min');
  assert.equal(JSON.parse(storage.get('feedrate-calculator')).diameter, 6);
  node('flutes').value = '4';
  node('rpmManual').value = '30000';
  node('calculator-form').listeners.input();
  assert.equal(node('feedRateValue').textContent, '6,600 mm/min');
  assert.equal(node('plungeRateValue').textContent, '1,320 mm/min');
  assert.ok(!node('feedRateHelp').textContent.includes('Capped'));
  unitButtons[1].listeners.click();
  assert.equal(node('feedRateValue').textContent, '259.84 in/min');
  node('flutes').value = '';
  node('calculator-form').listeners.input();
  assert.equal(node('result-warning').hidden, false);
  assert.equal(node('feedRateValue').textContent, '—');
  node('flutes').value = '2';
  unitButtons[0].listeners.click();
  node('diameter').value = '6';
  node('desiredFeed').value = '1980';
  node('calculator-form').listeners.input();
  calculationButtons[1].listeners.click();
  assert.equal(node('spindleValue').textContent, '18,000 RPM');
  assert.equal(node('feedRateValue').textContent, '1,980 mm/min');
  assert.equal(node('desiredFeedPanel').hidden, false);
  assert.equal(node('spindlePanel').hidden, true);
  assert.equal(node('spindleResult').hidden, false);
  assert.ok(rpmPanels.every((panel) => panel.hidden));
  assert.deepEqual(calculationButtons.map((button) => button.attrs['aria-pressed']), ['false', 'true']);
  assert.equal(JSON.parse(storage.get('feedrate-calculator')).desiredFeed, 1980);
  assert.equal(JSON.parse(storage.get('feedrate-calculator')).calculationMode, 'rpm');
  unitButtons[1].listeners.click();
  assert.equal(Number(node('desiredFeed').value), 1980 / 25.4);
  assert.equal(node('spindleValue').textContent, '18,000 RPM');
  assert.equal(translate(node('spindleValue').textContent, 'fr'), '18,000 tr/min');
  assert.equal(translate(node('feedRateHelp').textContent, 'fr'), 'Votre avance souhaitée, utilisée pour estimer la vitesse de broche.');
  unitButtons[0].listeners.click();
  rpmButtons[1].listeners.click();
  assert.equal(node('spindleValue').textContent, '18,000 RPM');
  node('desiredFeed').value = '100';
  node('calculator-form').listeners.input();
  assert.equal(node('spindleValue').textContent, '909 RPM');
  assert.equal(node('feedRateValue').textContent, '100 mm/min');
  node('desiredFeed').value = '6600';
  node('calculator-form').listeners.input();
  assert.equal(node('spindleValue').textContent, '60,000 RPM');
  // Drill depth reduction must be inverted as well as the material chip load.
  rpmButtons[0].listeners.click();
  node('toolType').value = 'Drill';
  node('desiredFeed').value = '1710';
  node('rpmManual').value = '';
  node('calculator-form').listeners.input();
  assert.equal(node('spindleValue').textContent, '20,000 RPM');
  assert.equal(node('result-warning').hidden, true);
  node('desiredFeed').value = '';
  node('calculator-form').listeners.input();
  assert.equal(node('spindleValue').textContent, '—');
  assert.equal(node('result-warning').hidden, false);
  calculationButtons[0].listeners.click();
  node('rpmManual').value = '18000';
  node('toolType').value = 'End Mill';
  node('calculator-form').listeners.input();
  assert.equal(node('feedRateValue').textContent, '1,980 mm/min');
  assert.equal(node('spindleResult').hidden, true);
  assert.equal(node('spindlePanel').hidden, false);
  assert.equal(node('desiredFeedPanel').hidden, true);
  assert.equal(rpmPanels[0].hidden, false);
});

test('calculator markup is inline, has unique IDs and no lazy iframe dependency', () => {
  const html = readFileSync(`${__dirname}/index.html`, 'utf8');
  assert.ok(html.includes('id="calculator-form"'));
  assert.ok(html.includes('src="./feedrate.js"'));
  assert.ok(!html.includes('feedrate-frame'));
  assert.ok(!html.includes('feedrate_calculator.html'));
  assert.ok(!html.includes('id="spindleHelp"'));
  assert.ok(html.indexOf('id="desiredFeedPanel"') > html.indexOf('id="spindlePanel"'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
