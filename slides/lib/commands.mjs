import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { escape } from './html.mjs';
import { ID, parseDeck } from './deck.mjs';
import { outputPath } from './options.mjs';
import { launchBrowser, openDeck, selectSlide } from './browser.mjs';
import { inspectSlide } from './check.mjs';
import { inlineHTML } from './inline.mjs';
import { assertOutputPath, preparePngDirectory, writePresentation } from './output.mjs';
const template = fileURLToPath(new URL('../templates/deck/', import.meta.url));
export async function newDeck(directory, options) {
  const dir = path.resolve(directory), file = path.join(dir, 'deck.html');
  let exists = false; try { await access(file); exists = true; } catch { /* absent */ }
  if (exists && !options.force) throw new Error(`Refusing to overwrite ${file}; use --force`);
  await mkdir(dir, { recursive: true });
  for (const name of ['slides.css', 'deck.js', 'themes']) await cp(path.join(template, name), path.join(dir, name), { recursive: true, force: Boolean(options.force), errorOnExist: false });
  let html = await readFile(options.onepager ? new URL('../templates/onepager/onepager.html', import.meta.url) : path.join(template, 'deck.html'), 'utf8');
  if (options.title !== undefined) html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escape(options.title)}</title>`).replace(/(<meta name="deck:title" content=")[^"]*/, (_, prefix) => `${prefix}${escape(options.title)}`);
  html = html.replace('themes/ink.css', `themes/${options.theme || 'ink'}.css`);
  await writeFile(file, html);
  return { ok: true, file };
}
export const pngName = (slide, index) => `${String(index + 1).padStart(2, '0')}-${ID.test(slide.id) ? slide.id : `slide-${index + 1}`}.png`;
export async function runCommand(command, input, options) {
  if (command === 'new') return newDeck(input, options);
  const file = path.resolve(input), out = outputPath(command, file, options.out);
  if (out === file) throw new Error('Output must differ from the source deck');
  const deck = parseDeck(await readFile(file, 'utf8'));
  await assertOutputPath(command, file, out);
  if (command !== 'check' && deck.slides.some(slide => slide.issues.some(issue => issue.level === 'error'))) throw new Error('Deck format errors; run slides check for details');
  if (command === 'png' && options.slide !== undefined && !deck.slides.some(slide => slide.id === options.slide)) throw new Error(`Unknown slide id: ${options.slide}`);
  if (command === 'html') {
    const html = await inlineHTML(file, options.theme);
    await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, html);
    return { ok: true, file: out };
  }
  const browser = await launchBrowser(options.browser);
  try {
    const scale = command === 'check' || command === 'pdf' ? 1 : Number(options.scale ?? 2);
    const { page, failures } = await openDeck(browser, file, deck, { ...options, scale, print: command === 'pdf' });
    if (command === 'pdf') {
      if (failures.size) throw new Error(`Failed requests: ${[...failures].join('; ')}`);
      await mkdir(path.dirname(out), { recursive: true });
      await page.pdf({ path: out, width: `${deck.width}px`, height: `${deck.height}px`, margin: { top: 0, right: 0, bottom: 0, left: 0 }, printBackground: true, preferCSSPageSize: true });
      return { ok: true, file: out };
    }
    if (command === 'check' || command === 'png') await preparePngDirectory(out);
    const files = [], rendered = [], report = [];
    for (const [index, slide] of deck.slides.entries()) {
      if (command === 'png' && options.slide !== undefined && slide.id !== options.slide) continue;
      await selectSlide(page, index);
      const element = page.locator('main.deck > section.slide').nth(index);
      const issues = [...slide.issues];
      if (command === 'check') issues.push(...await page.evaluate(inspectSlide, { index, minimumText: deck.size === 'a4' ? 9 : 14 }));
      const png = await element.screenshot({ animations: 'disabled', type: 'png' });
      if (command === 'check' || command === 'png') {
        const target = path.join(out, pngName(slide, index));
        await writeFile(target, png); files.push(target);
        report.push({ id: slide.id, title: slide.title, png: target, issues });
      } else rendered.push(png);
    }
    if (command === 'check') {
      // Requests can fail while an individual slide is being captured.
      for (const message of failures) report[0].issues.push({ level: 'error', kind: 'request', message, selector: 'document' });
      return { ok: !report.some(slide => slide.issues.some(issue => issue.level === 'error')), slides: report };
    }
    if (failures.size) throw new Error(`Failed requests: ${[...failures].join('; ')}`);
    if (command === 'png') return { ok: true, files };
    const pptx = new PptxGenJS();
    const [width, height] = deck.size === 'a4' ? [8.27, 11.69] : [13.333, 7.5];
    pptx.defineLayout({ name: 'DECK', width, height }); pptx.layout = 'DECK'; pptx.title = deck.title;
    for (const [index, png] of rendered.entries()) {
      const slide = pptx.addSlide();
      slide.addImage({ data: `image/png;base64,${png.toString('base64')}`, x: 0, y: 0, w: width, h: height });
      if (deck.slides[index].notes) slide.addNotes(deck.slides[index].notes);
    }
    await writePresentation(pptx, out);
    return { ok: true, file: out };
  } finally { await browser.close(); }
}
