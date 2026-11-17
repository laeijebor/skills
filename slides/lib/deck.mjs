import { parseHTML, descendants, hasClass, textContent } from './html.mjs';
export const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const THEME = /^[a-z0-9-]{1,40}$/;
export function parseDeck(html) {
  const tree = parseHTML(html);
  const all = descendants(tree, () => true);
  const meta = name => all.find(node => node.tag === 'meta' && node.attrs.name === name)?.attrs.content;
  const size = meta('deck:size') || '16:9';
  const globalIssues = [];
  if (!['16:9', 'a4'].includes(size)) globalIssues.push({ level: 'error', kind: 'size', message: `Unknown deck:size: ${size}`, selector: 'meta[name="deck:size"]' });
  const nodes = all.filter(node => node.tag === 'section' && hasClass(node, 'slide') && node.parent.tag === 'main' && hasClass(node.parent, 'deck'));
  if (!nodes.length) throw new Error('No slides: expected main.deck > section.slide');
  const ids = new Set(), keys = new Set();
  const slides = nodes.map((node, index) => {
    const id = node.attrs.id || `slide-${index + 1}`;
    const issues = [];
    const selector = `main.deck > section.slide:nth-of-type(${index + 1})`;
    const issue = (kind, message, level = 'error') => issues.push({ level, kind, message, selector });
    if (!node.attrs.id) issue('id', `Missing id; using ${id}`, 'warning');
    if (!ID.test(id)) issue('id', `Invalid slide id: ${id}`);
    if (ids.has(id)) issue('id', `Duplicate slide id: ${id}`);
    ids.add(id);
    const notes = descendants(node, item => item.tag === 'aside' && hasClass(item, 'notes'));
    if (notes.length > 1) issue('notes', 'At most one aside.notes is allowed per slide');
    const asks = descendants(node, item => item.tag === 'aside' && hasClass(item, 'ask')).map((ask, i) => {
      const key = ask.attrs['data-key'] ?? `${id}-ask-${i + 1}`;
      const question = textContent(ask);
      if (!ID.test(key)) issue('ask', `Invalid ask key: ${key}`);
      if (keys.has(key)) issue('ask', `Duplicate ask key: ${key}`);
      keys.add(key);
      if (!question || question.length > 256) issue('ask', 'Ask text must contain 1–256 characters');
      let options;
      if ('data-options' in ask.attrs) {
        try { options = JSON.parse(ask.attrs['data-options']); } catch { issue('ask', `Options for ${key} are not valid JSON`); }
        if (!Array.isArray(options) || options.length < 1 || options.length > 50 || options.some(option => typeof option !== 'string' || option.length > 256)) issue('ask', `Options for ${key} must be 1–50 strings of at most 256 characters`);
      }
      return { key, question, options, multiple: 'data-multiple' in ask.attrs, answer: ask.attrs['data-answer'] };
    });
    const heading = descendants(node, item => ['h1', 'h2'].includes(item.tag))[0];
    return { id, title: node.attrs['data-title'] ?? (heading ? textContent(heading) : `Slide ${index + 1}`), notes: notes.map(textContent).join('\n'), notesCount: notes.length, asks, issues };
  });
  slides[0].issues.unshift(...globalIssues);
  return { title: meta('deck:title') ?? textContent(all.find(node => node.tag === 'title') || { children: [] }), size, width: size === 'a4' ? 794 : 1280, height: size === 'a4' ? 1123 : 720, slides };
}
