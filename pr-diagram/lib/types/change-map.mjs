import { obj, arr, str, int, req, checkShape } from '../shape.mjs';
import { base, delta, CIRCLED } from '../common.mjs';
import { Scene, look, notePanel, stepBadge } from '../scene.mjs';
import { textWidth, esc, C, r1 } from '../theme.mjs';

export const name = 'change-map';
export const label = 'Change map';
export const when = 'A large PR of any kind, as a second image';
export const question = 'Where do I start, and what can I skim?';

export const spec = obj({
  ...base(name),
  groups: req(arr(obj({
    label: req(str({ max: 30 })),
    files: req(arr(obj({ label: req(str({ max: 40 })), added: int({ min: 0 }), removed: int({ min: 0 }), delta: delta(), note: str({ max: 30 }), order: int({ min: 1, max: 9 }), why: str({ max: 120 }) }), { min: 1, max: 12 }))
  }), { min: 1, max: 8 }))
});

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const orders = new Set();
  doc.groups.forEach((g, gi) => g.files.forEach((f, fi) => {
    if (f.order !== undefined) { if (orders.has(f.order)) issues.push({ level: 'error', message: `groups[${gi}].files[${fi}].order: ${f.order} is used twice` }); orders.add(f.order); if (!f.why) issues.push({ level: 'error', message: `groups[${gi}].files[${fi}].why: say why this file is number ${f.order} in the review order` }); }
  }));
}

// Squarified treemap: keeps tiles close to square so labels fit.
function squarify(items, rect) {
  const total = items.reduce((s, i) => s + i.weight, 0), k = (rect.w * rect.h) / total;
  const rest = [...items].sort((a, b) => b.weight - a.weight).map((i) => ({ item: i, area: i.weight * k }));
  const r = { ...rect }; let row = [];
  const worst = (list, side) => { const s = list.reduce((a, b) => a + b.area, 0), mx = Math.max(...list.map((l) => l.area)), mn = Math.min(...list.map((l) => l.area)); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
  const flush = () => {
    const s = row.reduce((a, b) => a + b.area, 0);
    if (r.w >= r.h) { const w = s / r.h; let y = r.y; for (const e of row) { const h = e.area / w; e.item.rect = { x: r.x, y, w, h }; y += h; } r.x += w; r.w -= w; }
    else { const h = s / r.w; let x = r.x; for (const e of row) { const w = e.area / h; e.item.rect = { x, y: r.y, w, h }; x += w; } r.y += h; r.h -= h; }
    row = [];
  };
  while (rest.length) { const side = Math.min(r.w, r.h); if (!row.length || worst([...row, rest[0]], side) <= worst(row, side)) row.push(rest.shift()); else flush(); }
  if (row.length) flush();
}
const clip = (text, max, size, mono, bold) => { if (textWidth(text, size, mono, bold) <= max) return text; let t = text; while (t.length > 1 && textWidth(t + '…', size, mono, bold) > max) t = t.slice(0, -1); return t.length > 1 ? t + '…' : ''; };

export function render(doc) {
  const scene = new Scene(doc, label);
  const W = 920, H = 340, churn = (f) => (f.added || 0) + (f.removed || 0);
  const total = doc.groups.reduce((s, g) => s + g.files.reduce((t, f) => t + churn(f), 0), 0) || 1;
  // A floor on tile size keeps a small but important file readable; areas are then approximate.
  const groups = doc.groups.map((g) => { const files = g.files.map((f) => ({ f, weight: Math.max(churn(f), total * 0.05) })); return { g, files, weight: files.reduce((s, f) => s + f.weight, 0), lines: g.files.reduce((t, f) => t + churn(f), 0) }; });
  squarify(groups, { x: 0, y: 0, w: W, h: H });
  for (const grp of groups) {
    const r = grp.rect, gx = r.x + 4, gy = r.y + 4, gw = r.w - 8, gh = r.h - 8;
    scene.add(`<rect x="${r1(gx)}" y="${r1(gy)}" width="${r1(gw)}" height="${r1(gh)}" rx="9" fill="${C.zone}" stroke="${C.zoneStroke}"/>`);
    const cap = clip(`${grp.g.label} · ${grp.lines} lines`.toUpperCase(), gw - 20, 11.2, true) || clip(grp.g.label.toUpperCase(), gw - 20, 11.2, true);
    scene.add(`<text class="cap" x="${r1(gx + 10)}" y="${r1(gy + 18)}">${esc(cap)}</text>`);
    squarify(grp.files, { x: gx + 6, y: gy + 26, w: gw - 12, h: gh - 32 });
    for (const { f, rect } of grp.files) {
      const x = rect.x + 3, y = rect.y + 3, w = rect.w - 6, h = rect.h - 6, lk = look(scene, f.delta);
      let s = `<g${lk.opacity ? ` opacity="${lk.opacity}"` : ''}><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="6" fill="${f.delta === 'changed' ? C.changedFill : lk.fill || C.card}" stroke="${lk.stroke || C.cardStroke}"${lk.dash ? ` stroke-dasharray="${lk.dash}"` : ''}/>`;
      const room = w - 18 - (f.order ? 24 : 0), name = h >= 24 ? clip(f.label, room, 12, false, true) : '';
      if (name) s += `<text class="t" x="${r1(x + 9)}" y="${r1(y + 19)}" font-size="12"${lk.strike ? ' text-decoration="line-through"' : ''}>${esc(name)}</text>`;
      else if (!f.order) scene.warn(`the tile for "${f.label}" is too small to name; it is still drawn`);
      const stats = [f.added ? `+${f.added}` : '', f.removed ? `−${f.removed}` : ''].filter(Boolean).join(' ') + (f.note ? ` · ${f.note}` : '');
      const line = h >= 42 ? clip(stats, w - 18, 10.5, true) : '';
      if (line) s += `<text class="s" x="${r1(x + 9)}" y="${r1(y + 35)}">${esc(line)}</text>`;
      if (f.order) s += stepBadge(x + w - 15, y + 15, f.order);
      scene.add(s + '</g>');
    }
  }
  scene.grow(W, H);
  const ordered = doc.groups.flatMap((g) => g.files).filter((f) => f.order).sort((a, b) => a.order - b.order);
  let y = H + 14;
  if (ordered.length) y = notePanel(scene, y, W, 'Review order', ordered.map((f) => ({ text: `${f.label}: ${f.why}`, mark: CIRCLED(f.order) })));
  scene.add(`<text class="s" x="0" y="${y + 20}">area is lines changed (small files are drawn a little larger so they can be read)</text>`);
  scene.grow(W, y + 24);
  return scene;
}
