// Automatic placement: layers by longest path, then a few ordering sweeps to untangle.
export function autoLayers(ids, edges) {
  const out = new Map(ids.map((i) => [i, []])), inc = new Map(ids.map((i) => [i, []]));
  const real = edges.filter((e) => out.has(e.from) && out.has(e.to) && e.from !== e.to);
  for (const e of real) out.get(e.from).push(e);
  const state = new Map(), back = new Set();
  const dfs = (u) => { state.set(u, 1); for (const e of out.get(u)) { if (state.get(e.to) === 1) back.add(e); else if (!state.get(e.to)) dfs(e.to); } state.set(u, 2); };
  const hasIn = new Set(real.map((e) => e.to));
  for (const i of [...ids.filter((x) => !hasIn.has(x)), ...ids]) if (!state.get(i)) dfs(i);
  const fwd = real.filter((e) => !back.has(e));
  for (const e of fwd) inc.get(e.to).push(e);
  const layer = new Map(ids.map((i) => [i, 0]));
  for (let n = 0; n < ids.length; n++) for (const e of fwd) if (layer.get(e.to) < layer.get(e.from) + 1) layer.set(e.to, layer.get(e.from) + 1);
  const layers = [];
  for (const i of ids) (layers[layer.get(i)] ||= []).push(i);
  const pos = new Map();
  const index = () => layers.forEach((l) => l.forEach((i, k) => pos.set(i, k)));
  index();
  const bary = (i, es, key) => { const ns = es.map((e) => pos.get(e[key])); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : pos.get(i); };
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let l = 1; l < layers.length; l++) { const w = new Map(layers[l].map((i) => [i, bary(i, inc.get(i), 'from')])); layers[l].sort((a, b) => w.get(a) - w.get(b)); index(); }
    for (let l = layers.length - 2; l >= 0; l--) { const w = new Map(layers[l].map((i) => [i, bary(i, out.get(i).filter((e) => !back.has(e)), 'to')])); layers[l].sort((a, b) => w.get(a) - w.get(b)); index(); }
  }
  return layers;
}

// Place nodes on a grid. Every node carries col and row, or none does (then layers decide).
// dir 'down': layers are rows. dir 'right': layers are columns. Returns Map id -> {col,row} and the grid size.
export function gridPositions(nodes, edges, dir = 'down') {
  const explicit = nodes.filter((n) => n.col !== undefined || n.row !== undefined);
  const cells = new Map();
  if (explicit.length) {
    for (const n of nodes) cells.set(n.id, { col: n.col ?? 0, row: n.row ?? 0 });
  } else {
    const layers = autoLayers(nodes.map((n) => n.id), edges);
    const widest = Math.max(...layers.map((l) => l.length));
    layers.forEach((l, li) => l.forEach((i, k) => { const cross = k + (widest - l.length) / 2; cells.set(i, dir === 'down' ? { col: cross, row: li } : { col: li, row: cross }); }));
  }
  const cols = Math.max(...[...cells.values()].map((c) => c.col)) + 1, rows = Math.max(...[...cells.values()].map((c) => c.row)) + 1;
  return { cells, cols, rows, explicit: explicit.length > 0 };
}
export function checkGridFields(nodes, path, issues) {
  const withPos = nodes.filter((n) => n.col !== undefined && n.row !== undefined).length;
  const partial = nodes.some((n) => (n.col === undefined) !== (n.row === undefined));
  if (partial || (withPos && withPos !== nodes.length)) issues.push({ level: 'error', message: `${path}: give col and row to every item, or to none (then they are placed automatically)` });
  const seen = new Set();
  for (const n of nodes) if (n.col !== undefined && n.row !== undefined) { const k = `${n.col},${n.row}`; if (seen.has(k)) issues.push({ level: 'error', message: `${path}: two items share col ${n.col}, row ${n.row}` }); seen.add(k); }
}
