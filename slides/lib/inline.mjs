import { readFile, readdir, realpath } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseHTML, descendants, escape } from './html.mjs';
const mime = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon' };
const data = (body, type) => `data:${type};base64,${Buffer.from(body).toString('base64')}`;

function resolver(root) {
  return async (reference, base) => {
    // URL normalisation removes the localhost authority from file://localhost/.
    // Reject it before parsing, along with protocol-relative hosts and UNC paths.
    if (/^(?:[a-z][a-z\d+.-]*:)?[\\/]{2}[^\\/]/i.test(reference.trim())) throw new Error(`Cannot bundle non-local asset with a host: ${reference}`);
    const url = new URL(reference, base);
    if (url.host) throw new Error(`Cannot bundle non-local asset with a host: ${reference}`);
    if (url.protocol !== 'file:') throw new Error(`Cannot bundle non-local asset: ${reference}`);
    let file;
    try { file = await realpath(fileURLToPath(url)); }
    catch (error) { throw new Error(`Cannot bundle asset ${reference}: ${error.message}`); }
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Cannot bundle asset outside the deck folder: ${reference}`);
    return { url, file };
  };
}
async function replaceAsync(source, expression, transform) {
  const matches = [...source.matchAll(expression)];
  for (const match of matches.reverse()) source = source.slice(0, match.index) + await transform(match) + source.slice(match.index + match[0].length);
  return source;
}
function splice(source, replacements) {
  for (const { start, end, value } of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, start) + value + source.slice(end);
  return source;
}
async function svgResources(node, base, resolve, chain, attribute) {
  if (!['image', 'feimage', 'use'].includes(node.tag)) return;
  for (const name of ['href', 'xlink:href']) {
    const reference = node.attrs[name]?.trim();
    if (!reference || reference.startsWith('#')) continue;
    if (node.tag === 'use') {
      // Chromium forbids data: URLs for <use>. Check confinement first, then
      // fail rather than silently retaining a file dependency or broken URI.
      if (!/^data:/i.test(reference)) await resolve(reference, base);
      throw new Error(`Cannot bundle external SVG <use> reference: ${reference}; embed the sprite in the deck and use a #fragment reference instead`);
    }
    const value = await asset(reference, base, resolve, chain);
    if (value !== reference) attribute(node, name, value);
  }
}
async function asset(reference, base, resolve, chain = new Set()) {
  if (/^(data:|#)/i.test(reference)) return reference;
  const { url, file } = await resolve(reference, base);
  const extension = path.extname(url.pathname).toLowerCase();
  let body = await readFile(file);
  if (extension === '.svg') {
    if (chain.has(file)) throw new Error(`Circular SVG resource: ${reference}`);
    const source = body.toString('utf8'), replacements = [];
    for (const node of descendants(parseHTML(source), () => true)) {
      await svgResources(node, url, resolve, new Set([...chain, file]), (node, name, value) => {
        replacements.push({ ...node.attrRanges[name], value: `${name}="${escape(value)}"` });
      });
    }
    // Re-encode only when something changed, so non-UTF-8 SVGs keep their bytes.
    if (replacements.length) body = Buffer.from(splice(source, replacements));
  }
  return data(body, mime[extension] || 'application/octet-stream') + url.hash;
}
async function bundleCSS(source, base, resolve, chain = new Set()) {
  source = await replaceAsync(source, /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*([^;]*);/gi, async match => {
    const reference = (match[1] || match[2]).trim();
    if (/^data:/i.test(reference)) return match[0];
    const { url, file } = await resolve(reference, base);
    if (chain.has(file)) throw new Error(`Circular CSS import: ${reference}`);
    const css = await bundleCSS(await readFile(file, 'utf8'), url, resolve, new Set([...chain, file]));
    return match[3].trim() ? `@media ${match[3]} {${css}}` : css;
  });
  return replaceAsync(source, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi, async match => `url("${await asset(match[1] ?? match[2] ?? match[3], base, resolve)}")`);
}
export async function inlineCSS(source, base) {
  const root = await realpath(path.dirname(fileURLToPath(base)));
  return bundleCSS(source, base, resolver(root));
}
export async function inlineHTML(file, theme) {
  const base = pathToFileURL(path.resolve(file));
  const root = await realpath(path.dirname(path.resolve(file))), resolve = resolver(root);
  const source = await readFile(file, 'utf8'), tree = parseHTML(source);
  const nodes = descendants(tree, () => true), replacements = [];
  if (nodes.some(node => node.tag === 'meta' && node.attrs['http-equiv']?.trim().toLowerCase() === 'content-security-policy')) {
    throw new Error("HTML export can't keep this deck's Content-Security-Policy; remove the meta tag or export PDF instead");
  }
  const replace = (start, end, value) => replacements.push({ start, end, value });
  const attribute = (node, name, value) => {
    const range = node.attrRanges[name];
    if (range) replace(range.start, range.end, value === null ? '' : `${name}="${escape(value)}"`);
  };
  const baseNodes = nodes.filter(node => node.tag === 'base');
  let resourceBase = base;
  let hasBase = false;
  for (const node of baseNodes) {
    if (node.attrs.href !== undefined) {
      const target = await resolve(node.attrs.href, base);
      if (!hasBase) resourceBase = target.url;
      hasBase = true;
    }
    // All resources become absolute data URIs, so a <base> is no longer useful.
    replace(node.start, node.openEnd, '');
  }
  const themeLink = nodes.find(node => node.tag === 'link' && node.attrs.id === 'theme');
  if (theme && !themeLink) throw new Error('Theme override needs a link with id="theme"');
  const stylesheet = async (reference, from) => {
    if (/^data:/i.test(reference)) return reference;
    const target = await resolve(reference, from);
    return data(await bundleCSS(await readFile(target.file, 'utf8'), target.url, resolve), 'text/css');
  };
  for (const node of nodes) {
    if (node.tag === 'base') continue;
    if (node.tag === 'link' && /\bstylesheet\b/i.test(node.attrs.rel || '')) {
      // Themes always resolve relative to the deck file, independent of <base>.
      const reference = node === themeLink && theme ? `themes/${theme}.css` : node.attrs.href;
      attribute(node, 'href', await stylesheet(reference, node === themeLink ? base : resourceBase));
      attribute(node, 'integrity', null);
    } else if (node.tag === 'link' && node.attrs.href) attribute(node, 'href', await asset(node.attrs.href, resourceBase, resolve));
    if (node.tag === 'style') {
      const css = await bundleCSS(source.slice(node.openEnd, node.closeStart), resourceBase, resolve);
      replace(node.openEnd, node.closeStart, css.replace(/<\/style/gi, '<\\/style'));
    }
    if (node.attrs.style) attribute(node, 'style', await bundleCSS(node.attrs.style, resourceBase, resolve));
    if (node.tag === 'script' && node.attrs.src) {
      attribute(node, 'src', await asset(node.attrs.src, resourceBase, resolve));
      attribute(node, 'integrity', null);
    }
    if (['img', 'source', 'video', 'audio', 'input'].includes(node.tag) && node.attrs.src) attribute(node, 'src', await asset(node.attrs.src, resourceBase, resolve));
    await svgResources(node, resourceBase, resolve, new Set(), attribute);
    if (node.attrs.poster) attribute(node, 'poster', await asset(node.attrs.poster, resourceBase, resolve));
    if (node.attrs.srcset) {
      const entries = node.attrs.srcset.match(/(?:data:[^\s]+|[^\s,]+)(?:[ \t]+[^,]+)?/g) || [];
      const srcset = await Promise.all(entries.map(async entry => {
        const [src, ...descriptor] = entry.trim().split(/\s+/);
        return `${await asset(src.replace(/,$/, ''), resourceBase, resolve)} ${descriptor.join(' ')}`.trim();
      }));
      attribute(node, 'srcset', srcset.join(', '));
    }
  }
  if (themeLink) {
    const themes = {};
    const directory = await resolve('themes/', base);
    for (const name of await readdir(directory.file)) {
      if (!/^[a-z0-9-]{1,40}\.css$/.test(name)) continue;
      themes[name.slice(0, -4)] = await stylesheet(name, directory.url);
    }
    const metadata = `<script type="application/json" id="deck-themes">${JSON.stringify(themes).replaceAll('<', '\\u003c')}</script>`;
    const existing = nodes.find(node => node.attrs.id === 'deck-themes');
    const head = nodes.find(node => node.tag === 'head');
    if (existing) replace(existing.start, existing.end, metadata);
    else {
      // Keep charset declarations near the start, but expose themes before a
      // runtime script in the head can execute (the usual runtime is in body).
      const position = nodes.find(node => node.tag === 'script' && node.parent === head)?.start ?? head?.closeStart ?? head?.openEnd ?? 0;
      replace(position, position, metadata);
    }
  }
  // Preserve all author markup, including omitted closing tags, SVG casing,
  // whitespace and comments. Only resource attributes/elements are replaced.
  return splice(source, replacements);
}
