import { obj, arr, str, num, bool, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, delta, edgeFields, edgeTone, checkEdges } from '../common.mjs';
import { Scene, pickMode } from '../scene.mjs';
import { routeEdges } from '../route.mjs';
import { checkGridFields } from '../grid.mjs';
import { drawGraph } from '../graph.mjs';
import { textWidth, C, r1 } from '../theme.mjs';

export const name = 'state-machine';
export const label = 'State machine';
export const when = 'Lifecycle, status, workflow or retry changes';
export const question = 'Which states and moves exist now?';

export const spec = obj({
  ...base(name),
  states: req(arr(obj({ id: req(id()), label: req(str({ max: 24 })), delta: delta(), initial: bool(), final: bool(), col: num({ min: 0, max: 9 }), row: num({ min: 0, max: 6 }) }), { min: 2, max: 14 })),
  transitions: req(arr(obj(edgeFields()), { min: 1, max: 30 }))
});

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const states = indexById(doc.states, 'states', issues);
  checkGridFields(doc.states, 'states', issues);
  checkEdges(doc.transitions, 'transitions', issues, { self: true });
  doc.transitions.forEach((t, i) => { checkRef(t.from, states, `transitions[${i}].from`, issues, 'state'); checkRef(t.to, states, `transitions[${i}].to`, issues, 'state'); });
}

export function render(doc) {
  const scene = new Scene(doc, label);
  scene.mode = pickMode(doc, doc.states.map((s) => s.delta || 'unchanged'));
  const loops = doc.transitions.some((t) => t.from === t.to), hasInitial = doc.states.some((s) => s.initial);
  drawGraph(scene, doc.states, doc.transitions, { dir: 'right', gapY: 74, minGapX: 90, ox: hasInitial ? 44 : 0, oy: loops ? 58 : 0, shape: () => 'pill', size: (s) => ({ w: Math.max(112, Math.ceil(textWidth(s.label, 13, false, true)) + 44), h: 44 }) });
  for (const s of doc.states) {
    const b = scene.boxes.get(s.id), cy = b.y + b.h / 2;
    if (s.initial) scene.add(`<circle cx="${r1(b.x - 36)}" cy="${r1(cy)}" r="6" fill="${C.sub}"/><path class="e" d="M${r1(b.x - 29)} ${r1(cy)}L${r1(b.x - 1)} ${r1(cy)}" marker-end="url(#m-neutral)"/>`);
    if (s.final) scene.add(`<rect x="${r1(b.x + 4)}" y="${r1(b.y + 4)}" width="${r1(b.w - 8)}" height="${r1(b.h - 8)}" rx="${r1(b.h / 2 - 4)}" fill="none" stroke="${C.cardStroke}"/>`);
  }
  const byId = new Map(doc.states.map((s) => [s.id, s]));
  routeEdges(scene, doc.transitions.map((t) => ({ from: t.from, to: t.to, label: t.label, ...edgeTone(scene, t, (end) => byId.get(end)?.delta) })), { prefer: 'h' });
  return scene;
}
