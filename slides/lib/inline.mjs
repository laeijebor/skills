import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseHTML, descendants, serialize } from './html.mjs';
const mime = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon' };
const data = (body, type) => `data:${type};base64,${Buffer.from(body).toString('base64')}`;
function localURL(reference, base) {
  const url = new URL(reference, base);
  if (url.protocol !== 'file:') throw new Error(`Cannot bundle non-local asset: ${reference}`);
  return url;
}
async function replaceAsync(source, expression, transform) {
  const matches = [...source.matchAll(expression)];
  for (const match of matches.reverse()) source = source.slice(0, match.index) + await transform(match) + source.slice(match.index + match[0].length);
  return source;
}
async function asset(reference, base) {
  if (/^(data:|#)/i.test(reference)) return reference;
  const url = localURL(reference, base);
  const body = await readFile(fileURLToPath(url));
  return data(body, mime[path.extname(url.pathname).toLowerCase()] || 'application/octet-stream') + url.hash;
}
export async function inlineCSS(source, base, chain = new Set()) {
  source = await replaceAsync(source, /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*([^;]*);/gi, async match => {
    const url = localURL((match[1] || match[2]).trim(), base);
    if (chain.has(url.href)) throw new Error(`Circular CSS import: ${url.href}`);
    const css = await inlineCSS(await readFile(url, 'utf8'), url, new Set([...chain, url.href]));
    return match[3].trim() ? `@media ${match[3]} {${css}}` : css;
  });
  return replaceAsync(source, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi, async match => `url("${await asset(match[1] ?? match[2] ?? match[3], base)}")`);
}
export async function inlineHTML(file, theme) {
  const base = pathToFileURL(path.resolve(file)), tree = parseHTML(await readFile(file, 'utf8'));
  const nodes = descendants(tree, () => true);
  // Relative resources become absolute data URIs, so a <base> is no longer useful.
  const baseNode = nodes.find(node => node.tag === 'base');
  const resourceBase = baseNode?.attrs.href ? localURL(baseNode.attrs.href, base) : base;
  if (baseNode) baseNode.parent.children = baseNode.parent.children.filter(node => node !== baseNode);
  const themeLink = nodes.find(node => node.tag === 'link' && node.attrs.id === 'theme');
  if (theme && !themeLink) throw new Error('Theme override needs a link with id="theme"');
  if (theme) themeLink.attrs.href = `themes/${theme}.css`;
  for (const node of nodes) {
    if (node.tag === 'link' && /\bstylesheet\b/i.test(node.attrs.rel || '')) {
      const url = localURL(node.attrs.href, resourceBase);
      node.attrs.href = data(await inlineCSS(await readFile(url, 'utf8'), url), 'text/css');
      delete node.attrs.integrity;
    } else if (node.tag === 'link' && node.attrs.href) node.attrs.href = await asset(node.attrs.href, resourceBase);
    if (node.tag === 'style') node.children = [{ raw: (await inlineCSS(node.children.map(child => child.raw).join(''), resourceBase)).replace(/<\/style/gi, '<\\/style') }];
    if (node.attrs.style) node.attrs.style = await inlineCSS(node.attrs.style, resourceBase);
    if (node.tag === 'script' && node.attrs.src) {
      // Data scripts preserve classic/defer/module attributes without closing-tag escaping.
      node.attrs.src = await asset(node.attrs.src, resourceBase);
      delete node.attrs.integrity;
    }
    if (['img', 'source', 'video', 'audio', 'input'].includes(node.tag) && node.attrs.src) node.attrs.src = await asset(node.attrs.src, resourceBase);
    if (node.attrs.poster) node.attrs.poster = await asset(node.attrs.poster, resourceBase);
    if (node.attrs.srcset) {
      if (!node.attrs.srcset.startsWith('data:')) node.attrs.srcset = (await Promise.all(node.attrs.srcset.split(',').map(async entry => {
        const [src, ...descriptor] = entry.trim().split(/\s+/); return `${await asset(src, resourceBase)} ${descriptor.join(' ')}`.trim();
      }))).join(', ');
    }
  }
  // Preserve ?theme switching in a bundle without filesystem dependencies.
  if (themeLink) {
    const themes = {};
    const directory = new URL('themes/', resourceBase);
    for (const name of await readdir(directory)) {
      if (!/^[a-z0-9-]{1,40}\.css$/.test(name)) continue;
      const url = new URL(name, directory);
      themes[name.slice(0, -4)] = data(await inlineCSS(await readFile(url, 'utf8'), url), 'text/css');
    }
    const head = nodes.find(node => node.tag === 'head');
    head.children.push({ tag: 'script', attrs: { type: 'application/json', id: 'deck-themes' }, children: [{ raw: JSON.stringify(themes).replaceAll('<', '\\u003c') }] });
  }
  return serialize(tree);
}
