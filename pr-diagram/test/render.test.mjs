import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TYPES, validate, render } from '../lib/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const example = (name) => JSON.parse(readFileSync(join(root, 'examples', `${name}.json`), 'utf8'));
const errors = (issues) => issues.filter((i) => i.level === 'error').map((i) => i.message);

// Every opening tag closes, in order. Enough to catch a broken template string.
function wellFormed(svg) {
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else if (!m[4]) stack.push(m[2]);
  }
  return stack.length === 0;
}

test('every type has an example, and every example draws cleanly', () => {
  const files = readdirSync(join(root, 'examples')).map((f) => f.replace('.json', ''));
  for (const type of TYPES) assert.ok(files.includes(type.name), `no example for ${type.name}`);
  for (const name of files) {
    const out = render(example(name), { baseDir: join(root, 'examples') });
    assert.deepEqual(errors(out.issues), [], name);
    assert.ok(wellFormed(out.svg), `${name}: malformed SVG`);
    assert.doesNotMatch(out.svg, /NaN|undefined|Infinity/, name);
    assert.ok(out.width <= 1240, `${name}: ${out.width}px is too wide for a pull request`);
  }
});

test('an unknown field is rejected and names the allowed ones', () => {
  const doc = { ...example('state-machine'), colour: 'red' };
  assert.match(errors(validate(doc))[0], /unknown field "colour"/);
});

test('an edge to an undeclared id is rejected', () => {
  const doc = example('decision-flow');
  doc.edges[0].to = 'nowhere';
  assert.match(errors(validate(doc)).join('\n'), /"nowhere" is not a declared node/);
});

test('a label too long for its card is an error, not a cut-off', () => {
  const doc = example('pipeline');
  doc.stages[0].jobs[0].label = 'W'.repeat(28);
  const out = render(doc);
  assert.equal(out.svg, undefined);
  assert.match(errors(out.issues).join('\n'), /too long to draw/);
});

test('an on-edge label has a tighter limit than a legend label', () => {
  const doc = example('architecture');
  doc.edges[0].label = 'a label that is far too long for an edge';
  assert.match(errors(validate(doc)).join('\n'), /fits 30/);
});

test('col and row go on every item or none', () => {
  const doc = example('state-machine');
  doc.states[0].col = 0; doc.states[0].row = 0;
  assert.match(errors(validate(doc)).join('\n'), /every item, or to none/);
});

test('a mostly-new diagram marks what already existed instead of every new card', () => {
  const fresh = render(JSON.parse(readFileSync(join(root, 'test/fixtures/new-area.json'), 'utf8')));
  assert.deepEqual(errors(fresh.issues), []);
  assert.match(fresh.svg, />EXISTING</);
  assert.doesNotMatch(fresh.svg, />NEW</);
  assert.match(render(example('architecture-focus')).svg, />CHANGED</);
  const forced = render({ ...JSON.parse(readFileSync(join(root, 'test/fixtures/new-area.json'), 'utf8')), emphasis: 'changes' });
  assert.match(forced.svg, />NEW</);
});

test('before/after works out what was added and removed', () => {
  const svg = render(example('before-after')).svg;
  assert.match(svg, />NEW</);        // withRetry exists only after
  assert.match(svg, /e-removed/);    // the direct calls exist only before
  assert.match(svg, />CHANGED</);    // a card whose subtitle differs
});

test('the CLI renders a file and fails on a broken one', () => {
  const out = mkdtempSync(join(tmpdir(), 'pr-diagram-'));
  const bin = join(root, 'bin/pr-diagram.mjs');
  const ok = spawnSync(process.execPath, [bin, 'render', join(root, 'examples/sequence.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(existsSync(join(out, 'sequence.svg')));
  const bad = spawnSync(process.execPath, [bin, 'validate', join(root, 'package.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /type: must be one of/);
  assert.match(spawnSync(process.execPath, [bin, 'fields', 'timeline'], { encoding: 'utf8' }).stdout, /scenarios: list of objects \(required/);
});
