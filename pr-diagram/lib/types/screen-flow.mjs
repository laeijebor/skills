import { readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { obj, arr, str, num, bool, enm, req, id, checkShape, indexById, checkRef } from '../shape.mjs';
import { base, delta, edgeFields, edgeTone, checkEdges, addEnd } from '../common.mjs';
import { Scene, pickMode, look, fit } from '../scene.mjs';
import { routeEdges } from '../route.mjs';
import { gridPositions, checkGridFields } from '../grid.mjs';
import { textWidth, esc, C, r1 } from '../theme.mjs';

export const name = 'screen-flow';
export const label = 'Screen flow';
export const when = 'UI, navigation or mobile screen changes';
export const question = 'Which screens changed, and how do you reach them?';

const KINDS = ['row', 'button', 'text', 'input', 'image', 'heading'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export const spec = obj({
  ...base(name),
  screens: req(arr(obj({
    id: req(id()), title: req(str({ max: 24 })), delta: delta(), device: enm(['phone', 'desktop']), sheet: bool(), image: str({ max: 300 }),
    col: num({ min: 0, max: 5 }), row: num({ min: 0, max: 3 }),
    elements: arr(obj({ id: id(), kind: req(enm(KINDS)), label: str({ max: 26 }), delta: delta() }), { max: 9 })
  }), { min: 1, max: 6 })),
  links: arr(obj(edgeFields()), { max: 14 })
});
const SIZE = { phone: { w: 196, h: 350 }, desktop: { w: 320, h: 220 } };
const EL_H = { row: 30, button: 32, text: 22, input: 30, image: 64, heading: 20 };

const ownersOf = (doc) => new Map(doc.screens.flatMap((s) => [[s.id, s.id], ...(s.elements || []).filter((e) => e.id).map((e) => [`${s.id}.${e.id}`, s.id])]));
export function validate(doc, issues, opts = {}) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const ends = new Map(indexById(doc.screens, 'screens', issues));
  doc.screens.forEach((s, si) => {
    for (const e of s.elements || []) if (e.id) addEnd(ends, `${s.id}.${e.id}`, e, `screens[${si}].elements`, issues);
    if (s.image) {
      if (s.elements?.length) issues.push({ level: 'error', message: `screens[${si}]: use either image (a real screenshot) or elements (a wireframe), not both` });
      const file = resolve(opts.baseDir || '.', s.image);
      if (!MIME[extname(file).toLowerCase()]) issues.push({ level: 'error', message: `screens[${si}].image: must be a .png, .jpg or .webp file` });
      else try { if (statSync(file).size > 700_000) issues.push({ level: 'error', message: `screens[${si}].image: ${s.image} is over 700 KB; resize it (the image is embedded in the SVG)` }); } catch { issues.push({ level: 'error', message: `screens[${si}].image: cannot read ${file}` }); }
    }
  });
  checkGridFields(doc.screens, 'screens', issues);
  const owners = ownersOf(doc);
  checkEdges(doc.links, 'links', issues, { same: (l) => owners.get(l.from) === owners.get(l.to) });
  (doc.links || []).forEach((l, i) => { checkRef(l.from, ends, `links[${i}].from`, issues, 'screen (or screen.element)'); checkRef(l.to, ends, `links[${i}].to`, issues, 'screen (or screen.element)'); });
}

export function render(doc, opts = {}) {
  const scene = new Scene(doc, label);
  scene.mode = pickMode(doc, doc.screens.map((s) => s.delta || 'unchanged'));
  const links = doc.links || [], owners = ownersOf(doc), owner = (end) => owners.get(end), isElement = (end) => owners.get(end) !== end;
  const sizeOf = (s) => SIZE[s.device || 'phone'];
  const grid = gridPositions(doc.screens, links.map((l) => ({ from: owner(l.from), to: owner(l.to) })).filter((l) => l.from !== l.to), 'right');
  const cellW = Math.max(...doc.screens.map((s) => sizeOf(s).w)), cellH = Math.max(...doc.screens.map((s) => sizeOf(s).h));
  const gapX = Math.min(210, Math.max(96, ...links.filter((l) => l.label).map((l) => textWidth(l.label, 10, true) + 56)));
  doc.screens.forEach((sc, si) => {
    const { w, h } = sizeOf(sc), cell = grid.cells.get(sc.id), x = cell.col * (cellW + gapX) + (cellW - w) / 2, y = cell.row * (cellH + 56) + 18;
    const lk = look(scene, sc.delta), phone = (sc.device || 'phone') === 'phone', rx = phone ? 24 : 10;
    let s = `<g${lk.opacity ? ` opacity="${lk.opacity}"` : ''}>`;
    if (lk.badge) s += `<text class="l" x="${r1(x + w / 2)}" y="${r1(y - 7)}" text-anchor="middle" font-size="9" style="fill:${lk.tone}">${lk.badge} SCREEN</text>`;
    s += `<rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="${rx}" fill="${C.card}" stroke="${lk.stroke || C.cardStroke}" stroke-width="${lk.stroke ? 1.8 : 1.2}"${lk.dash ? ` stroke-dasharray="${lk.dash}"` : ''}/>`;
    scene.box(sc.id, { x, y, w, h, name: sc.title });
    if (sc.image) {
      const file = resolve(opts.baseDir || '.', sc.image), data = readFileSync(file).toString('base64');
      s += `<clipPath id="clip${si}"><rect x="${r1(x + 3)}" y="${r1(y + 3)}" width="${w - 6}" height="${h - 6}" rx="${rx - 3}"/></clipPath><image x="${r1(x + 3)}" y="${r1(y + 3)}" width="${w - 6}" height="${h - 6}" preserveAspectRatio="xMidYMin slice" clip-path="url(#clip${si})" href="data:${MIME[extname(file).toLowerCase()]};base64,${data}"/>`;
      scene.add(s + '</g>'); return;
    }
    if (phone) s += `<rect x="${r1(x + w / 2 - 28)}" y="${r1(y + 10)}" width="56" height="5" rx="2.5" fill="${C.cardStroke}"/>`;
    fit(scene, sc.title, w - 32, 13, false, true, 'screen title');
    s += `<text class="t" x="${r1(x + 16)}" y="${r1(y + (phone ? 40 : 28))}">${esc(sc.title)}</text>`;
    const els = sc.elements || [], need = els.reduce((sum, e) => sum + EL_H[e.kind] + 8, 0);
    let ey = y + (phone ? 54 : 42), ex = x + 14, ew = w - 28;
    if (sc.sheet) {
      // A sheet rises over the screen behind it: dim placeholder rows above, the sheet's own content below.
      const top = y + h - need - 30;
      for (let py = ey; py + 30 < top - 8; py += 38) s += `<rect x="${r1(ex)}" y="${r1(py)}" width="${ew}" height="30" rx="7" fill="#2f3540" opacity=".5"/>`;
      s += `<path d="M${r1(x + 1)} ${r1(top + 18)}a18 18 0 0 1 18-18h${w - 38}a18 18 0 0 1 18 18V${r1(y + h - rx)}a${rx - 1} ${rx - 1} 0 0 1-${rx - 1} ${rx - 1}h-${w - 2 * rx}a${rx - 1} ${rx - 1} 0 0 1-${rx - 1}-${rx - 1}z" fill="${lk.fill || '#30363f'}" stroke="${lk.stroke || '#4a5160'}"/>`;
      if (top < ey) scene.error(`the sheet on "${sc.title}" has more elements than fit; keep the ones the change touches`);
      ey = top + 20;
    }
    if (ey + need > y + h - 6) scene.error(`the screen "${sc.title}" has more elements than fit; keep the ones the change touches`);
    for (const e of els) {
      const eh = EL_H[e.kind], d = e.delta || 'unchanged', tone = d === 'unchanged' ? null : d;
      if (tone) scene.used.add(tone);
      const stroke = tone ? ` stroke="${C[tone]}"${tone === 'removed' ? ' stroke-dasharray="4 3"' : ''}` : '';
      const text = (tx, anchor, color, bold) => e.label ? `<text class="${bold ? 'l' : 's'}" x="${r1(tx)}" y="${r1(ey + eh / 2 + 3.5)}" text-anchor="${anchor}" style="fill:${color}"${tone === 'removed' ? ' text-decoration="line-through"' : ''}>${esc(e.label)}</text>` : '';
      if (e.label) fit(scene, e.label, e.kind === 'text' ? ew : e.kind === 'heading' ? ew : ew - 20, e.kind === 'heading' ? 12 : 10.5, e.kind !== 'heading', e.kind === 'heading', 'element label');
      if (e.kind === 'row') s += `<rect x="${r1(ex)}" y="${r1(ey)}" width="${ew}" height="${eh}" rx="7" fill="${tone ? C[tone + 'Fill'] : '#333a46'}"${stroke}/>${text(ex + 10, 'start', C.body)}`;
      else if (e.kind === 'button') s += `<rect x="${r1(ex)}" y="${r1(ey)}" width="${ew}" height="${eh}" rx="9" fill="${tone && tone !== 'removed' ? C[tone] : '#3b424e'}"${tone === 'removed' ? stroke : ''}/>${text(ex + ew / 2, 'middle', tone && tone !== 'removed' ? '#14171c' : C.text, true)}`;
      else if (e.kind === 'input') s += `<rect x="${r1(ex)}" y="${r1(ey)}" width="${ew}" height="${eh}" rx="7" fill="none" stroke="${tone ? C[tone] : '#4a5160'}"/>${text(ex + 10, 'start', C.sub)}`;
      else if (e.kind === 'image') s += `<rect x="${r1(ex)}" y="${r1(ey)}" width="${ew}" height="${eh}" rx="7" fill="#2f3540"${stroke}/><path d="M${r1(ex)} ${r1(ey + eh)}L${r1(ex + ew * 0.35)} ${r1(ey + eh * 0.45)}L${r1(ex + ew * 0.55)} ${r1(ey + eh * 0.7)}L${r1(ex + ew * 0.72)} ${r1(ey + eh * 0.4)}L${r1(ex + ew)} ${r1(ey + eh)}" fill="#3b424e"/>`;
      else if (e.kind === 'heading') s += e.label ? `<text class="t" x="${r1(ex)}" y="${r1(ey + 14)}" font-size="12"${tone ? ` style="fill:${C[tone + 'Text']}"` : ''}>${esc(e.label)}</text>` : '';
      else s += e.label ? text(ex, 'start', tone ? C[tone + 'Text'] : C.sub) : `<rect x="${r1(ex)}" y="${r1(ey + 4)}" width="${r1(ew * 0.9)}" height="5" rx="2.5" fill="#3b424e"/><rect x="${r1(ex)}" y="${r1(ey + 14)}" width="${r1(ew * 0.6)}" height="5" rx="2.5" fill="#3b424e"/>`;
      if (e.id) Object.assign(scene.box(`${sc.id}.${e.id}`, { x: ex, y: ey, w: ew, h: eh, parent: sc.id }), { obstacle: false });
      ey += eh + 8;
    }
    scene.add(s + '</g>');
  });
  const byId = new Map(doc.screens.map((s) => [s.id, s]));
  routeEdges(scene, links.map((l) => ({ from: l.from, to: l.to, label: l.label, ...(isElement(l.from) ? { fromSides: 'LR' } : {}), ...(isElement(l.to) ? { toSides: 'LR' } : {}), ...edgeTone(scene, l, (end) => byId.get(owner(end))?.delta) })), { prefer: 'h' });
  return scene;
}
