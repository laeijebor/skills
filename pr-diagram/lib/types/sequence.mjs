import { obj, arr, str, enm, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, delta } from '../common.mjs';
import { Scene, pickMode, drawNode, cardSize, look } from '../scene.mjs';
import { textWidth, esc, C, r1 } from '../theme.mjs';

export const name = 'sequence';
export const label = 'Sequence';
export const when = 'A request, job or event path where order matters';
export const question = 'Who calls whom, in what order?';

export const spec = obj({
  ...base(name),
  participants: req(arr(obj({ id: req(id()), label: req(str({ max: 30 })), sub: str({ max: 30 }), delta: delta() }), { min: 2, max: 7 })),
  messages: req(arr(obj({ from: req(str()), to: req(str()), label: req(str({ max: 44 })), kind: enm(['call', 'return']), delta: delta() }), { min: 1, max: 24 }))
});

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const ps = indexById(doc.participants, 'participants', issues);
  doc.messages.forEach((m, i) => { checkRef(m.from, ps, `messages[${i}].from`, issues, 'participant'); checkRef(m.to, ps, `messages[${i}].to`, issues, 'participant'); });
}

export function render(doc) {
  const scene = new Scene(doc, label);
  scene.mode = pickMode(doc, doc.participants.map((p) => p.delta || 'unchanged'));
  const ps = doc.participants, index = new Map(ps.map((p, i) => [p.id, i])), sizes = ps.map(cardSize);
  const labelW = (m) => textWidth(m.label, 10, true) + 30;
  // Lifeline spacing: wide enough for the cards and for the labels between neighbours.
  const cx = [sizes[0].w / 2 + 22];
  for (let i = 1; i < ps.length; i++) {
    const between = doc.messages.filter((m) => Math.abs(index.get(m.from) - index.get(m.to)) === 1 && Math.min(index.get(m.from), index.get(m.to)) === i - 1).map(labelW);
    cx.push(cx[i - 1] + Math.max(150, (sizes[i - 1].w + sizes[i].w) / 2 + 28, ...between));
  }
  const cardH = Math.max(...sizes.map((s) => s.h));
  ps.forEach((p, i) => drawNode(scene, { id: p.id, x: cx[i] - sizes[i].w / 2, y: 0, w: sizes[i].w, h: cardH, label: p.label, sub: p.sub, delta: p.delta }));
  let y = cardH + 40; const lines = [];
  doc.messages.forEach((m, n) => {
    const a = cx[index.get(m.from)], b = cx[index.get(m.to)], d = m.delta || 'unchanged';
    const tone = d === 'unchanged' || (d === 'added' && scene.mode === 'new') ? 'neutral' : d;
    if (tone !== 'neutral') scene.used.add(tone);
    const cls = `e${tone !== 'neutral' ? ' e-' + tone : ''}${d === 'added' && tone === 'added' ? ' flow' : ''}`, color = tone === 'neutral' ? '#aeb6c4' : C[tone + 'Text'];
    const dash = m.kind === 'return' && tone === 'neutral' ? ' stroke-dasharray="4 4"' : '';
    const numX = Math.min(a, b) - 12;
    if (a === b) {
      lines.push(`<path class="${cls}" d="M${r1(a)} ${y}h30v20h-${30 - 3}" marker-end="url(#m-${tone})"/><text class="l" x="${r1(a + 38)}" y="${y + 14}" style="fill:${color}">${esc(m.label)}</text>`);
      lines.push(`<text class="s" x="${r1(a - 10)}" y="${y + 4}" text-anchor="end">${n + 1}</text>`);
      scene.grow(a + 38 + textWidth(m.label, 10, true), y + 24); y += 46;
    } else {
      const w = textWidth(m.label, 10, true) + 12, mid = (a + b) / 2, room = Math.abs(a - b) - 18;
      if (w > room) scene.error(`the message "${m.label}" is too long for the space between ${m.from} and ${m.to} (about ${Math.max(4, Math.floor(m.label.length * room / w))} characters fit)`);
      lines.push(`<path class="${cls}" d="M${r1(a)} ${y}H${r1(b + (b > a ? -2 : 2))}"${dash} marker-end="url(#m-${tone})"/>`);
      lines.push(`<rect x="${r1(mid - w / 2)}" y="${y - 19}" width="${r1(w)}" height="14" fill="${C.panel}"/><text class="l" x="${r1(mid)}" y="${y - 8}" text-anchor="middle" style="fill:${color}">${esc(m.label)}</text>`);
      lines.push(`<text class="s" x="${r1(a < b ? a - 8 : a + 8)}" y="${y + 3.5}" text-anchor="${a < b ? 'end' : 'start'}">${n + 1}</text>`);
      y += 40;
    }
  });
  const end = y - 12;
  ps.forEach((p, i) => { const lk = look(scene, p.delta); scene.add(`<path d="M${r1(cx[i])} ${cardH}V${end}" stroke="${lk.stroke || '#3b424e'}" stroke-dasharray="3 5"${lk.opacity ? ` opacity="${lk.opacity}"` : ''}/>`); });
  lines.forEach((l) => scene.add(l));
  scene.grow(cx[cx.length - 1] + sizes[sizes.length - 1].w / 2 + 22, end + 4);
  return scene;
}
