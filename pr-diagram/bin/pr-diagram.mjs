#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { TYPES, validate, render } from '../lib/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `pr-diagram: draw a code change as an animated SVG

  pr-diagram types                         which diagram answers which reviewer question
  pr-diagram example <type>                a complete document of that type, to adapt
  pr-diagram validate <file.json...>       check documents, including labels that would be cut off or overlap
  pr-diagram render <file.json...> [--out <dir>] [--png] [--draft]
                                           write <name>.svg next to each document (or into --out);
                                           --png also writes a preview image with headless Chrome;
                                           --draft still draws a document whose layout has errors, so you can see them

A document is one JSON object with a "type". Field reference: references/document.md`;

const args = process.argv.slice(2), command = args.shift();
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const fail = (message) => { console.error(`pr-diagram: ${message}`); process.exit(1); };
const load = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { fail(`${file}: ${error.code === 'ENOENT' ? 'no such file' : 'not valid JSON: ' + error.message}`); } };
const report = (file, issues) => { for (const i of issues) console.error(`${file}: ${i.level}: ${i.message}`); };

function findBrowser() {
  const candidates = [process.env.PR_DIAGRAM_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => p && existsSync(p));
}

if (!command || command === 'help' || command === '--help') console.log(USAGE);
else if (command === 'types') {
  const w = Math.max(...TYPES.map((t) => t.name.length));
  for (const t of TYPES) console.log(`${t.name.padEnd(w)}  ${t.when}\n${' '.repeat(w)}  → ${t.question}`);
} else if (command === 'example') {
  const file = join(root, 'examples', `${args[0]}.json`);
  if (!args[0] || !existsSync(file)) fail(`example needs a type: ${readdirSync(join(root, 'examples')).map((f) => f.replace('.json', '')).join(', ')}`);
  process.stdout.write(readFileSync(file, 'utf8'));
} else if (command === 'validate' || command === 'render') {
  const out = flag('--out'), png = has('--png'), draft = has('--draft');
  if (!args.length) fail(`${command} needs at least one file`);
  let bad = 0;
  for (const file of args) {
    const result = command === 'validate' ? { issues: (() => { const r = render(load(file)); return r.issues; })() } : render(load(file));
    report(file, result.issues);
    if (result.issues.some((i) => i.level === 'error')) { bad++; if (!(draft && result.draft)) continue; Object.assign(result, result.draft); }
    if (command === 'validate') { console.log(`✓ ${file}`); continue; }
    const dir = out ? resolve(out) : dirname(resolve(file));
    mkdirSync(dir, { recursive: true });
    const svgPath = join(dir, basename(file).replace(/\.json$/i, '') + '.svg');
    writeFileSync(svgPath, result.svg);
    console.log(`✓ ${svgPath} (${result.width}×${result.height})`);
    if (png) {
      const browser = findBrowser();
      if (!browser) fail('--png needs Chrome or Chromium; set PR_DIAGRAM_BROWSER to its path');
      const pngPath = svgPath.replace(/\.svg$/, '.png');
      execFileSync(browser, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${result.width},${result.height}`, `--screenshot=${pngPath}`, pathToFileURL(svgPath).href], { stdio: 'ignore' });
      console.log(`✓ ${pngPath}`);
    }
  }
  if (bad) { console.error(`${bad} of ${args.length} document${args.length === 1 ? '' : 's'} failed`); process.exit(1); }
} else fail(`unknown command "${command}"\n\n${USAGE}`);
