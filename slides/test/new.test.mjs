import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newDeck, runCommand } from '../lib/commands.mjs';
import { parseDeck } from '../lib/deck.mjs';
import { inlineHTML } from '../lib/inline.mjs';

test('scaffolding copies assets, escapes title literally, and protects existing decks', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slides-new-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const title = 'A <finding> & "proof" $& $1';
  const result = await newDeck(dir, { title, theme: 'paper' });
  const original = await readFile(result.file, 'utf8');
  const deck = parseDeck(original);
  assert.equal(deck.title, title);
  assert.equal(deck.slides.length, 7);
  assert.deepEqual(deck.slides.flatMap(slide => slide.issues), []);
  assert.match(original, /themes\/paper\.css/);
  for (const asset of ['slides.css', 'deck.js', 'themes/ink.css', 'themes/paper.css']) assert.ok((await stat(path.join(dir, asset))).size > 100);
  await assert.rejects(newDeck(dir, {}), /Refusing to overwrite/);
  assert.equal(await readFile(result.file, 'utf8'), original);
  await writeFile(path.join(dir, 'slides.css'), 'User customisations');
  await newDeck(dir, { force: true, onepager: true });
  assert.equal(parseDeck(await readFile(result.file, 'utf8')).size, 'a4');
  assert.notEqual(await readFile(path.join(dir, 'slides.css'), 'utf8'), 'User customisations');
});

test('HTML export of a scaffold is standalone without a browser', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slides-bundle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { file } = await newDeck(dir, { title: 'Portable' });
  const result = await runCommand('html', file, { theme: 'paper' });
  assert.equal(result.file, path.join(dir, 'deck.bundle.html'));
  assert.ok((await stat(result.file)).size > 10000);
  assert.equal(parseDeck(await readFile(result.file, 'utf8')).title, 'Portable');
  assert.equal(await inlineHTML(file, 'paper'), await readFile(result.file, 'utf8'));
  await assert.rejects(runCommand('html', file, { out: file }), /Output must differ/);
});

test('unknown --slide and protected output files return one error JSON line before rendering', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slides-cli-errors-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { file } = await newDeck(dir, {});
  const cli = fileURLToPath(new URL('../bin/slides.mjs', import.meta.url));
  for (const [args, message] of [
    [['png', file, '--slide', 'missing'], /Unknown slide id: missing/],
    [['pdf', file, '--out', path.join(dir, 'slides.css')], /Refusing to overwrite/]
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trim().split('\n').length, 1);
    const json = JSON.parse(result.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, message);
  }
});
