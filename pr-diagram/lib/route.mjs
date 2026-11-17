// Edge routing: every edge is one cubic curve between two card sides, chosen so it does not run behind a card.
import { C, textWidth, esc, r1 } from './theme.mjs';
import { stepBadge } from './scene.mjs';

const SIDES = { L: [-1, 0], R: [1, 0], T: [0, -1], B: [0, 1] };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function port(box, side, frac = 0.5) {
  const span = box.shape === 'diamond' ? 0 : box.shape === 'pill' && (side === 'L' || side === 'R') ? 0.42 : 0.56;
  const f = 0.5 + (frac - 0.5) * span;
  if (side === 'L') return { x: box.x, y: box.y + box.h * f };
  if (side === 'R') return { x: box.x + box.w, y: box.y + box.h * f };
  if (side === 'T') return { x: box.x + box.w * f, y: box.y };
  return { x: box.x + box.w * f, y: box.y + box.h };
}
// bow: sideways push of the middle of the curve, so two edges running opposite ways between one pair do not overlap.
function curve(p0, sa, p3, sb, bow = 0) {
  const d = Math.hypot(p3.x - p0.x, p3.y - p0.y) || 1, k = clamp(d * 0.42, 22, 130);
  const [ax, ay] = SIDES[sa], [bx, by] = SIDES[sb];
  const nx = (-(p3.y - p0.y) / d) * bow, ny = ((p3.x - p0.x) / d) * bow;
  return [p0, { x: p0.x + ax * k + nx, y: p0.y + ay * k + ny }, { x: p3.x + bx * k + nx, y: p3.y + by * k + ny }, p3];
}
export function at(c, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}
const samples = (c, n = 48) => Array.from({ length: n + 1 }, (_, i) => at(c, i / n));
const inside = (p, b, pad) => p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad;
function crossed(pts, obstacles) {
  const inner = pts.slice(3, -3);
  return obstacles.filter((b) => inner.some((p) => inside(p, b, 4)));
}
const length = (pts) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
const isAncestor = (maybe, box, boxes) => { for (let p = box.parent; p; p = boxes.get(p)?.parent) if (p === maybe.id) return true; return false; };
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// edges: [{ from, to, label?, step?, tone? ('neutral'|'added'|'changed'|'removed'), flow?, fromSides?, toSides? ('LR' limits the ports) }]
// opts.prefer: 'h' or 'v' nudges ties toward left/right or top/bottom ports.
export function routeEdges(scene, edges, opts = {}) {
  const boxes = scene.boxes, routed = [];
  for (const e of edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    if (!a || !b) continue;
    if (a === b) { routed.push({ e, a, b, self: true, obstacles: [...boxes.values()].filter((o) => o.obstacle && o !== a && !isAncestor(o, a, boxes)) }); continue; }
    if (a.parent && a.parent === b.parent && !a.obstacle && !b.obstacle) { routed.push({ e, a, b, loop: true, obstacles: [...boxes.values()].filter((o) => o.obstacle && o.id !== a.parent), bow: 0 }); continue; }
    const obstacles = [...boxes.values()].filter((o) => o.obstacle && o !== a && o !== b && !isAncestor(o, a, boxes) && !isAncestor(o, b, boxes));
    let best = null;
    for (const sa of e.fromSides || 'LRTB') for (const sb of e.toSides || 'LRTB') {
      const p0 = port(a, sa), p3 = port(b, sb), c = curve(p0, sa, p3, sb), pts = samples(c);
      const [ax, ay] = SIDES[sa], [bx, by] = SIDES[sb];
      let cost = length(pts) + 10000 * crossed(pts, obstacles).length;
      // Leaving a card away from its target, or arriving from behind, reads badly.
      const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      if (ax * (cb.x - ca.x) + ay * (cb.y - ca.y) <= 0) cost += 240;
      if (bx * (ca.x - cb.x) + by * (ca.y - cb.y) <= 0) cost += 240;
      // Entering its own endpoints' bodies (a curve doubling back through the card it left).
      if (pts.slice(4, -4).some((p) => inside(p, a, -2) || inside(p, b, -2))) cost += 5000;
      if (pts.some((p) => p.x < -8 || p.y < -8)) cost += 3000;
      const horizontal = (sa === 'L' || sa === 'R') && (sb === 'L' || sb === 'R'), vertical = (sa === 'T' || sa === 'B') && (sb === 'T' || sb === 'B');
      if (opts.prefer === 'h' && !horizontal) cost += 18;
      if (opts.prefer === 'v' && !vertical) cost += 18;
      if (!best || cost < best.cost) best = { cost, sa, sb };
    }
    const twin = edges.some((o) => o.from === e.to && o.to === e.from);
    // The return edge of a pair mirrors its partner's sides, so the two form a lens instead of crossing.
    const partner = routed.find((r) => !r.self && !r.loop && r.e.from === e.to && r.e.to === e.from);
    if (partner) best = { sa: partner.sb, sb: partner.sa };
    routed.push({ e, a, b, obstacles, bow: twin ? 26 : 0, ...best });
  }
  // Spread several edges on one side so they do not share a point.
  const slots = new Map();
  const slot = (box, side, other, r, end) => { const k = `${box.id}:${side}`; if (!slots.has(k)) slots.set(k, []); slots.get(k).push({ other, r, end, pair: r.bow ? [r.a.id, r.b.id].sort().join('|') : null }); };
  for (const r of routed) if (!r.self && !r.loop) {
    const axis = (side) => (side === 'L' || side === 'R' ? 'y' : 'x');
    const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    slot(r.a, r.sa, mid(r.b)[axis(r.sa)], r, 'fa'); slot(r.b, r.sb, mid(r.a)[axis(r.sb)], r, 'fb');
  }
  // A pair of opposite edges shares one point and bows apart; giving each its own point would make them cross.
  for (const list of slots.values()) {
    list.sort((p, q) => p.other - q.other);
    const groups = []; for (const s of list) { const g = s.pair && groups.find((x) => x.pair === s.pair); if (g) g.items.push(s); else groups.push({ pair: s.pair, items: [s] }); }
    groups.forEach((g, i) => g.items.forEach((s) => { s.r[s.end] = (i + 1) / (groups.length + 1); }));
  }

  for (const r of routed) {
    const { e, a, b } = r, tone = e.tone || 'neutral';
    let d;
    if (r.self) {
      const x1 = a.x + a.w * 0.32, x2 = a.x + a.w * 0.68, y = a.y;
      r.c = [{ x: x1, y }, { x: x1 - 14, y: y - 44 }, { x: x2 + 14, y: y - 44 }, { x: x2, y }];
      for (const hit of crossed(samples(r.c), r.obstacles)) scene.error(`the loop on "${a.name || a.id}" runs behind "${hit.name || hit.id}"; leave a full row of space above it (col/row)`);
    } else if (r.loop) {
      // Two rows of one table: out of the right edge and back in.
      const p0 = port(a, 'R'), p3 = port(b, 'R'), k = 56;
      r.c = [p0, { x: p0.x + k, y: p0.y }, { x: p3.x + k, y: p3.y }, p3];
      for (const hit of crossed(samples(r.c), r.obstacles)) scene.error(`the loop ${e.from} → ${e.to} runs behind "${hit.name || hit.id}"; leave more space to the right of the table (col/row)`);
    } else {
      r.c = curve(port(a, r.sa, r.fa), r.sa, port(b, r.sb, r.fb), r.sb, r.bow);
      if (samples(r.c).some((p) => p.x < -8 || p.y < -8)) scene.error(`the edge ${e.from} → ${e.to} has to leave the frame to get around another card; move a card (col/row) or reorder them so the path is clear`);
      // The only clear way round a neighbour can be a curve that doubles back through the card it is going to (or left).
      const body = samples(r.c).slice(4, -4);
      for (const end of [a, b]) if (body.some((p) => inside(p, end, -2))) scene.error(`the edge ${e.from} → ${e.to} has to cut through "${end.name || end.id}" to reach it; move a card (col/row) so the path is clear`);
      for (const hit of crossed(samples(r.c), r.obstacles)) scene.error(`the edge ${e.from} → ${e.to} runs behind "${hit.name || hit.id}"; move a card (col/row) or change the layout so the path is clear`);
    }
    const c = r.c;
    d = `M${r1(c[0].x)} ${r1(c[0].y)}C${r1(c[1].x)} ${r1(c[1].y)} ${r1(c[2].x)} ${r1(c[2].y)} ${r1(c[3].x)} ${r1(c[3].y)}`;
    scene.add(`<path class="e${tone !== 'neutral' ? ' e-' + tone : ''}${e.flow ? ' flow' : ''}" d="${d}" marker-end="url(#m-${tone})"/>`);
    if (tone !== 'neutral') scene.used.add(tone);
    for (const p of samples(c, 8)) scene.grow(p.x + 4, p.y + 4);
  }
  // Labels last, so each can avoid every card and every label already placed.
  const blockers = () => [...[...boxes.values()].filter((o) => o.obstacle), ...scene.labels];
  for (const r of routed) {
    const { e } = r; if (e.label === undefined && e.step === undefined) continue;
    const isStep = e.step !== undefined, tone = e.tone || 'neutral';
    const text = isStep ? String(e.step) : e.label, w = isStep ? 22 : textWidth(text, 10, true) + 16, h = isStep ? 22 : 18;
    let placed = null;
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
      const p = at(r.c, t), rect = { x: p.x - w / 2, y: p.y - h / 2, w, h };
      if (rect.x < -PADL || rect.y < -4) continue;
      if (!blockers().some((o) => overlap(rect, o))) { placed = { p, rect }; break; }
    }
    if (!placed) {
      scene.error(`no free space for the ${isStep ? 'step number' : 'label "' + text + '"'} on the edge ${e.from} → ${e.to}; ${isStep ? 'spread the cards out' : 'shorten it, use a numbered step, or spread the cards out'}`);
      const p = at(r.c, 0.5); placed = { p, rect: { x: p.x - w / 2, y: p.y - h / 2, w, h } };
    }
    scene.labels.push(placed.rect);
    const { p, rect } = placed, color = tone === 'neutral' ? '#aeb6c4' : C[tone + 'Text'];
    if (isStep) scene.top(stepBadge(p.x, p.y, text, tone === 'neutral' ? '#aeb6c4' : C[tone]));
    else scene.top(`<rect x="${r1(rect.x)}" y="${r1(rect.y)}" width="${r1(w)}" height="${h}" rx="9" fill="${C.panel}" stroke="#333a46"/><text class="l" x="${r1(p.x)}" y="${r1(p.y + 3.5)}" text-anchor="middle" style="fill:${color}">${esc(text)}</text>`);
    scene.grow(rect.x + w, rect.y + h);
  }
  return routed;
}
const PADL = 14;
