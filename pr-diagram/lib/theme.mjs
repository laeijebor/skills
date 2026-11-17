// Colours, fonts and text measurement shared by every diagram type.
export const C = {
  bg: '#171a20', panel: '#1e222a', zone: '#1a1d24', zoneStroke: '#2c313b',
  card: '#272c36', cardStroke: '#3b424e', text: '#e6e9ee', body: '#d5dae2', sub: '#8b93a1', cap: '#7d8696', edge: '#667082',
  added: '#4fb56a', addedText: '#6fd08a', addedFill: '#1f3327',
  changed: '#e0a030', changedText: '#f0b440', changedFill: '#3a2f17',
  removed: '#d9645f', removedText: '#e8807b', removedFill: '#3a2021'
};
export const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif';
export const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
export const DELTAS = ['added', 'changed', 'removed', 'unchanged'];

const NARROW = new Set("il.,;:|!'`()[]{}");
const SLIM = new Set('fjtrI -/"*');
// A deliberately generous estimate: viewers substitute fonts, so cards must not rely on a tight fit.
export function textWidth(text, size, mono = false, bold = false) {
  const s = String(text ?? '');
  if (mono) return s.length * size * 0.61;
  let em = 0;
  for (const ch of s) {
    if (NARROW.has(ch)) em += 0.3;
    else if (SLIM.has(ch)) em += 0.36;
    else if (ch === 'm' || ch === 'w') em += 0.84;
    else if (ch === 'M' || ch === 'W') em += 0.92;
    else if (ch >= 'A' && ch <= 'Z') em += 0.7;
    else if (ch.codePointAt(0) > 0x2e7f) em += 1;
    else em += 0.57;
  }
  return em * size * (bold ? 1.06 : 1);
}
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const r1 = (n) => Math.round(n * 10) / 10;
