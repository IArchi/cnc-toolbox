const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

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
  const labels = [node('diameter-label'), node('thickness-label')];
  const root = {
    querySelector: (selector) => node(selector.slice(1)),
    querySelectorAll: (selector) => selector === '[data-unit-mode]' ? unitButtons : selector === '[data-length-unit]' ? labels : selector === '[data-rpm-mode]' ? rpmButtons : [],
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
  node('flutes').value = '';
  node('calculator-form').listeners.input();
  assert.equal(node('result-warning').hidden, false);
  assert.equal(node('feedRateValue').textContent, '—');
});

test('calculator markup is inline, has unique IDs and no lazy iframe dependency', () => {
  const html = readFileSync(`${__dirname}/index.html`, 'utf8');
  assert.ok(html.includes('id="calculator-form"'));
  assert.ok(html.includes('src="./feedrate.js"'));
  assert.ok(!html.includes('feedrate-frame'));
  assert.ok(!html.includes('feedrate_calculator.html'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
