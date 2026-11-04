#!/usr/bin/env node
import { parseOptions } from '../lib/options.mjs';
import { runCommand } from '../lib/commands.mjs';
const usage = {
  new: 'slides new <dir> [--title "…"] [--theme ink|paper] [--onepager] [--force]',
  check: 'slides check <deck.html> [--theme name] [--out dir] [--json]',
  png: 'slides png <deck.html> [--out dir] [--theme name] [--scale 2] [--slide id] [--json]',
  pdf: 'slides pdf <deck.html> [--out file.pdf] [--theme name] [--json]',
  pptx: 'slides pptx <deck.html> [--out file.pptx] [--theme name] [--json]',
  html: 'slides html <deck.html> [--out file.html] [--theme name] [--json]'
};
const wantsJSON = process.argv.slice(2).includes('--json');
try {
  const { command, input, options } = parseOptions(process.argv.slice(2));
  if (options.help || !command) {
    console.log(`${command ? usage[command] : 'Portable HTML slide decks and A4 one-pagers\n\n' + Object.values(usage).join('\n')}\n\nRendering: --browser <Chromium path> or SLIDES_BROWSER; otherwise auto-detect.\nAll commands accept --json; exports emit one JSON line. Node >=20.\nInstall dependencies once: npm install --prefix <skill>/slides`);
  } else {
    const result = await runCommand(command, input, options);
    if (options.json) console.log(JSON.stringify(result));
    else if (result.slides) {
      for (const slide of result.slides) {
        console.log(`${slide.id}: ${slide.issues.length ? slide.issues.length + ' issue(s)' : 'OK'} · ${slide.png}`);
        for (const issue of slide.issues) console.log(`  ${issue.level}: ${issue.kind}: ${issue.message} (${issue.selector})`);
      }
      console.log(`${result.ok ? 'PASS' : 'FAIL'}: ${result.slides.length} slides checked`);
    } else console.log(result.file ? `Wrote ${result.file}` : `Wrote ${result.files.length} PNGs to ${result.files[0] && new URL('.', 'file://' + result.files[0]).pathname}`);
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  if (wantsJSON) console.log(JSON.stringify({ ok: false, error: error.message }));
  else console.error(`slides: ${error.message}`);
  process.exitCode = 1;
}
