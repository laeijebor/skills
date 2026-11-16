// The drawing surface every type renders onto: cards, zones, text, and the final SVG frame.
import { C, SANS, MONO, textWidth, esc, r1 } from './theme.mjs';

export const PAD = 26;
const HEAD = 62;
export const CARD_MAX = 250;

export class Scene {
  constructor(doc, typeLabel) {
    this.doc = doc; this.typeLabel = typeLabel;
    this.items = []; this.over = []; this.boxes = new Map(); this.labels = []; this.issues = [];
    this.w = 0; this.h = 0; this.used = new Set(); this.mode = 'changes';
  }
  add(s) { this.items.push(s); }
  top(s) { this.over.push(s); }
  grow(x, y) { this.w = Math.max(this.w, x); this.h = Math.max(this.h, y); }
  box(id, rect) { const b = { id, obstacle: true, ...rect }; this.boxes.set(id, b); this.grow(b.x + b.w, b.y + b.h); return b; }
  error(message) { this.issues.push({ level: 'error', message }); }
  warn(message) { this.issues.push({ level: 'warning', message }); }
}

// "new" mode: the change adds a whole area, so marking every card NEW is noise. Mark what already existed instead.
export function pickMode(doc, deltas) {
  if (doc.emphasis === 'changes' || doc.emphasis === 'new') return doc.emphasis;
  const added = deltas.filter((d) => d === 'added').length;
  return deltas.length >= 4 && added / deltas.length >= 0.6 ? 'new' : 'changes';
}

export function look(scene, delta = 'unchanged') {
  const isNew = scene.mode === 'new';
  if (delta === 'added') { if (isNew) return {}; scene.used.add('added'); return { stroke: C.added, fill: C.addedFill, badge: 'NEW', tone: C.addedText }; }
  if (delta === 'changed') { scene.used.add('changed'); return { stroke: C.changed, badge: 'CHANGED', tone: C.changedText }; }
  if (delta === 'removed') { scene.used.add('removed'); return { stroke: C.removed, dash: '5 4', opacity: 0.78, badge: 'REMOVED', tone: C.removedText, strike: true }; }
  if (isNew) { scene.used.add('existing'); return { dash: '3 3', opacity: 0.72, badge: 'EXISTING', tone: C.cap }; }
  return {};
}

export function fit(scene, text, max, size, mono, bold, what) {
  const w = textWidth(text, size, mono, bold);
  if (w > max) {
    const chars = Math.max(4, Math.floor(String(text).length * max / w));
    scene.error(`${what} "${text}" is too long to draw (about ${chars} characters fit)`);
  }
  return w;
}

export function cardSize(n) {
  const w = Math.max(textWidth(n.label, 13, false, true), n.sub ? textWidth(n.sub, 10.5, true) : 0) + 26;
  return { w: Math.min(CARD_MAX, Math.max(124, Math.ceil(w / 2) * 2)), h: n.sub ? 58 : 44 };
}

// shape: card (default), pill, diamond. Text is left-aligned in cards and centred in the other two.
export function drawNode(scene, { id, x, y, w, h, label, sub, delta, shape = 'card', parent, big }) {
  const lk = look(scene, delta);
  const stroke = lk.stroke || C.cardStroke, fill = lk.fill || C.card;
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${lk.stroke ? 1.6 : 1.2}"${lk.dash ? ` stroke-dasharray="${lk.dash}"` : ''}`;
  let s = `<g${lk.opacity ? ` opacity="${lk.opacity}"` : ''}>`;
  if (shape === 'diamond') s += `<path d="M${r1(x + w / 2)} ${r1(y)}L${r1(x + w)} ${r1(y + h / 2)}L${r1(x + w / 2)} ${r1(y + h)}L${r1(x)} ${r1(y + h / 2)}z" ${attrs}/>` + (lk.badge ? `<text class="l" x="${r1(x + w / 2 + 16)}" y="${r1(y + 7)}" font-size="8" style="fill:${lk.tone}">${lk.badge}</text>` : '');
  else s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${shape === 'pill' ? r1(h / 2) : big ? 12 : 8}" ${attrs}/>`;
  const strike = lk.strike ? ' text-decoration="line-through" opacity=".65"' : '';
  const room = big ? Infinity : shape === 'diamond' ? w * 0.62 : w - 22;
  fit(scene, label, room, 13, false, true, 'label');
  if (sub) fit(scene, sub, room, 10.5, true, false, 'subtitle');
  if (shape === 'card') {
    const ty = y + h / 2 + (sub ? -3 : 4.5);
    s += `<text class="t" x="${r1(x + 12)}" y="${r1(ty)}"${big ? ' font-size="15"' : ''}${strike}>${esc(label)}</text>`;
    if (sub) s += `<text class="s" x="${r1(x + 12)}" y="${r1(ty + 15)}">${esc(sub)}</text>`;
    if (lk.badge && big) s += `<text class="l" x="${r1(x + 12)}" y="${r1(ty + (sub ? 31 : 17))}" font-size="8" style="fill:${lk.tone}">${lk.badge}</text>`;
    else if (lk.badge) s += `<text class="l" x="${r1(x + w - 8)}" y="${r1(y + 13)}" text-anchor="end" font-size="8" style="fill:${lk.tone}">${lk.badge}</text>`;
  } else {
    const ty = y + h / 2 + (sub ? -3 : 4.5);
    s += `<text class="t" x="${r1(x + w / 2)}" y="${r1(ty)}" text-anchor="middle"${strike}>${esc(label)}</text>`;
    if (sub) s += `<text class="s" x="${r1(x + w / 2)}" y="${r1(ty + 15)}" text-anchor="middle">${esc(sub)}</text>`;
  }
  scene.add(s + '</g>');
  return scene.box(id, { x, y, w, h, shape, parent, name: label });
}

export function drawZone(scene, { x, y, w, h, label, frame = true }) {
  if (frame) scene.add(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="12" fill="${C.zone}" stroke="${C.zoneStroke}"/>`);
  if (label) caption(scene, x + 14, y + 22, label);
  scene.grow(x + w, y + h);
}

export const capWidth = (text) => String(text).length * (10 * 0.61 + 1);
export function caption(scene, x, y, text, anchor = 'start') {
  const w = capWidth(text);
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  scene.add(`<text class="cap" x="${r1(x)}" y="${r1(y)}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(String(text).toUpperCase())}</text>`);
  scene.labels.push({ x: left - 3, y: y - 11, w: w + 6, h: 15 });
  scene.grow(left + w, y + 4);
}

// Greedy word wrap by estimated width.
export function wrap(text, max, size, mono = true) {
  const lines = []; let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, mono) > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// A boxed list under the diagram ("Migration", "Review order", "What changes for you").
// rows: [{ text, tone? }]. Returns the y below it.
export function notePanel(scene, y, width, title, rows) {
  const inner = width - 32; let lines = [];
  for (const row of rows) for (const [i, line] of wrap(row.text, inner - (row.mark ? 18 : 0), 10.5).entries()) lines.push({ ...row, text: line, first: i === 0 });
  const h = 34 + lines.length * 19 + 8;
  scene.add(`<rect x="0" y="${r1(y)}" width="${r1(width)}" height="${h}" rx="10" fill="${C.zone}" stroke="${C.zoneStroke}"/>`);
  scene.add(`<text class="cap" x="16" y="${r1(y + 22)}">${esc(title.toUpperCase())}</text>`);
  lines.forEach((ln, i) => {
    const ty = y + 44 + i * 19, color = ln.tone ? C[ln.tone + 'Text'] : C.body;
    if (ln.mark && ln.first) scene.add(`<text class="s" x="16" y="${r1(ty)}" fill="${C.changedText}" style="fill:${C.changedText}">${esc(ln.mark)}</text>`);
    scene.add(`<text class="s" x="${ln.mark ? 34 : 16}" y="${r1(ty)}" style="fill:${color}">${esc(ln.text)}</text>`);
  });
  scene.grow(width, y + h);
  return y + h;
}

export function stepBadge(x, y, n, color = C.changed) {
  return `<circle cx="${r1(x)}" cy="${r1(y)}" r="10" fill="${color}" stroke="${C.panel}" stroke-width="2"/><text x="${r1(x)}" y="${r1(y + 4)}" text-anchor="middle" font-family='${SANS}' font-size="11" font-weight="700" fill="#14171c">${esc(n)}</text>`;
}

const LEGEND = { added: ['new', C.added], changed: ['changed', C.changed], removed: ['removed', C.removed], existing: ['already existed', C.cap] };

export function finalize(scene) {
  const { doc } = scene;
  const title = doc.title || '';
  const chipW = capWidth(scene.typeLabel) + 18;
  const headW = textWidth(title, 17, false, true) + 14 + chipW;
  const contentW = Math.max(scene.w, 520, headW);
  const W = Math.ceil(contentW + PAD * 2);
  const dx = PAD + (contentW - scene.w) / 2;
  const legend = [...scene.used].filter((k) => LEGEND[k]);
  const capLines = doc.caption ? wrap(doc.caption, contentW, 11.5, false) : [];
  if (capLines.length > 3) scene.error(`caption is too long (${doc.caption.length} characters); keep it to one or two sentences`);
  if (W > 1240) scene.warn(`the diagram is ${W}px wide; a pull request shows about 900px, so the text will be small. Use fewer columns, shorter labels, or two diagrams`);
  const bodyTop = HEAD, bodyH = scene.h + 28;
  let fy = bodyTop + bodyH + 22, foot = '';
  if (legend.length || scene.mode === 'new') {
    let lx = PAD;
    if (scene.mode === 'new') { const note = scene.used.has('existing') ? 'everything shown is new, except cards marked existing' : 'everything shown is new'; foot += `<text class="s" x="${lx}" y="${fy}">${note}</text>`; lx += textWidth(note, 10.5, true) + 22; }
    for (const k of legend) {
      if (scene.mode === 'new' && k === 'existing') continue;
      const word = scene.mode === 'new' && k === 'added' ? 'connects to existing code' : LEGEND[k][0];
      foot += `<circle cx="${r1(lx + 4)}" cy="${fy - 3.5}" r="4" fill="${LEGEND[k][1]}"/><text class="s" x="${r1(lx + 13)}" y="${fy}">${word}</text>`;
      lx += 13 + textWidth(word, 10.5, true) + 18;
    }
    fy += 20;
  }
  capLines.forEach((line) => { foot += `<text x="${PAD}" y="${fy}" font-family='${SANS}' font-size="11.5" fill="${C.body}">${esc(line)}</text>`; fy += 17; });
  const H = Math.ceil(fy + 2);
  const tw = textWidth(title, 17, false, true) * 0.9;
  const markers = ['neutral', 'added', 'changed', 'removed'].map((k) => `<marker id="m-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${k === 'neutral' ? C.edge : C[k]}"/></marker>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title + (doc.caption ? '. ' + doc.caption : ''))}">
<style>
.t{font:600 13px ${SANS};fill:${C.text}}.s{font:10.5px ${MONO};fill:${C.sub}}.cap{font:600 10px ${MONO};letter-spacing:1px;fill:${C.cap}}.l{font:600 10px ${MONO};fill:#aeb6c4}
.e{fill:none;stroke:${C.edge};stroke-width:1.5}.e-added{stroke:${C.added};stroke-width:2}.e-changed{stroke:${C.changed};stroke-width:2}.e-removed{stroke:${C.removed};stroke-dasharray:5 4;opacity:.85}
.flow{stroke-dasharray:6 6;animation:f 1.2s linear infinite}@keyframes f{to{stroke-dashoffset:-24}}
@media (prefers-reduced-motion:reduce){.flow{animation:none}}
</style>
<defs>${markers}<pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#262b34"/></pattern></defs>
<rect width="${W}" height="${H}" rx="14" fill="${C.bg}"/><rect width="${W}" height="${H}" rx="14" fill="url(#dots)"/>
<text x="${PAD}" y="38" font-family='${SANS}' font-size="17" font-weight="650" fill="${C.text}">${esc(title)}</text>
<rect x="${r1(PAD + tw + 12)}" y="23" width="${r1(chipW)}" height="20" rx="10" fill="none" stroke="#6b5220"/><text class="cap" x="${r1(PAD + tw + 21)}" y="37" style="fill:${C.changed}">${esc(scene.typeLabel.toUpperCase())}</text>
<rect x="${PAD - 12}" y="${bodyTop - 6}" width="${W - PAD * 2 + 24}" height="${r1(bodyH + 6)}" rx="12" fill="${C.panel}" stroke="${C.zoneStroke}"/>
<g transform="translate(${r1(dx)} ${bodyTop + 10})">
${scene.items.join('\n')}
${scene.over.join('\n')}
</g>
${foot}
</svg>
`;
  return { svg, width: W, height: H };
}
