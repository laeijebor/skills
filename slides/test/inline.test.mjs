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
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('id="deck-themes"'), 'theme metadata must not push charset past the encoding prescan');
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

test('bundling preserves original markup byte-for-byte outside resource replacements', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slides-markup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'deck.html');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>';
  const source = "<!DOCTYPE html>\r\n<HTML lang='en'><head><title>π story</title><style>p { color: red; }</style></head>\r\n<body><!-- untouched -->\n<main class='deck'><section class='slide' id='story'>\n<p>Story<div>x</div>\n<svg viewBox='0 0 8 8'><path d='M0 0h8v8z'/></svg>\n<IMG alt='evidence'  src = 'icon.svg' >\n</section></main></body></HTML>";
  await writeFile(file, source);
  await writeFile(path.join(dir, 'icon.svg'), svg);
  const bundled = await inlineHTML(file);
  const expected = source.replace("src = 'icon.svg'", `src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"`);
  assert.equal(Buffer.compare(Buffer.from(bundled), Buffer.from(expected)), 0);
  assert.ok(bundled.includes('<p>Story<div>x</div>'));
});

test('every asset entry point rejects traversal, absolute files, escaping symlinks and hosts', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'slides-boundary-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const { mkdir, symlink } = await import('node:fs/promises');
  const dir = path.join(parent, 'deck');
  await mkdir(dir);
  const file = path.join(dir, 'deck.html'), secret = path.join(parent, 'secret.txt');
  await writeFile(secret, 'This must never enter an HTML bundle.');
  await symlink(secret, path.join(dir, 'escape.txt'));
  const references = ['../secret.txt', pathToFileURL(secret).href, 'escape.txt', '//host/x', 'file://localhost' + secret];
  const entries = [
    ref => `<img src="${ref}">`,
    ref => `<link rel="icon" href="${ref}">`,
    ref => `<link rel="stylesheet" href="${ref}">`,
    ref => `<style>div { background: url('${ref}'); }</style>`,
    ref => `<style>@import '${ref}';</style>`,
    ref => `<div style="background: url('${ref}')"></div>`,
    ref => `<script src="${ref}"></script>`,
    ref => `<img srcset="data:image/png;base64,AAAA 1x, ${ref} 2x">`,
    ref => `<video poster="${ref}"></video>`,
    ref => `<base href="${ref}">`
  ];
  for (const reference of references) {
    for (const entry of entries) {
      await writeFile(file, `<!doctype html><html><head></head><body>${entry(reference)}</body></html>`);
      await assert.rejects(inlineHTML(file), error => /outside the deck folder|with a host/.test(error.message) && error.message.includes(reference), `${entry(reference)} must reject the reference`);
    }
  }
});

test('recursive CSS imports retain the deck boundary and safe nested assets still work', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'slides-css-boundary-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  const dir = path.join(parent, 'deck');
  await mkdir(path.join(dir, 'nested'), { recursive: true });
  const file = path.join(dir, 'deck.html');
  await writeFile(file, '<link rel="stylesheet" href="nested/a.css">');
  await writeFile(path.join(parent, 'outside.css'), 'body { color: red; }');
  await writeFile(path.join(dir, 'nested/a.css'), '@import "../../outside.css";');
  await assert.rejects(inlineHTML(file), /outside the deck folder: ..\/..\/outside.css/);
  await writeFile(path.join(dir, 'nested/a.css'), 'body { background: url("../../outside.css"); }');
  await assert.rejects(inlineHTML(file), /outside the deck folder: ..\/..\/outside.css/);
  await writeFile(path.join(dir, 'nested/a.css'), 'body { background: url("../image.svg"); }');
  await writeFile(path.join(dir, 'image.svg'), '<svg/>');
  const bundled = await inlineHTML(file);
  assert.match(unData(descendants(parseHTML(bundled), node => node.tag === 'link')[0].attrs.href), /data:image\/svg\+xml;base64/);
});

test('themes directories and individual theme files cannot escape through symlinks', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'slides-themes-boundary-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const { mkdir, symlink } = await import('node:fs/promises');
  const dir = path.join(parent, 'deck'), outside = path.join(parent, 'private-themes');
  await mkdir(dir); await mkdir(outside);
  await writeFile(path.join(outside, 'secret.css'), 'body { background: red; }');
  await writeFile(path.join(dir, 'safe.css'), ':root { --bg: black; }');
  const file = path.join(dir, 'deck.html');
  await writeFile(file, '<head><link rel="stylesheet" id="theme" href="safe.css"></head>');
  await symlink(outside, path.join(dir, 'themes'));
  await assert.rejects(inlineHTML(file), /outside the deck folder: themes\//);
  await rm(path.join(dir, 'themes'));
  await mkdir(path.join(dir, 'themes'));
  await symlink(path.join(outside, 'secret.css'), path.join(dir, 'themes/secret.css'));
  await assert.rejects(inlineHTML(file), /outside the deck folder: secret.css/);
});

test('theme overrides and bundled theme discovery resolve from the deck file, ignoring base', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slides-theme-base-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(dir, 'assets')); await mkdir(path.join(dir, 'themes'));
  await writeFile(path.join(dir, 'themes/paper.css'), ':root { --bg: white; }');
  const file = path.join(dir, 'deck.html');
  await writeFile(file, '<head><base href="assets/"><link rel="stylesheet" id="theme" href="themes/paper.css"></head>');
  const bundled = await inlineHTML(file, 'paper');
  const nodes = descendants(parseHTML(bundled), () => true);
  assert.match(unData(nodes.find(node => node.attrs.id === 'theme').attrs.href), /--bg: white/);
  assert.equal(nodes.filter(node => node.tag === 'base').length, 0);
  assert.ok(JSON.parse(textContent(nodes.find(node => node.attrs.id === 'deck-themes'))).paper);
});
