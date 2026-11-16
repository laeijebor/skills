import { obj, arr, str, num, bool, req, checkShape } from '../shape.mjs';
import { base, delta } from '../common.mjs';
import { Scene, wrap } from '../scene.mjs';
import { textWidth, esc, C, SANS, r1 } from '../theme.mjs';

export const name = 'measure';
export const label = 'Measured before / after';
export const when = 'A performance, bundle-size or cost change that was measured';
export const question = 'How much, and from which phase?';

export const spec = obj({
  ...base(name),
  metric: req(str({ max: 60 })), unit: req(str({ max: 10 })), source: req(str({ max: 160 })), lowerIsBetter: bool(),
  bars: req(arr(obj({ label: req(str({ max: 14 })), segments: req(arr(obj({ label: req(str({ max: 30 })), value: req(num({ min: 0, max: 1e12 })), delta: delta() }), { min: 1, max: 8 })) }), { min: 2, max: 4 }))
});

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (!issues.length && !doc.bars.some((b) => b.segments.some((s) => s.value > 0))) issues.push({ level: 'error', message: 'bars: every value is 0; there is nothing to draw' });
}

const fmt = (n) => Math.abs(n) >= 100 ? (Math.round(n * 10) / 10).toLocaleString('en-US') : Number(n.toPrecision(3)).toLocaleString('en-US', { maximumSignificantDigits: 3 });
function niceStep(max) { const raw = max / 4, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow; }

export function render(doc) {
  const scene = new Scene(doc, label);
  const totals = doc.bars.map((b) => b.segments.reduce((s, x) => s + x.value, 0)), max = Math.max(...totals);
  const x0 = Math.max(...doc.bars.map((b) => textWidth(b.label, 10, true) + b.label.length)) + 18, BW = 640, scale = BW / max, BH = 42;
  let y = 6;
  doc.bars.forEach((bar, bi) => {
    scene.add(`<text class="cap" x="0" y="${y + BH / 2 + 4}">${esc(bar.label.toUpperCase())}</text>`);
    let x = x0, under = x0 - 10;
    for (const seg of bar.segments) {
      const w = seg.value * scale, d = seg.delta || 'unchanged', tone = d === 'unchanged' ? null : d;
      if (tone) scene.used.add(tone);
      if (w > 0) scene.add(`<rect x="${r1(x)}" y="${y}" width="${r1(Math.max(1, w - 2))}" height="${BH}" rx="4" fill="${tone ? C[tone + 'Fill'] : '#3b424e'}"${tone ? ` stroke="${C[tone]}"` : ''}/>`);
      const value = `${fmt(seg.value)} ${doc.unit}`, color = tone ? C[tone + 'Text'] : C.body, lw = Math.max(textWidth(seg.label, 10, true), textWidth(value, 10.5, true));
      if (lw + 12 <= w) scene.add(`<text class="l" x="${r1(x + w / 2)}" y="${y + 18}" text-anchor="middle" style="fill:${color}">${esc(seg.label)}</text><text class="s" x="${r1(x + w / 2)}" y="${y + 32}" text-anchor="middle">${esc(value)}</text>`);
      else {
        // Too narrow to hold its own text: label it underneath.
        const text = `${seg.label} ${value}`, tw = textWidth(text, 10.5, true), tx = Math.max(x, under + 12);
        if (tx > x + Math.max(w, 30) + 40) scene.error(`bars[${bi}]: the segment "${seg.label}" is too small to label next to its neighbours; merge the small segments into one`);
        scene.add(`<path d="M${r1(x + Math.max(w, 2) / 2)} ${y + BH}v6" stroke="${C.sub}"/><text class="s" x="${r1(tx)}" y="${y + BH + 18}" style="fill:${color}">${esc(text)}</text>`);
        under = tx + tw; scene.grow(under, y + BH + 22);
      }
      x += w;
    }
    scene.add(`<text class="t" x="${r1(x + 10)}" y="${y + BH / 2 + 4.5}">${esc(fmt(totals[bi]))} ${esc(doc.unit)}</text>`);
    scene.grow(x + 10 + textWidth(`${fmt(totals[bi])} ${doc.unit}`, 13, false, true), y + BH);
    y += BH + 40;
  });
  const step = niceStep(max);
  scene.add(`<path d="M${r1(x0)} ${y - 8}H${r1(x0 + BW)}" stroke="#4a5160"/>`);
  for (let i = 0, v = 0; i <= Math.floor(max / step + 1e-9); i++, v = i * step) scene.add(`<path d="M${r1(x0 + v * scale)} ${y - 12}v8" stroke="#4a5160"/><text class="s" x="${r1(x0 + v * scale)}" y="${y + 10}" text-anchor="middle">${esc(fmt(v))}</text>`);
  y += 32;
  const first = totals[0], last = totals[totals.length - 1], W = Math.max(scene.w, x0 + BW);
  const lines = wrap(doc.source, W - 190, 10.5), H = 46 + lines.length * 16 + 12;
  scene.add(`<rect x="0" y="${y}" width="${r1(W)}" height="${H}" rx="10" fill="${C.zone}" stroke="${C.zoneStroke}"/>`);
  if (first > 0) {
    const pct = Math.round(((last - first) / first) * 100), better = (doc.lowerIsBetter ?? true) ? last < first : last > first;
    scene.add(`<text x="20" y="${y + 44}" font-family='${SANS}' font-size="32" font-weight="700" fill="${pct === 0 ? C.sub : better ? C.addedText : C.removedText}">${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%</text>`);
  }
  scene.add(`<text class="t" x="170" y="${y + 28}">${esc(doc.metric)}</text>`);
  lines.forEach((line, i) => scene.add(`<text class="s" x="170" y="${y + 46 + i * 16}">${esc(line)}</text>`));
  scene.grow(W, y + H);
  return scene;
}
