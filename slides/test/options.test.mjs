import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseOptions, outputPath } from '../lib/options.mjs';

test('options accept separated and equals values and command-specific flags', () => {
  assert.deepEqual(parseOptions(['new', 'my deck', '--title', 'A clear title', '--theme=paper', '--onepager', '--force']), { command: 'new', input: 'my deck', options: { title: 'A clear title', theme: 'paper', onepager: true, force: true } });
  assert.deepEqual(parseOptions(['png', 'deck.html', '--scale=3', '--browser', '/path with spaces/chrome', '--json']).options, { scale: '3', browser: '/path with spaces/chrome', json: true });
  assert.equal(parseOptions(['--help']).options.help, true);
  assert.equal(parseOptions(['pdf', '-h']).options.help, true);
  assert.equal(parseOptions(['png', 'deck.html', '--slide', 'takeaways']).options.slide, 'takeaways');
});

test('rejects unknown, missing, invalid and inappropriate options', () => {
  for (const args of [
    ['unknown'], ['pdf'], ['pdf', 'a', 'b'], ['pdf', 'a', '--bogus'], ['pdf', 'a', '--out'],
    ['pdf', 'a', '--out', '--json'], ['pdf', 'a', '--force'], ['check', 'a', '--scale', '2'], ['pdf', 'a', '--slide', 'x'],
    ['new', 'a', '--theme', 'brand'], ['new', 'a', '--title'], ['pdf', 'a', '--theme', '../secret'],
    ['png', 'a', '--scale', '0'], ['png', 'a', '--scale', '-1'], ['png', 'a', '--scale', 'NaN'],
    ['png', 'a', '--scale', 'Infinity'], ['png', 'a', '--scale', '9'], ['pdf', 'a', '--json=false']
  ]) assert.throws(() => parseOptions(args), Error, args.join(' '));
  assert.equal(parseOptions(['html', 'a', '--theme', 'brand-2']).options.theme, 'brand-2');
});

test('output defaults stay beside a deck and explicit paths are absolute', () => {
  const file = path.resolve('/tmp/project notes/brief.html');
  assert.equal(outputPath('pdf', file), '/tmp/project notes/brief.pdf');
  assert.equal(outputPath('pptx', file), '/tmp/project notes/brief.pptx');
  assert.equal(outputPath('html', file), '/tmp/project notes/brief.bundle.html');
  assert.equal(outputPath('png', file), '/tmp/project notes/png');
  assert.equal(outputPath('check', file), '/tmp/project notes/.slides/check');
  assert.equal(outputPath('pdf', 'deck.html', 'custom.pdf'), path.resolve('custom.pdf'));
});
