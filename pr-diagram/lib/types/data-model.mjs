import { obj, arr, str, num, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, delta, edgeFields, edgeTone, checkEdges, addEnd } from '../common.mjs';
import { Scene, pickMode, look, fit, notePanel } from '../scene.mjs';
import { routeEdges } from '../route.mjs';
import { gridPositions, checkGridFields } from '../grid.mjs';
import { textWidth, esc, C, r1 } from '../theme.mjs';

export const name = 'data-model';
export const label = 'Data model diff';
export const when = 'A migration, or a change to types or API payloads';
export const question = 'Which fields and relations changed, and how is the data moved?';

export const spec = obj({
  ...base(name),
  entities: req(arr(obj({
    id: req(id()), name: req(str({ max: 30 })), delta: delta(), col: num({ min: 0, max: 5 }), row: num({ min: 0, max: 4 }),
    fields: req(arr(obj({ name: req(str({ max: 28 })), type: str({ max: 24 }), delta: delta() }), { min: 1, max: 14 }))
  }), { min: 1, max: 8 })),
  relations: arr(obj(edgeFields()), { max: 16 }),
  migration: arr(str({ max: 150 }), { max: 8 }),
  warning: str({ max: 180 })
});

const ROW = 26, HEAD = 34;
const ownersOf = (doc) => new Map(doc.entities.flatMap((e) => [[e.id, e.id], ...e.fields.map((f) => [`${e.id}.${f.name}`, e.id])]));
export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const ends = new Map(indexById(doc.entities, 'entities', issues));
  doc.entities.forEach((e, i) => e.fields.forEach((f) => addEnd(ends, `${e.id}.${f.name}`, f, `entities[${i}].fields`, issues)));
  const owners = ownersOf(doc);
  // A table may point at itself (a parent id), but only field to field: that is drawn as a loop beside the table.
  checkEdges(doc.relations, 'relations', issues, { same: (r) => r.from === r.to || (owners.get(r.from) === owners.get(r.to) && (owners.get(r.from) === r.from || owners.get(r.to) === r.to)) });
  checkGridFields(doc.entities, 'entities', issues);
  (doc.relations || []).forEach((r, i) => { checkRef(r.from, ends, `relations[${i}].from`, issues, 'entity (or entity.field)'); checkRef(r.to, ends, `relations[${i}].to`, issues, 'entity (or entity.field)'); });
}

export function render(doc) {
  const scene = new Scene(doc, label);
  scene.mode = pickMode(doc, doc.entities.map((e) => e.delta || 'unchanged'));
  const rels = doc.relations || [], owners = ownersOf(doc), owner = (end) => owners.get(end);
  const sizeOf = (e) => ({ w: Math.min(330, Math.max(210, textWidth(e.name, 13, false, true) + 100, ...e.fields.map((f) => textWidth(f.name, 10.5, true) + textWidth(f.type || '', 10.5, true) + 62))), h: HEAD + e.fields.length * ROW + 6 });
  const grid = gridPositions(doc.entities, rels.map((r) => ({ from: owner(r.from), to: owner(r.to) })).filter((r) => r.from !== r.to), 'right');
  const cellW = Math.max(...doc.entities.map((e) => sizeOf(e).w)), cellH = Math.max(...doc.entities.map((e) => sizeOf(e).h));
  const gapX = Math.min(200, Math.max(84, ...rels.filter((r) => r.label).map((r) => textWidth(r.label, 10, true) + 50)));
  for (const e of doc.entities) {
    const { w, h } = sizeOf(e), cell = grid.cells.get(e.id), x = cell.col * (cellW + gapX), y = cell.row * (cellH + 50);
    const lk = look(scene, e.delta);
    fit(scene, e.name, w - (lk.badge ? 96 : 24), 13, false, true, 'entity name');
    let s = `<g${lk.opacity ? ` opacity="${lk.opacity}"` : ''}><rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="8" fill="${C.card}" stroke="${lk.stroke || C.cardStroke}" stroke-width="${lk.stroke ? 1.6 : 1.2}"${lk.dash ? ` stroke-dasharray="${lk.dash}"` : ''}/>`;
    s += `<text class="t" x="${r1(x + 12)}" y="${r1(y + 22)}"${lk.strike ? ' text-decoration="line-through"' : ''}>${esc(e.name)}</text><path d="M${r1(x)} ${r1(y + HEAD)}h${w}" stroke="${C.cardStroke}"/>`;
    if (lk.badge) s += `<text class="l" x="${r1(x + w - 10)}" y="${r1(y + 21)}" text-anchor="end" font-size="8" style="fill:${lk.tone}">${lk.badge === 'NEW' ? 'NEW TABLE' : lk.badge}</text>`;
    scene.box(e.id, { x, y, w, h, name: e.name });
    e.fields.forEach((f, i) => {
      const ry = y + HEAD + 3 + i * ROW, d = e.delta === 'added' || e.delta === 'removed' ? 'unchanged' : f.delta || 'unchanged';
      if (d !== 'unchanged') { scene.used.add(d); s += `<rect x="${r1(x + 1)}" y="${r1(ry)}" width="${w - 2}" height="${ROW - 2}" fill="${C[d + 'Fill']}"/><text class="l" x="${r1(x + 10)}" y="${r1(ry + 16)}" style="fill:${C[d + 'Text']}">${{ added: '+', removed: '−', changed: '~' }[d]}</text>`; }
      fit(scene, f.name + (f.type || ''), w - 62, 10.5, true, false, 'field');
      s += `<text class="s" x="${r1(x + 26)}" y="${r1(ry + 16)}" style="fill:${C.body}"${d === 'removed' ? ' text-decoration="line-through" opacity=".6"' : ''}>${esc(f.name)}</text>`;
      if (f.type) s += `<text class="s" x="${r1(x + w - 10)}" y="${r1(ry + 16)}" text-anchor="end">${esc(f.type)}</text>`;
      Object.assign(scene.box(`${e.id}.${f.name}`, { x, y: ry, w, h: ROW - 2, parent: e.id }), { obstacle: false });
    });
    scene.add(s + '</g>');
  }
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  routeEdges(scene, rels.map((r) => ({ from: r.from, to: r.to, label: r.label, fromSides: 'LR', toSides: 'LR', ...edgeTone(scene, r, (end) => byId.get(owner(end))?.delta) })), { prefer: 'h' });
  const rows = [...(doc.migration || []).map((text, i) => ({ text, mark: `${i + 1}` })), ...(doc.warning ? [{ text: doc.warning, tone: 'changed', mark: '⚠' }] : [])];
  if (rows.length) notePanel(scene, scene.h + 26, Math.max(scene.w, 480), 'Migration', rows);
  return scene;
}
