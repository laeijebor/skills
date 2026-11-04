import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserCandidates } from '../lib/browser.mjs';
const cli = fileURLToPath(new URL('../bin/slides.mjs', import.meta.url));
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(stdout.trim().split('\n').length, 1, 'CLI emits exactly one JSON line');
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true, stdout);
    return result;
  } catch (error) {
    if (error.stdout) error.message += `\n${error.stdout}`;
    throw error;
  }
}
async function substantial(file, minimum = 1000) {
  assert.ok(path.isAbsolute(file), file);
  assert.ok((await stat(file)).size > minimum, `${file} must be non-trivial`);
}

test('CLI new → check → PDF / PPTX / PNG / HTML for both deck sizes', { timeout: 180000 }, async t => {
  // Explicit opt-out avoids even a launch attempt in a known restricted sandbox.
  // Normally, missing browsers or a launch failure below are reported as skips.
  if (process.env.SLIDES_SKIP_BROWSER_TESTS === '1') {
    t.skip('Browser integration disabled with SLIDES_SKIP_BROWSER_TESTS=1; Chromium cannot launch in this sandbox. Run npm test outside the sandbox.');
    return;
  }
  if (!(await browserCandidates()).length) {
    t.skip('No Chromium executable found; set SLIDES_BROWSER and rerun npm test.');
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'slides-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const onepager of [false, true]) {
    const dir = path.join(root, onepager ? 'onepager' : 'deck');
    const { file } = run(['new', dir, '--title', 'Integration smoke', ...(onepager ? ['--onepager'] : [])]);
    await substantial(file);
    const count = onepager ? 1 : 7;
    let checked;
    try { checked = run(['check', file]); }
    catch (error) {
      if (/No Chromium could be launched|browser could not launch/i.test(error.message)) {
        t.skip(`Chromium could not launch; run npm test with a working SLIDES_BROWSER. ${error.message.split('\n').at(-2) || ''}`);
        return;
      }
      throw error;
    }
    assert.equal(checked.slides.length, count);
    for (const slide of checked.slides) {
      assert.deepEqual(slide.issues, [], JSON.stringify(slide));
      await substantial(slide.png);
      const png = await readFile(slide.png);
      assert.equal(png.readUInt32BE(16), onepager ? 794 : 1280);
      assert.equal(png.readUInt32BE(20), onepager ? 1123 : 720);
    }
    const pdf = run(['pdf', file]);
    await substantial(pdf.file);
    assert.equal((await readFile(pdf.file)).subarray(0, 5).toString(), '%PDF-');
    const pptx = run(['pptx', file]);
    await substantial(pptx.file);
    assert.equal((await readFile(pptx.file)).subarray(0, 2).toString(), 'PK');
    const pngs = run(['png', file]);
    assert.equal(pngs.files.length, count);
    for (const file of pngs.files) {
      await substantial(file);
      const png = await readFile(file);
      assert.equal(png.readUInt32BE(16), onepager ? 1588 : 2560);
      assert.equal(png.readUInt32BE(20), onepager ? 2246 : 1440);
    }
    const html = run(['html', file, '--theme', 'paper']);
    await substantial(html.file);
    // Recheck after moving the single file away from all its source assets.
    const isolated = path.join(root, `${onepager ? 'a4' : 'wide'}.html`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(isolated, await readFile(html.file));
    const bundled = run(['check', isolated, '--theme', 'paper', '--out', path.join(root, onepager ? 'a4-check' : 'wide-check')]);
    assert.equal(bundled.slides.length, count);
    for (const slide of bundled.slides) assert.deepEqual(slide.issues, [], JSON.stringify(slide));
  }
});
