import { obj, arr, str, int, enm, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, delta, checkEdges } from '../common.mjs';
import { Scene, drawNode, drawZone } from '../scene.mjs';
import { routeEdges } from '../route.mjs';
import { textWidth, esc, C, r1 } from '../theme.mjs';

export const name = 'timeline';
export const label = 'Interleaving timeline';
export const when = 'A race, ordering, sync or locking fix';
export const question = 'What ordering broke it, and what prevents it now?';

export const spec = obj({
  ...base(name),
  lanes: req(arr(obj({ id: req(id()), label: req(str({ max: 18 })) }), { min: 2, max: 5 })),
  scenarios: req(arr(obj({
    label: req(str({ max: 44 })),
    events: req(arr(obj({ id: req(id()), lane: req(str()), at: req(int({ min: 0, max: 11 })), label: req(str({ max: 24 })), delta: delta() }), { min: 1, max: 16 })),
    links: arr(obj({ from: req(str()), to: req(str()), delta: delta() }), { max: 16 }),
    outcome: obj({ text: req(str({ max: 70 })), tone: req(enm(['good', 'bad'])) })
  }), { min: 1, max: 3 }))
});

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const lanes = indexById(doc.lanes, 'lanes', issues);
  doc.scenarios.forEach((sc, si) => {
    const events = indexById(sc.events, `scenarios[${si}].events`, issues), spots = new Set();
    sc.events.forEach((e, i) => {
      checkRef(e.lane, lanes, `scenarios[${si}].events[${i}].lane`, issues, 'lane');
      const k = `${e.lane}@${e.at}`; if (spots.has(k)) issues.push({ level: 'error', message: `scenarios[${si}].events[${i}]: two events sit in lane "${e.lane}" at ${e.at}; give each its own "at"` }); spots.add(k);
    });
    checkEdges(sc.links, `scenarios[${si}].links`, issues);
    (sc.links || []).forEach((l, i) => { checkRef(l.from, events, `scenarios[${si}].links[${i}].from`, issues, 'event'); checkRef(l.to, events, `scenarios[${si}].links[${i}].to`, issues, 'event'); });
  });
}

export function render(doc) {
  const scene = new Scene(doc, label);
  const all = doc.scenarios.flatMap((s) => s.events);
  const pillW = (e) => Math.ceil(textWidth(e.label, 13, false, true)) + 28;
  const tick = Math.max(118, ...all.map(pillW)) + 18, ticks = Math.max(...all.map((e) => e.at)) + 1;
  const laneW = Math.max(...doc.lanes.map((l) => textWidth(l.label, 10, true))) + 30, laneGap = 66;
  const W = laneW + ticks * tick + 16;
  let y = 0;
  doc.scenarios.forEach((sc, si) => {
    const H = 44 + doc.lanes.length * laneGap + (sc.outcome ? 22 : -8);
    drawZone(scene, { x: 0, y, w: W, h: H, label: sc.label });
    const laneY = new Map(doc.lanes.map((l, i) => [l.id, y + 62 + i * laneGap]));
    for (const l of doc.lanes) scene.add(`<text class="l" x="14" y="${laneY.get(l.id) + 4}">${esc(l.label)}</text><path d="M${r1(laneW)} ${laneY.get(l.id)}H${r1(W - 14)}" stroke="#333a46"/>`);
    for (const e of sc.events) { const w = pillW(e); drawNode(scene, { id: `${si}:${e.id}`, x: laneW + e.at * tick + (tick - w) / 2, y: laneY.get(e.lane) - 15, w, h: 30, label: e.label, delta: e.delta, shape: 'pill' }); }
    routeEdges(scene, (sc.links || []).map((l) => { const d = l.delta || 'unchanged'; return { from: `${si}:${l.from}`, to: `${si}:${l.to}`, tone: d === 'unchanged' ? 'neutral' : d, flow: d === 'added' }; }), { prefer: 'v' });
    if (sc.outcome) {
      const good = sc.outcome.tone === 'good';
      scene.add(`<text class="l" x="${r1(W - 16)}" y="${r1(y + H - 14)}" text-anchor="end" style="fill:${good ? C.addedText : C.removedText}">${good ? '✓' : '✕'} ${esc(sc.outcome.text)}</text>`);
    }
    y += H + 16;
  });
  scene.add(`<path class="e" d="M${r1(laneW)} ${y + 4}H${r1(W - 14)}" marker-end="url(#m-neutral)"/><text class="s" x="${r1((laneW + W) / 2)}" y="${y + 22}" text-anchor="middle">time</text>`);
  scene.grow(W, y + 26);
  return scene;
}
