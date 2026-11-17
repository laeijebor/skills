import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export async function browserCandidates(explicit) {
  if (explicit || process.env.SLIDES_BROWSER) return [explicit || process.env.SLIDES_BROWSER];
  const candidates = [chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/brave-browser', '/opt/google/chrome/chrome'];
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
    try { candidates.push(execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { /* optional */ }
  }
  const available = [];
  for (const candidate of new Set(candidates)) {
    try { await access(candidate, constants.X_OK); available.push(candidate); } catch { /* optional */ }
  }
  return available;
}
export async function launchBrowser(explicit) {
  const failures = [];
  for (const executablePath of await browserCandidates(explicit)) {
    try { return await chromium.launch({ executablePath, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] }); }
    catch (error) { failures.push(`${executablePath}: ${error.message.split('\n')[0]}`); }
  }
  throw new Error(`No Chromium could be launched. Set --browser <path> or SLIDES_BROWSER to a Chrome/Chromium executable.${failures.length ? ` ${failures.join('; ')}` : ''}`);
}
export async function openDeck(browser, file, deck, options = {}) {
  const page = await browser.newPage({ viewport: { width: deck.width, height: deck.height }, deviceScaleFactor: options.scale ?? 1 });
  const failures = new Set();
  await page.route(/^https?:/i, route => route.abort('blockedbyclient'));
  page.on('requestfailed', request => failures.add(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) failures.add(`${response.url()}: HTTP ${response.status()}`); });
  const url = pathToFileURL(path.resolve(file));
  if (options.theme) url.searchParams.set('theme', options.theme);
  url.searchParams.set(options.print ? 'print' : 'thumb', '');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
  // A missing-id fallback is also supported by exports of decks without deck.js.
  await page.evaluate(() => document.querySelectorAll('main.deck > section.slide').forEach((slide, i) => { if (!slide.id) slide.id = `slide-${i + 1}`; }));
  return { page, failures };
}
export async function selectSlide(page, index) {
  await page.evaluate(index => {
    const slides = [...document.querySelectorAll('main.deck > section.slide')];
    slides.forEach((slide, i) => slide.classList.toggle('on', i === index));
    location.hash = slides[index].id;
  }, index);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
