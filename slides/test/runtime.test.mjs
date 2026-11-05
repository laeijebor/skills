import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const code = await readFile(new URL('../templates/deck/deck.js', import.meta.url), 'utf8');
function run({ theme = 'unknown', bundled, href = 'file:///deck/deck.html' } = {}) {
  const link = { href: 'themes/ink.css' }, slide = { id: 'start', dataset: {}, style: {}, append() {}, classList: { toggle(name, value) { slide[name] = value; } } };
  const window = {};
  const document = {
    currentScript: { src: 'data:text/javascript;base64,AAAA' },
    getElementById: id => id === 'theme' ? link : id === 'deck-themes' && bundled !== undefined ? { textContent: JSON.stringify(bundled) } : null,
    documentElement: { dataset: {}, style: { setProperty() {} }, classList: { toggle() {} } },
    querySelector: () => null, querySelectorAll: () => [slide],
    head: { append() {} }, createElement: () => ({}), title: 'Runtime test'
  };
  runInNewContext(code, { document, location: { href, search: `?theme=${theme}`, hash: '' }, URL, URLSearchParams, window, parent: window, innerWidth: 1280, innerHeight: 720, addEventListener() {} });
  assert.equal(slide.on, true, 'runtime must reach slide selection');
  return link.href;
}

test('unknown bundled themes preserve the default and keep the runtime alive', () => {
  assert.equal(run({ bundled: { paper: 'data:text/css;base64,AAAA' } }), 'themes/ink.css');
  assert.equal(run({ bundled: {} }), 'themes/ink.css');
});

test('known bundled themes use only embedded CSS', () => {
  assert.equal(run({ theme: 'paper', bundled: { paper: 'data:text/css;base64,AAAA' } }), 'data:text/css;base64,AAAA');
});

test('folder themes resolve relative to the deck even when deck.js is a data URL', () => {
  assert.equal(run({ theme: 'paper' }), 'file:///deck/themes/paper.css');
  assert.equal(run({ theme: 'paper', href: 'data:text/html,hello' }), 'themes/ink.css');
});

test('the reconnect example has the same fixed runtime as the template', async () => {
  assert.equal(await readFile(new URL('../examples/reconnect-loop/deck.js', import.meta.url), 'utf8'), code);
});
