// Draw a set of nodes on a grid (explicit col/row, or automatic layers). Shared by most graph-like types.
import { gridPositions } from './grid.mjs';
import { drawNode, cardSize } from './scene.mjs';
import { textWidth } from './theme.mjs';

export function drawGraph(scene, nodes, edges, o = {}) {
  const { dir = 'down', size = cardSize, shape = () => 'card', minGapX = 70, gapY = 56, ox = 0, oy = 0, prefix = '', sizeNodes = nodes, sizeEdges = edges } = o;
  const grid = o.grid || gridPositions(nodes, edges, dir);
  const sizes = sizeNodes.map(size), cardSizes = sizeNodes.filter((n) => shape(n) === 'card').map(size);
  const cellW = Math.max(...sizes.map((s) => s.w)), cellH = Math.max(...sizes.map((s) => s.h));
  const cardW = cardSizes.length ? Math.max(...cardSizes.map((s) => s.w)) : cellW;
  // Each gap between two columns is only as wide as the labels that have to sit in it.
  const gaps = Array.from({ length: Math.max(0, Math.ceil(grid.cols) - 1) }, () => minGapX);
  for (const e of sizeEdges) {
    const a = grid.cells.get(e.from), b = grid.cells.get(e.to);
    if (!e.label || !a || !b || Math.floor(a.col) === Math.floor(b.col)) continue;
    const lo = Math.floor(Math.min(a.col, b.col)), hi = Math.ceil(Math.max(a.col, b.col));
    const need = Math.min(200, textWidth(e.label, 10, true) + 46) / (hi - lo);
    for (let g = lo; g < hi && g < gaps.length; g++) gaps[g] = Math.max(gaps[g], need);
  }
  const xs = [0]; gaps.forEach((g, i) => xs.push(xs[i] + cellW + g));
  const xOf = (col) => { const f = Math.floor(col), t = col - f; return xs[f] + (t ? t * ((xs[f + 1] ?? xs[f] + cellW + minGapX) - xs[f]) : 0); };
  for (const n of nodes) {
    const cell = grid.cells.get(n.id), s = size(n), sh = shape(n), w = sh === 'card' ? cardW : s.w;
    drawNode(scene, { id: prefix + n.id, x: ox + xOf(cell.col) + (cellW - w) / 2, y: oy + cell.row * (cellH + gapY) + (cellH - s.h) / 2, w, h: s.h, label: n.label, sub: n.sub, delta: o.delta ? o.delta(n) : n.delta, shape: sh });
  }
  return { grid, w: xOf(grid.cols - 1) + cellW, h: (grid.rows - 1) * (cellH + gapY) + cellH, cellW, cellH };
}
