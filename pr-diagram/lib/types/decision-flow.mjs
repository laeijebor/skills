import { obj, arr, str, num, enm, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, delta, edgeFields, edgeTone, checkEdges } from '../common.mjs';
import { Scene, pickMode, cardSize } from '../scene.mjs';
import { routeEdges } from '../route.mjs';
import { checkGridFields } from '../grid.mjs';
import { drawGraph } from '../graph.mjs';
import { textWidth } from '../theme.mjs';

export const name = 'decision-flow';
export const label = 'Decision flow';
export const when = 'A bug fix or change in branching logic, guards or fallbacks';
export const question = 'Which case went wrong, and where does each case go now?';

const KINDS = ['start', 'decision', 'step', 'end'];
export const spec = obj({
  ...base(name),
  nodes: req(arr(obj({ id: req(id()), kind: enm(KINDS), label: req(str({ max: 30 })), sub: str({ max: 34 }), delta: delta(), col: num({ min: 0, max: 6 }), row: num({ min: 0, max: 9 }) }), { min: 2, max: 18 })),
  edges: req(arr(obj(edgeFields()), { min: 1, max: 30 }))
});

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const nodes = indexById(doc.nodes, 'nodes', issues);
  checkGridFields(doc.nodes, 'nodes', issues);
  checkEdges(doc.edges, 'edges', issues);
  doc.edges.forEach((e, i) => { checkRef(e.from, nodes, `edges[${i}].from`, issues, 'node'); checkRef(e.to, nodes, `edges[${i}].to`, issues, 'node'); });
  doc.nodes.forEach((n, i) => { if (n.kind === 'decision' && doc.edges.filter((e) => e.from === n.id && e.delta !== 'removed').length < 2) issues.push({ level: 'error', message: `nodes[${i}]: the decision "${n.label}" needs at least two outgoing edges that still exist (one per answer)` }); });
}

export function render(doc) {
  const scene = new Scene(doc, label);
  scene.mode = pickMode(doc, doc.nodes.map((n) => n.delta || 'unchanged'));
  const kind = (n) => n.kind || 'step';
  drawGraph(scene, doc.nodes, doc.edges, {
    dir: 'down', gapY: 54,
    shape: (n) => ({ decision: 'diamond', start: 'pill', end: 'pill', step: 'card' })[kind(n)],
    size: (n) => kind(n) === 'decision' ? { w: Math.max(176, Math.ceil(Math.max(textWidth(n.label, 13, false, true), n.sub ? textWidth(n.sub, 10.5, true) : 0) / 0.6) + 12), h: n.sub ? 84 : 68 }
      : kind(n) === 'step' ? cardSize(n) : { w: Math.max(120, Math.ceil(textWidth(n.label, 13, false, true)) + 44), h: 42 }
  });
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  routeEdges(scene, doc.edges.map((e) => ({ from: e.from, to: e.to, label: e.label, ...edgeTone(scene, e, (end) => byId.get(end)?.delta) })), { prefer: 'v' });
  return scene;
}
