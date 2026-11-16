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
  assert.match(svg, /class="e e-removed/); // the direct calls exist only before
  assert.match(svg, />CHANGED</);    // a card whose subtitle differs
});

test('edges a type cannot draw are refused with a reason', () => {
  const loop = example('pipeline'); loop.edges.push({ from: 'ota', to: 'ota' });
  assert.match(errors(validate(loop)).join('\n'), /back to itself/);
  const own = example('architecture-focus'); own.edges.push({ from: 'quick-add', to: 'quick-add.add' });
  assert.match(errors(validate(own)).join('\n'), /back to itself/);
  const twice = example('decision-flow'); twice.edges.push({ ...twice.edges[0] });
  assert.match(errors(validate(twice)).join('\n'), /listed twice/);
  const ok = example('state-machine'); ok.transitions.push({ from: 'running', to: 'running', label: 'heartbeat' });
  assert.deepEqual(errors(render(ok).issues), []);
});

test('a table can point at itself, field to field', () => {
  const doc = example('data-model');
  doc.entities[0].fields.push({ name: 'parent_id', type: 'uuid fk', delta: 'added' });
  doc.relations.push({ from: 'sessions.parent_id', to: 'sessions.id', label: 'parent', delta: 'added' });
  assert.deepEqual(errors(render(doc).issues), []);
});

test('ids with dots still resolve to their owner', () => {
  const doc = { type: 'data-model', title: 't', entities: ['app.users', 'app.orgs', 'app.teams'].map((id) => ({ id, name: id, fields: [{ name: 'id' }, { name: 'ref' }] })), relations: [{ from: 'app.users.ref', to: 'app.orgs.id' }, { from: 'app.orgs.ref', to: 'app.teams.id' }] };
  const out = render(doc);
  assert.deepEqual(errors(out.issues), []);
  assert.ok(out.width > out.height, 'a chain of three tables lays out left to right');
});

test('overlapping cards and a name with two meanings are errors', () => {
  const close = { type: 'decision-flow', title: 't', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 0.5, row: 0 }], edges: [{ from: 'a', to: 'b' }] };
  assert.match(errors(render(close).issues).join('\n'), /overlap/);
  const two = { type: 'architecture', title: 't', nodes: [{ id: 'a', label: 'A', parts: [{ id: 'b', label: 'B' }] }, { id: 'a.b', label: 'Dotted' }], edges: [] };
  assert.match(errors(validate(two)).join('\n'), /names two different things/);
  assert.match(errors(validate({ ...example('sequence'), title: 'bell\u0007' })).join('\n'), /control character/);
});

test('small measured values keep their digits', () => {
  const doc = { ...example('measure'), unit: 's', bars: [{ label: 'Before', segments: [{ label: 'a', value: 0.004 }] }, { label: 'After', segments: [{ label: 'a', value: 0.003 }] }] };
  const out = render(doc);
  assert.deepEqual(errors(out.issues), []);
  assert.match(out.svg, /0\.004 s/);
});

test('a removed decision keeps its removed branches', () => {
  const doc = { type: 'decision-flow', title: 't', nodes: [{ id: 's', kind: 'start', label: 'Start' }, { id: 'd', kind: 'decision', label: 'Old check?', delta: 'removed' }, { id: 'a', label: 'A', delta: 'removed' }, { id: 'b', label: 'B' }],
    edges: [{ from: 's', to: 'd', delta: 'removed' }, { from: 'd', to: 'a', label: 'yes', delta: 'removed' }, { from: 'd', to: 'b', label: 'no', delta: 'removed' }, { from: 's', to: 'b', delta: 'added' }] };
  assert.deepEqual(errors(render(doc).issues), []);
  doc.nodes[1].delta = 'changed';
  assert.match(errors(validate(doc)).join('\n'), /two outgoing edges that still exist/);
});

test('a node cannot name a zone that is not declared', () => {
  const doc = { type: 'architecture', title: 't', nodes: [{ id: 'a', label: 'A', zone: 'core' }, { id: 'b', label: 'B', zone: 'core' }], edges: [{ from: 'a', to: 'b' }] };
  assert.match(errors(validate(doc)).join('\n'), /"core" is not declared/);
});

test('a new-area sequence still highlights calls into existing participants', () => {
  const doc = { type: 'sequence', title: 't', participants: [{ id: 'old', label: 'Existing API' }, { id: 'a', label: 'A', delta: 'added' }, { id: 'b', label: 'B', delta: 'added' }, { id: 'c', label: 'C', delta: 'added' }],
    messages: [{ from: 'a', to: 'b', label: 'inside', delta: 'added' }, { from: 'b', to: 'old', label: 'into old', delta: 'added' }] };
  const svg = render(doc).svg;
  assert.equal((svg.match(/class="e e-added flow"/g) || []).length, 1);
  assert.match(svg, />EXISTING</);
});

test('a self-loop that would run behind another card is an error', () => {
  const doc = { type: 'state-machine', title: 't', states: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 0, row: 0.5 }], transitions: [{ from: 'a', to: 'b' }, { from: 'b', to: 'b' }] };
  assert.match(errors(render(doc).issues).join('\n'), /loop on "B" runs behind "A"/);
});

test('a loop between two fields may not run behind the next table', () => {
  const entity = (id, col) => ({ id, name: id, col, row: 0, fields: [{ name: 'id' }, { name: 'parent_id' }] });
  const doc = { type: 'data-model', title: 't', entities: [entity('a', 0), entity('b', 0.75)], relations: [{ from: 'a.parent_id', to: 'a.id' }] };
  assert.match(errors(render(doc).issues).join('\n'), /runs behind "b"/);
});

test('the legend always fits inside a narrow diagram', () => {
  const doc = { type: 'decision-flow', title: 't', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', delta: 'added' }, { id: 'c', label: 'C', delta: 'added' }, { id: 'd', label: 'D', delta: 'added' }],
    edges: [{ from: 'a', to: 'b', delta: 'added' }, { from: 'b', to: 'c', delta: 'changed' }, { from: 'c', to: 'd', delta: 'added' }] };
  const out = render(doc);
  assert.deepEqual(errors(out.issues), []);
  const xs = [...out.svg.matchAll(/<text class="s" x="([\d.]+)" y="[\d.]+">(connects to existing code|changed|everything[^<]*)</g)].map((m) => Number(m[1]) + m[2].length * 6.5);
  assert.equal(xs.length, 3);
  assert.ok(Math.max(...xs) <= out.width, `legend ends at ${Math.max(...xs)} in a ${out.width}px diagram`);
});

test('an edge may not double back through the card it ends on', () => {
  const at = (id, col, row) => ({ id, label: id.toUpperCase(), col, row });
  const doc = { type: 'architecture', title: 't', nodes: [at('a', 0.5, 0), at('b', 2, 1.5), at('c', 1, 1), at('d', 2, 1)], edges: [{ from: 'a', to: 'b' }] };
  assert.match(errors(render(doc).issues).join('\n'), /has to cut through "B"/);
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
