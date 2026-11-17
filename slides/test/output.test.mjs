import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { assertOutputPath, preparePngDirectory, writePresentation } from '../lib/output.mjs';

async function scratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slides-output-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('PPTX output uses the exact filename even with a non-pptx extension', async t => {
  const dir = await scratch(t), file = path.join(dir, 'result.tmp');
  const pptx = new PptxGenJS();
  pptx.addSlide().addText('Portable output', { x: 1, y: 1, w: 5, h: 1 });
  await writePresentation(pptx, file);
  assert.ok((await stat(file)).size > 1000);
  assert.equal((await readFile(file)).subarray(0, 2).toString(), 'PK');
  await assert.rejects(stat(file + '.pptx'), { code: 'ENOENT' });
});

test('PNG cleanup removes only numbered PNG files and preserves other files and directories', async t => {
  const dir = await scratch(t);
  for (const name of ['01-old.png', '99-obsolete.png', 'capture.png', '1-short.png', '100-long.png', '01-old.jpg', 'notes.txt']) await writeFile(path.join(dir, name), name);
  await mkdir(path.join(dir, '02-directory.png'));
  await symlink(path.join(dir, 'notes.txt'), path.join(dir, '03-link.png'));
  await preparePngDirectory(dir);
  assert.deepEqual((await readdir(dir)).sort(), ['01-old.jpg', '02-directory.png', '1-short.png', '100-long.png', 'capture.png', 'notes.txt'].sort());
  assert.equal(await readFile(path.join(dir, 'notes.txt'), 'utf8'), 'notes.txt');
});

test('export protection rejects existing source assets and aliases but allows export extensions', async t => {
  const dir = await scratch(t), deck = path.join(dir, 'deck.html'), css = path.join(dir, 'slides.css');
  await writeFile(deck, '<html></html>'); await writeFile(css, 'Keep these styles');
  for (const command of ['html', 'pdf', 'pptx', 'png', 'check']) await assert.rejects(assertOutputPath(command, deck, css), /Refusing to overwrite|must be a directory/);
  assert.equal(await readFile(css, 'utf8'), 'Keep these styles');
  for (const command of ['html', 'pdf', 'pptx']) {
    const out = path.join(dir, 'existing.' + command);
    await writeFile(out, 'previous export');
    await assertOutputPath(command, deck, out);
  }
  const alias = path.join(dir, 'alias.pdf');
  await symlink(deck, alias);
  await assert.rejects(assertOutputPath('pdf', deck, alias), /differ from the source/);
  const cssAlias = path.join(dir, 'styles.pdf');
  await symlink(css, cssAlias);
  await assert.rejects(assertOutputPath('pdf', deck, cssAlias), /Refusing to overwrite/);
  await assertOutputPath('pdf', deck, path.join(dir, 'new.tmp'));
  const nested = path.join(dir, 'nested'); await mkdir(nested);
  const nestedDeck = path.join(nested, 'deck.html'), outside = path.join(dir, 'existing.tmp');
  await writeFile(nestedDeck, '<html></html>');
  await writeFile(outside, 'previous export');
  await assertOutputPath('pdf', nestedDeck, outside);
});
