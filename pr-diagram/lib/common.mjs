import { str, enm, req, id } from './shape.mjs';
import { DELTAS } from './theme.mjs';

// Fields every diagram document shares.
export const base = (type) => ({
  type: req(enm([type])),
  title: req(str({ max: 70 })),
  caption: str({ max: 260 }),
  emphasis: enm(['auto', 'changes', 'new'])
});
export const delta = () => enm(DELTAS);
export const edgeFields = () => ({ from: req(str({ max: 100 })), to: req(str({ max: 100 })), label: str({ max: 30 }), delta: delta() });

// An added edge is animated. When the whole area is new, only edges that plug into existing code are.
export function edgeTone(scene, e, deltaOf) {
  const d = e.delta || 'unchanged';
  if (d === 'added' && scene.mode === 'new') {
    const touchesExisting = [e.from, e.to].some((end) => (deltaOf(end) || 'unchanged') === 'unchanged');
    return touchesExisting ? { tone: 'added', flow: true } : { tone: 'neutral' };
  }
  if (d === 'added') return { tone: 'added', flow: true };
  return { tone: d === 'unchanged' ? 'neutral' : d };
}
// Most types cannot draw an edge from a thing to itself, and none can draw the same edge twice.
export function checkEdges(edges, path, issues, { self = false, same = (e) => e.from === e.to } = {}) {
  const seen = new Set();
  (edges || []).forEach((e, i) => {
    if (!self && same(e)) issues.push({ level: 'error', message: `${path}[${i}]: an edge from "${e.from}" back to itself cannot be drawn in this diagram type; say it in a label or the caption instead` });
    const k = `${e.from}>${e.to}`; if (seen.has(k)) issues.push({ level: 'error', message: `${path}[${i}]: the edge ${e.from} → ${e.to} is listed twice; merge them into one` }); seen.add(k);
  });
}
// Register an edge endpoint such as "node.part"; two things answering to one name is an error.
export function addEnd(map, key, value, path, issues) {
  if (map.has(key)) issues.push({ level: 'error', message: `${path}: "${key}" names two different things; rename one of them` });
  else map.set(key, value);
}
export const CIRCLED = (n) => String.fromCodePoint(0x245f + n);
