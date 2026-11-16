import { obj, arr, str, num, enm, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, edgeFields } from '../common.mjs';
import { Scene, drawZone, cardSize } from '../scene.mjs';
import { routeEdges } from '../route.mjs';
import { gridPositions, checkGridFields } from '../grid.mjs';
import { drawGraph } from '../graph.mjs';

export const name = 'before-after';
export const label = 'Before / After';
export const when = 'A refactor, consolidation or moved boundary';
export const question = 'What did the structure look like, and what does it look like now?';

const side = () => req(obj({
  nodes: req(arr(obj({ id: req(id()), label: req(str({ max: 36 })), sub: str({ max: 36 }), delta: enm(['changed']), col: num({ min: 0, max: 6 }), row: num({ min: 0, max: 7 }) }), { min: 1, max: 14 })),
  edges: arr(obj({ from: edgeFields().from, to: edgeFields().to, label: str({ max: 30 }) }), { max: 24 })
}));
export const spec = obj({ ...base(name), direction: enm(['right', 'down']), beforeLabel: str({ max: 40 }), afterLabel: str({ max: 40 }), before: side(), after: side() });

// One shared grid: a card that exists on both sides sits in the same place on both.
function union(doc) {
  const nodes = new Map();
  for (const n of [...doc.after.nodes, ...doc.before.nodes]) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const posOf = (nid) => [...doc.after.nodes, ...doc.before.nodes].find((n) => n.id === nid && n.col !== undefined);
  const list = [...nodes.values()].map((n) => { const p = posOf(n.id); return p ? { ...n, col: p.col, row: p.row } : { ...n, col: undefined, row: undefined }; });
  const seen = new Set(), edges = [];
  for (const e of [...(doc.after.edges || []), ...(doc.before.edges || [])]) { const k = `${e.from}>${e.to}`; if (!seen.has(k)) { seen.add(k); edges.push(e); } }
  return { nodes: list, edges };
}

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  for (const key of ['before', 'after']) {
    const nodes = indexById(doc[key].nodes, `${key}.nodes`, issues);
    (doc[key].edges || []).forEach((e, i) => { checkRef(e.from, nodes, `${key}.edges[${i}].from`, issues, `node in ${key}`); checkRef(e.to, nodes, `${key}.edges[${i}].to`, issues, `node in ${key}`); });
  }
  checkGridFields(union(doc).nodes, 'nodes (before and after together)', issues);
}

export function render(doc) {
  const scene = new Scene(doc, label);
  const u = union(doc), dir = doc.direction || 'right';
  const grid = gridPositions(u.nodes, u.edges, dir);
  const has = (key, nid) => doc[key].nodes.some((n) => n.id === nid);
  const hasEdge = (key, e) => (doc[key].edges || []).some((x) => x.from === e.from && x.to === e.to);
  const subOf = (key, nid) => doc[key].nodes.find((n) => n.id === nid)?.sub;
  let ox = 0, oy = 0;
  for (const key of ['before', 'after']) {
    const other = key === 'before' ? 'after' : 'before', prefix = key[0] + ':';
    const top = scene.items.length;
    const g = drawGraph(scene, doc[key].nodes, doc[key].edges || [], {
      grid, dir, prefix, ox: ox + 20, oy: oy + 42, sizeNodes: [...doc.before.nodes, ...doc.after.nodes], sizeEdges: u.edges, size: cardSize,
      delta: (n) => !has(other, n.id) ? (key === 'before' ? 'removed' : 'added') : key === 'after' && (n.delta === 'changed' || subOf('before', n.id) !== n.sub) ? 'changed' : 'unchanged'
    });
    const W = g.w + 40, H = g.h + 62;
    // The panel goes behind the cards drawn above.
    const cards = scene.items.splice(top);
    drawZone(scene, { x: ox, y: oy, w: W, h: H, label: doc[key + 'Label'] || (key === 'before' ? 'Before' : 'After') });
    scene.items.push(...cards);
    routeEdges(scene, (doc[key].edges || []).map((e) => {
      const gone = !hasEdge(other, e);
      return { from: prefix + e.from, to: prefix + e.to, label: e.label, tone: gone ? (key === 'before' ? 'removed' : 'added') : 'neutral', flow: gone && key === 'after' };
    }), { prefer: dir === 'right' ? 'h' : 'v' });
    if (key === 'before') { if (W * 2 + 30 <= 1150) ox = W + 30; else oy = H + 26; }
  }
  return scene;
}
