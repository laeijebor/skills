// A small tokenizer for explicit, valid deck HTML (not a browser error-recovery parser).
const voids = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
export const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key) => {
  if (key[0] === '#') {
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
  }
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[key.toLowerCase()] || all;
});
export const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function parseHTML(source) {
  const root = { tag: '#root', children: [] };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</g;
  let match;
  while ((match = token.exec(source))) {
    const raw = match[0];
    const parent = stack.at(-1);
    if (/^<\//.test(raw)) {
      const tag = raw.match(/^<\/([^\s>]+)/)[1].toLowerCase();
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index > 0) {
        stack[index].closeStart = match.index;
        stack[index].end = token.lastIndex;
        stack.length = index;
      }
    } else if (/^<[a-z]/i.test(raw)) {
      const tag = raw.match(/^<([^\s/>]+)/)[1].toLowerCase();
      const attrs = {}, attrRanges = {};
      const attr = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      const inside = raw.slice(tag.length + 1, -1);
      for (const a of inside.matchAll(attr)) {
        const name = a[1].toLowerCase();
        // Match the browser's first-attribute-wins rule for duplicate attributes.
        if (Object.hasOwn(attrs, name)) continue;
        attrs[name] = decode(a[2] ?? a[3] ?? a[4] ?? '');
        const start = match.index + tag.length + 1 + a.index;
        attrRanges[name] = { start, end: start + a[0].length };
      }
      const node = { tag, attrs, attrRanges, start: match.index, openEnd: token.lastIndex, end: token.lastIndex, children: [], parent };
      parent.children.push(node);
      if (['script', 'style', 'textarea', 'title'].includes(tag)) {
        const end = new RegExp(`</${tag}\\s*>`, 'ig'); end.lastIndex = token.lastIndex;
        const close = end.exec(source);
        const stop = close?.index ?? source.length;
        node.children.push({ raw: source.slice(token.lastIndex, stop), parent: node });
        token.lastIndex = close ? end.lastIndex : source.length;
        node.closeStart = stop;
        node.end = token.lastIndex;
      } else if (!voids.has(tag) && !raw.endsWith('/>')) stack.push(node);
    } else parent.children.push({ raw, parent });
  }
  return root;
}
export const hasClass = (node, name) => node.attrs?.class?.split(/\s+/).includes(name);
export function descendants(node, predicate) {
  return node.children.flatMap(child => child.tag ? [...(predicate(child) ? [child] : []), ...descendants(child, predicate)] : []);
}
export function textContent(node) {
  const rawText = item => item.raw !== undefined ? (/^<!/.test(item.raw) ? '' : item.raw) : item.children.map(rawText).join('');
  return decode(rawText(node)).replace(/\s+/g, ' ').trim();
}
