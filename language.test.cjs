const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { translateLanguageText: translate, languagePairs } = require('./language.js');

test('all translation entries work in both directions, including dynamic messages', () => {
  for (const [fr, en] of languagePairs) {
    const sample = (text) => text.replace(/\{(\d+)\}/g, (_, index) => `sample${index}`);
    assert.equal(translate(sample(fr), 'en'), sample(en), fr);
    // Some English labels intentionally share the same French translation.
    assert.equal(translate(translate(sample(en), 'fr'), 'en'), sample(en), en);
  }
  assert.equal(translate('Plan refusé : Ligne 12 : rapide sous la surface du panneau.', 'en'),
    'Plan rejected: Line 12: rapid motion below the stock surface.');
  assert.equal(translate('Rotation × nombre de dents × avance par dent. Avance par dent réduite pour le foret.', 'en'),
    'RPM × flute count × chip load. Reduced chip load for drills.');
  assert.equal(translate('my-custom-file.c2d', 'fr'), 'my-custom-file.c2d');
});

test('French static page text has English translations', () => {
  for (const file of ['index.html']) {
    const markup = readFileSync(`${__dirname}/${file}`, 'utf8').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
    for (const match of markup.matchAll(/>([^<>]+)</g)) {
      const text = match[1].replace(/\s+/g, ' ').trim();
      if (/[àâéèêëîïôùûçœ]/i.test(text)) assert.notEqual(translate(text, 'en'), text, `${file}: ${text}`);
    }
  }
});

test('calculator labels and generated results are translated into French', () => {
  const html = readFileSync(`${__dirname}/index.html`, 'utf8').split('id="feedrate-page"')[1].split('<section id="simulator-page"')[0];
  const unchanged = new Set(['(mm)', '(mm/min)', 'Makita RT07', 'Dewalt DW6xx', '—']);
  for (const match of html.matchAll(/>([^<>]+)</g)) {
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (text && !unchanged.has(text)) assert.notEqual(translate(text, 'fr'), text, text);
  }
  for (const text of ['Softwood / MDF', 'Hardwood / Plywood', 'PVC Foam', 'Copper / Brass',
    'Approximately 17,000 RPM; check your specific model.', 'Choose a speed dial position.',
    'Position 3 · 17,000 RPM (default)', 'Position 2 · 12,000 RPM', '18,000 RPM', '78.74 in/min', '0.12 in', '(in/min)',
    '50% of the diameter, capped by material thickness.',
    'RPM × flute count × chip load. Reduced chip load for drills.',
    'RPM × flute count × chip load. Reduced chip load for V-bits.',
    'RPM × flute count × chip load. Raised to the calculator minimum: 100 mm/min. Check chip load with the manufacturer.',
    '20% of the XY feed rate, reduced further for deep plunges.']) {
    const french = translate(text, 'fr');
    assert.notEqual(french, text, text);
    assert.doesNotMatch(french, /Raised|Check chip load|Reduced chip load|RPM|in\/min/);
    assert.equal(translate(french, 'en'), text, text);
  }
});

test('switching language preserves nodes, form values and imported content, and handles new messages', () => {
  class Element {
    constructor(tag, attrs = {}, children = []) {
      this.nodeType = 1; this.tag = tag; this.attrs = attrs; this.childNodes = children;
      this.listeners = {}; this.value = '123';
      for (const child of children) child.parentElement = this;
    }
    matches(selector) { return selector.split(', ').some((part) => part === this.tag || part === '[data-no-translate]' && 'data-no-translate' in this.attrs || part === '.toolpath-name' && this.attrs.class === 'toolpath-name'); }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    hasAttribute(key) { return key in this.attrs; }
    getAttribute(key) { return this.attrs[key]; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, callback) { this.listeners[key] = callback; }
  }
  const text = (value) => ({ nodeType: 3, nodeValue: value });
  const label = text('  Vitesses de coupe  '), message = text('Plan refusé : Marge invalide.');
  const importedName = text('Matériau'), source = text('G0 X10 Y20');
  const toggle = new Element('button', { 'data-no-translate': '' });
  const input = new Element('input', { placeholder: 'Ex. 900' });
  const frameCalls = [];
  const frame = { contentWindow: { postMessage: (message) => frameCalls.push(message) }, addEventListener() {} };
  Object.defineProperty(frame.contentWindow, 'CncLanguage', { get() { throw new Error('Blocked cross-origin access'); } });
  const root = new Element('html', {}, [new Element('span', {}, [label]), new Element('p', {}, [message]),
    new Element('span', { class: 'toolpath-name' }, [importedName]), new Element('textarea', {}, [source]), input, toggle]);
  let observe;
  const storage = new Map();
  const windowListeners = {};
  const parentMessages = [];
  const parent = { postMessage: (message) => parentMessages.push(message) };
  const context = vm.createContext({
    window: { parent, addEventListener(key, callback) { windowListeners[key] = callback; } },
    document: { documentElement: root, getElementById: (id) => id === 'language-toggle' ? toggle : frame, querySelectorAll: () => [frame] },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    MutationObserver: class { constructor(callback) { observe = callback; } observe() {} },
  });
  vm.runInContext(readFileSync(`${__dirname}/language.js`, 'utf8'), context);
  assert.equal(label.nodeValue, '  Feeds and speeds  ');
  assert.equal(message.nodeValue, 'Plan rejected: Invalid margin.');
  assert.equal(importedName.nodeValue, 'Matériau');
  assert.equal(source.nodeValue, 'G0 X10 Y20');
  assert.equal(input.value, '123');
  toggle.listeners.click();
  assert.equal(label.nodeValue, '  Vitesses de coupe  ');
  assert.equal(storage.get('cnc-language'), 'fr');
  assert.equal(input.attrs.placeholder, 'Ex. 900');
  context.window.CncLanguage.setLanguage('en');
  message.nodeValue = 'Le repère croise ou approche un usinage. Veuillez le déplacer.';
  observe([{ type: 'characterData', target: message }]);
  assert.equal(message.nodeValue, 'The reference intersects or is too close to a cut. Move it.');
  assert.equal(frameCalls.at(-1).language, 'en');
  assert.equal(parentMessages[0].type, 'cnc-language-ready');
  windowListeners.message({ source: {}, data: { type: 'cnc-language', language: 'fr' } });
  assert.equal(context.window.CncLanguage.language, 'en');
  windowListeners.message({ source: parent, data: { type: 'cnc-language', language: 'fr' } });
  assert.equal(context.window.CncLanguage.language, 'fr');
  assert.equal(label.nodeValue, '  Vitesses de coupe  ');
  windowListeners.message({ source: parent, data: { type: 'cnc-language', language: 'invalid' } });
  assert.equal(context.window.CncLanguage.language, 'fr');
  const count = frameCalls.length;
  windowListeners.message({ source: frame.contentWindow, data: { type: 'cnc-language-ready' } });
  assert.equal(frameCalls.length, count + 1);
  assert.equal(frameCalls.at(-1).language, 'fr');
});
