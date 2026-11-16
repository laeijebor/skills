import { obj, arr, str, int, num, enm, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, delta, edgeFields, edgeTone, CIRCLED } from '../common.mjs';
import { Scene, pickMode, drawNode, drawZone, cardSize, caption, wrap, capWidth } from '../scene.mjs';
import { routeEdges, at } from '../route.mjs';
import { gridPositions, checkGridFields } from '../grid.mjs';
import { textWidth, esc, C } from '../theme.mjs';

export const name = 'architecture';
export const label = 'Architecture';
export const when = 'A feature or change that spans several components';
export const question = 'Which parts talk to each other differently?';

const AT = { 'top-left': [0, 0], top: [1, 0], 'top-right': [2, 0], left: [0, 1], center: [1, 1], right: [2, 1], 'bottom-left': [0, 2], bottom: [1, 2], 'bottom-right': [2, 2] };
const ROLE_ZONES = { caller: ['top', 'Who calls it'], focus: ['center', ''], callee: ['bottom', 'What it uses'], sibling: ['right', 'Alongside'] };
const part = obj({ id: req(id()), label: req(str({ max: 22 })), sub: str({ max: 20 }), delta: delta() });
export const spec = obj({
  ...base(name),
  layout: enm(['zones', 'focus']),
  zones: arr(obj({ id: req(id()), label: req(str({ max: 44 })), at: req(enm(Object.keys(AT))) }), { max: 9 }),
  nodes: req(arr(obj({ id: req(id()), label: req(str({ max: 36 })), sub: str({ max: 36 }), delta: delta(), zone: id(), role: enm(Object.keys(ROLE_ZONES)), col: num({ min: 0, max: 7 }), row: num({ min: 0, max: 7 }), parts: arr(part, { min: 1, max: 5 }) }), { min: 2, max: 24 })),
  edges: arr(obj({ ...edgeFields(), label: str({ max: 64 }), step: int({ min: 1, max: 12 }) }), { max: 40 })
});

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const nodes = indexById(doc.nodes, 'nodes', issues), zones = indexById(doc.zones, 'zones', issues);
  const ends = new Map(nodes);
  doc.nodes.forEach((n, i) => (n.parts || []).forEach((p) => ends.set(`${n.id}.${p.id}`, p)) || indexById(n.parts, `nodes[${i}].parts`, issues));
  const focus = doc.layout === 'focus';
  if (focus) {
    if (doc.zones) issues.push({ level: 'error', message: 'zones: the focus layout places cards by role; remove zones' });
    if (doc.nodes.filter((n) => n.role === 'focus').length !== 1) issues.push({ level: 'error', message: 'nodes: the focus layout needs exactly one node with role "focus"' });
    doc.nodes.forEach((n, i) => { if (!n.role) issues.push({ level: 'error', message: `nodes[${i}].role: is required in the focus layout (focus, caller, callee or sibling)` }); });
  } else {
    const seen = new Set();
    (doc.zones || []).forEach((z, i) => { if (seen.has(z.at)) issues.push({ level: 'error', message: `zones[${i}].at: two zones are placed at "${z.at}"` }); seen.add(z.at); });
    doc.nodes.forEach((n, i) => {
      if (n.role) issues.push({ level: 'error', message: `nodes[${i}].role: only the focus layout uses roles` });
      if (doc.zones?.length) { if (!n.zone) issues.push({ level: 'error', message: `nodes[${i}].zone: is required when zones are declared` }); else checkRef(n.zone, zones, `nodes[${i}].zone`, issues, 'zone'); }
    });
    for (const z of doc.zones || []) checkGridFields(doc.nodes.filter((n) => n.zone === z.id), `nodes in zone "${z.id}"`, issues);
    if (!doc.zones?.length) checkGridFields(doc.nodes, 'nodes', issues);
  }
  const steps = new Map();
  (doc.edges || []).forEach((e, i) => {
    checkRef(e.from, ends, `edges[${i}].from`, issues, 'node (or node.part)'); checkRef(e.to, ends, `edges[${i}].to`, issues, 'node (or node.part)');
    if (e.step === undefined && e.label && e.label.length > 30) issues.push({ level: 'error', message: `edges[${i}].label: is ${e.label.length} characters; a label drawn on an edge fits 30. Shorten it, or give the edge a step number so the text moves to the legend` });
    if (e.step !== undefined && !steps.has(e.step)) { steps.set(e.step, e.label); if (!e.label) issues.push({ level: 'error', message: `edges[${i}].label: the first edge of step ${e.step} needs a label; it becomes the legend text` }); }
  });
}

export function render(doc) {
  const scene = new Scene(doc, doc.layout === 'focus' ? 'Architecture · focus' : 'Architecture');
  scene.mode = pickMode(doc, doc.nodes.map((n) => n.delta || 'unchanged'));
  const edges = doc.edges || [];
  const zoneOf = (n) => (doc.layout === 'focus' ? n.role : n.zone || '_');
  const zoneDefs = doc.layout === 'focus'
    ? Object.entries(ROLE_ZONES).map(([role, [at, text]]) => ({ id: role, at, label: text, frame: false }))
    : doc.zones?.length ? doc.zones.map((z) => ({ ...z, frame: true })) : [{ id: '_', at: 'center', label: '', frame: false }];
  const owner = new Map(); // endpoint id -> node id
  for (const n of doc.nodes) { owner.set(n.id, n.id); for (const p of n.parts || []) owner.set(`${n.id}.${p.id}`, n.id); }
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));

  // 1. Size each zone from its own grid of cards.
  const zones = [];
  for (const z of zoneDefs) {
    const nodes = doc.nodes.filter((n) => zoneOf(n) === z.id);
    if (!nodes.length) continue;
    const inner = edges.filter((e) => zoneOf(nodeById.get(owner.get(e.from))) === z.id && zoneOf(nodeById.get(owner.get(e.to))) === z.id).map((e) => ({ ...e, from: owner.get(e.from), to: owner.get(e.to) }));
    const dir = z.at === 'left' || z.at === 'right' ? 'right' : 'down';
    const grid = gridPositions(nodes, inner, dir);
    const sizes = new Map(nodes.map((n) => [n.id, nodeSize(n)]));
    const cellW = Math.max(...[...sizes.values()].map((s) => s.w)), cellH = Math.max(...[...sizes.values()].map((s) => s.h));
    const longest = Math.max(0, ...inner.filter((e) => e.label && e.step === undefined).map((e) => textWidth(e.label, 10, true)));
    const gapX = Math.min(190, Math.max(64, longest + 40)), gapY = 56;
    const below = !z.frame && z.at.startsWith('bottom'); // a frameless bottom row is captioned underneath, clear of incoming edges
    const padTop = z.label && !below ? 38 : z.frame ? 18 : 0, pad = z.frame ? 18 : 0, padBottom = pad + (below && z.label ? 26 : 0);
    const iw = (grid.cols - 1) * (cellW + gapX) + cellW, ih = (grid.rows - 1) * (cellH + gapY) + cellH;
    zones.push({ ...z, nodes, grid, sizes, cellW, cellH, gapX, gapY, pad, padTop, iw, ih, below, w: Math.max(iw + pad * 2, z.label ? capWidth(z.label) * (z.frame && grid.cols === 1 ? 2 : 1) + (z.frame && grid.cols === 1 ? 48 : 28) : 0), h: ih + padTop + padBottom, c0: AT[z.at][0], c1: AT[z.at][0], r: AT[z.at][1] });
  }
  // 2. Let a zone stretch sideways into empty cells of its row, so a bottom band can run the full width.
  const taken = new Set(zones.map((z) => `${z.c0},${z.r}`));
  for (const z of zones) {
    while (z.c0 > 0 && !taken.has(`${z.c0 - 1},${z.r}`)) { z.c0--; taken.add(`${z.c0},${z.r}`); }
    while (z.c1 < 2 && !taken.has(`${z.c1 + 1},${z.r}`)) { z.c1++; taken.add(`${z.c1},${z.r}`); }
  }
  // 3. Column and row tracks.
  const zoneOfEnd = (end) => zoneOf(nodeById.get(owner.get(end)));
  const crossing = edges.filter((e) => e.label && e.step === undefined && zoneOfEnd(e.from) !== zoneOfEnd(e.to)).map((e) => textWidth(e.label, 10, true));
  const GAP = Math.min(150, Math.max(40, ...crossing.map((w) => w + 48))), colW = [0, 0, 0], rowH = [0, 0, 0];
  const base0 = (z) => AT[z.at][0];
  for (const z of zones) { colW[base0(z)] = Math.max(colW[base0(z)], z.w); rowH[z.r] = Math.max(rowH[z.r], z.h); }
  const x = [0, 0, 0], y = [0, 0, 0];
  const lay = (sizes, pos, gap) => { let at = 0; sizes.forEach((s, i) => { pos[i] = at; if (s > 0) at += s + gap; }); };
  lay(colW, x, GAP); lay(rowH, y, 60);
  const total = Math.max(...colW.map((w, i) => (w ? x[i] + w : 0)));
  for (const z of zones) {
    const b = base0(z);
    // A stretched zone covers every column that holds something; otherwise it keeps its own column.
    const left = z.c0 < b ? 0 : x[b], right = z.c1 > b ? total : x[b] + colW[b];
    z.x = left; z.W = Math.max(z.w, right - left);
    z.y = z.r === 1 ? y[1] + (rowH[1] - z.h) / 2 : z.r === 2 ? y[2] + rowH[2] - z.h : y[0];
  }
  // 4. A single row of auto-placed cards slides under (or over) the cards it connects to, in that order.
  const centre = new Map();
  const place = (z) => { z.ox ??= z.x + (z.W - z.iw) / 2; for (const n of z.nodes) centre.set(n.id, z.ox + z.grid.cells.get(n.id).col * (z.cellW + z.gapX) + z.cellW / 2); };
  zones.forEach(place);
  for (const z of zones) {
    if (z.grid.explicit || z.grid.rows !== 1) continue;
    const pull = new Map(z.nodes.map((n) => {
      const xs = edges.flatMap((e) => { const a = owner.get(e.from), b = owner.get(e.to); return a === n.id && zoneOfEnd(e.to) !== z.id ? [centre.get(b)] : b === n.id && zoneOfEnd(e.from) !== z.id ? [centre.get(a)] : []; });
      return [n.id, xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null];
    }));
    const pulled = z.nodes.filter((n) => pull.get(n.id) !== null);
    if (!pulled.length) continue;
    const order = [...z.nodes].sort((a, b) => (pull.get(a.id) ?? Infinity) - (pull.get(b.id) ?? Infinity));
    order.forEach((n, i) => { z.grid.cells.get(n.id).col = i; });
    const target = pulled.reduce((sum, n) => sum + pull.get(n.id), 0) / pulled.length;
    const span = order.indexOf(pulled[pulled.length - 1]), mid = (order.indexOf(pulled[0]) + span) / 2;
    z.ox = Math.min(z.x + z.W - z.pad - z.iw, Math.max(z.x + z.pad, target - z.cellW / 2 - mid * (z.cellW + z.gapX)));
    place(z);
  }
  // 5. Draw.
  for (const z of zones) {
    drawZone(scene, { x: z.x, y: z.y, w: z.W, h: z.h, frame: z.frame });
    if (z.frame && z.label) scene.labels.push((z.capRect = { x: z.x + 11, y: z.y + 11, w: capWidth(z.label) + 6, h: 15 }));
    if (!z.frame && z.label) caption(scene, z.x + z.W / 2, z.below ? z.y + z.h - 4 : z.y + 12, z.label, 'middle');
    const ox = z.ox, oy = z.y + z.padTop;
    for (const n of z.nodes) {
      const cell = z.grid.cells.get(n.id), size = z.sizes.get(n.id);
      const w = n.parts ? size.w : z.cellW, nx = ox + cell.col * (z.cellW + z.gapX) + (z.cellW - w) / 2, ny = oy + cell.row * (z.cellH + z.gapY) + (z.cellH - size.h) / 2;
      drawNode(scene, { id: n.id, x: nx, y: ny, w, h: size.h, label: n.label, sub: n.sub, delta: n.delta, big: !!n.parts });
      if (n.parts) {
        // Name on the left, parts in a row on the right: edges reach the parts from above and below without crossing the name.
        const side = size.side, pw = (size.w - side - 14 - (n.parts.length - 1) * 10) / n.parts.length;
        n.parts.forEach((p, i) => drawNode(scene, { id: `${n.id}.${p.id}`, x: nx + side + i * (pw + 10), y: ny + 14, w: pw, h: size.h - 28, label: p.label, sub: p.sub, delta: p.delta, parent: n.id, shape: 'part' }));
      }
    }
  }
  const deltaOf = (end) => (nodeById.get(owner.get(end)) || {}).delta;
  const firstStep = new Map();
  const routed = routeEdges(scene, edges.map((e) => {
    if (e.step !== undefined && !firstStep.has(e.step)) firstStep.set(e.step, e.label);
    return { from: e.from, to: e.to, ...(e.step !== undefined ? { step: e.step } : { label: e.label }), ...edgeTone(scene, e, deltaOf) };
  }));
  // Zone names go top-left, or top-right when an edge runs through the left spot.
  for (const z of zones) {
    if (!z.capRect) continue;
    const hit = (rect) => routed.some((r) => Array.from({ length: 41 }, (_, i) => at(r.c, i / 40)).some((p) => p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h));
    const right = { ...z.capRect, x: z.x + z.W - 11 - z.capRect.w };
    const useRight = hit(z.capRect) && !hit(right);
    scene.add(`<text class="cap" x="${useRight ? z.x + z.W - 14 : z.x + 14}" y="${z.y + 22}"${useRight ? ' text-anchor="end"' : ''}>${esc(z.label.toUpperCase())}</text>`);
  }
  // 6. Legend for numbered steps.
  if (firstStep.size) {
    const text = [...firstStep.entries()].sort((a, b) => a[0] - b[0]).map(([n, t]) => `${CIRCLED(n)} ${t}`).join('  ·  ');
    let ty = scene.h + 30;
    for (const line of wrap(text, Math.max(scene.w, 480), 10.5)) { scene.add(`<text class="s" x="0" y="${ty}" style="fill:${C.body}">${esc(line)}</text>`); scene.grow(textWidth(line, 10.5, true), ty + 2); ty += 18; }
  }
  return scene;
}

function nodeSize(n) {
  if (!n.parts) return cardSize(n);
  const pw = Math.max(100, ...n.parts.map((p) => cardSize(p).w)), side = Math.max(textWidth(n.label, 15, false, true), n.sub ? textWidth(n.sub, 10.5, true) : 0, 70) + 34;
  return { w: side + n.parts.length * pw + (n.parts.length - 1) * 10 + 14, h: 86, side };
}
