import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inlineHTML, inlineCSS } from '../lib/inline.mjs';
import { parseHTML, descendants, textContent } from '../lib/html.mjs';
import { parseDeck } from '../lib/deck.mjs';
const fixture = fileURLToPath(new URL('./fixtures/tiny.html', import.meta.url));
const unData = value => Buffer.from(value.split(',')[1], 'base64').toString('utf8');

test('a tiny HTML fixture bundles styles, recursive imports, images, inline CSS and JS', async () => {
  const html = await inlineHTML(fixture, 'paper');
  const nodes = descendants(parseHTML(html), () => true);
  const links = nodes.filter(node => node.tag === 'link');
  assert.ok(links.every(node => node.attrs.href.startsWith('data:text/css;base64,')));
  const css = unData(links[0].attrs.href);
  assert.match(css, /@media screen/);
  assert.match(css, /rebeccapurple/);
  assert.doesNotMatch(css, /@import|icon\.svg/);
  assert.match(css, /data:image\/svg\+xml;base64/);
  assert.match(unData(links.find(node => node.attrs.id === 'theme').attrs.href), /--bg: #fff/);
  const image = nodes.find(node => node.tag === 'img');
  assert.match(unData(image.attrs.src), /<svg/);
  assert.match(image.attrs.style, /data:image\/svg\+xml;base64/);
  const style = nodes.find(node => node.tag === 'style');
  assert.match(textContent(style), /data:image\/svg\+xml;base64/);
  const script = nodes.find(node => node.tag === 'script' && node.attrs.src);
  assert.equal(unData(script.attrs.src), await readFile(new URL('./fixtures/tiny.js', import.meta.url), 'utf8'));
  const themes = JSON.parse(textContent(nodes.find(node => node.attrs?.id === 'deck-themes')));
  assert.deepEqual(Object.keys(themes).sort(), ['ink', 'paper']);
  assert.equal(parseDeck(html).slides[0].notes, 'Notes survive bundling.');
  assert.doesNotMatch(html, /file:\/\/|https?:\/\//);
});

test('data URLs and fragment references stay intact; remote CSS assets fail clearly', async () => {
  const base = pathToFileURL(fixture);
  assert.equal(await inlineCSS('a{background:url(data:image/png;base64,AAAA);filter:url(#local)}', base), 'a{background:url("data:image/png;base64,AAAA");filter:url("#local")}');
  await assert.rejects(inlineCSS('a{background:url(https://example.com/image.png)}', base), /non-local asset/);
});

test('circular CSS imports fail rather than recursing indefinitely', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slides-css-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.css');
  await writeFile(file, '@import "a.css";');
  await assert.rejects(inlineCSS(await readFile(file, 'utf8'), pathToFileURL(file)), /Circular CSS import/);
});
