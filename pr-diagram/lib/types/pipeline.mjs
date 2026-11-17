import { obj, arr, str, enm, req, id, checkShape, checkRef } from '../shape.mjs';
import { base, delta, edgeFields, edgeTone, checkEdges } from '../common.mjs';
import { Scene, pickMode, drawNode, cardSize, caption, capWidth, notePanel } from '../scene.mjs';
import { routeEdges } from '../route.mjs';
import { textWidth, C, r1 } from '../theme.mjs';

export const name = 'pipeline';
export const label = 'Pipeline';
export const when = 'CI, deploy, build, cron or data-job changes';
export const question = 'Which stage changed, and what gates it?';

export const spec = obj({
  ...base(name),
  stages: req(arr(obj({ label: req(str({ max: 20 })), jobs: req(arr(obj({ id: req(id()), label: req(str({ max: 28 })), sub: str({ max: 30 }), delta: delta() }), { min: 1, max: 5 })) }), { min: 2, max: 6 })),
  edges: arr(obj(edgeFields()), { max: 30 }),
  notesTitle: str({ max: 40 }),
  notes: arr(obj({ text: req(str({ max: 160 })), tone: enm(['added', 'changed', 'removed']) }), { max: 6 })
});

const jobsOf = (doc) => doc.stages.flatMap((s) => s.jobs);
function edgesOf(doc) {
  if (doc.edges) return doc.edges;
  // Default: every job feeds every job of the next stage.
  const out = [];
  doc.stages.slice(1).forEach((stage, i) => { for (const a of doc.stages[i].jobs) for (const b of stage.jobs) out.push({ from: a.id, to: b.id, delta: a.delta === 'added' || b.delta === 'added' ? 'added' : a.delta === 'removed' || b.delta === 'removed' ? 'removed' : undefined }); });
  return out;
}

export function validate(doc, issues) {
  checkShape(doc, spec, '', issues);
  if (issues.length) return;
  const jobs = new Map();
  doc.stages.forEach((s, si) => s.jobs.forEach((j, ji) => { if (jobs.has(j.id)) issues.push({ level: 'error', message: `stages[${si}].jobs[${ji}].id: "${j.id}" is used twice` }); jobs.set(j.id, j); }));
  (doc.edges || []).forEach((e, i) => { checkRef(e.from, jobs, `edges[${i}].from`, issues, 'job'); checkRef(e.to, jobs, `edges[${i}].to`, issues, 'job'); });
  checkEdges(doc.edges, 'edges', issues);
  if (!doc.edges) doc.stages.slice(1).forEach((s, i) => { if (s.jobs.length * doc.stages[i].jobs.length > 6) issues.push({ level: 'error', message: `stages[${i + 1}]: too many connections to draw by default between "${doc.stages[i].label}" and "${s.label}"; list the real ones in edges` }); });
}

export function render(doc) {
  const scene = new Scene(doc, label);
  const jobs = jobsOf(doc), edges = edgesOf(doc);
  scene.mode = pickMode(doc, jobs.map((j) => j.delta || 'unchanged'));
  const stageOf = new Map(doc.stages.flatMap((st, i) => st.jobs.map((j) => [j.id, i])));
  const gapAfter = (i) => Math.min(200, Math.max(48, ...edges.filter((e) => e.label && Math.min(stageOf.get(e.from), stageOf.get(e.to)) === i).map((e) => textWidth(e.label, 10, true) + 46)));
  const gapY = edges.some((e) => e.label && stageOf.get(e.from) === stageOf.get(e.to)) ? 52 : 30, top = 44;
  const tallest = Math.max(...doc.stages.map((s) => s.jobs.reduce((h, j) => h + cardSize(j).h, 0) + (s.jobs.length - 1) * gapY));
  let x = 0;
  for (const [si, stage] of doc.stages.entries()) {
    const w = Math.max(capWidth(stage.label) + 8, ...stage.jobs.map((j) => cardSize(j).w));
    caption(scene, x, 14, stage.label);
    scene.add(`<path d="M${r1(x)} 24H${r1(x + w)}" stroke="#333a46"/>`);
    const h = stage.jobs.reduce((sum, j) => sum + cardSize(j).h, 0) + (stage.jobs.length - 1) * gapY;
    let y = top + (tallest - h) / 2;
    for (const j of stage.jobs) { const s = cardSize(j); drawNode(scene, { id: j.id, x, y, w, h: s.h, label: j.label, sub: j.sub, delta: j.delta }); y += s.h + gapY; }
    x += w + gapAfter(si);
  }
  const byId = new Map(jobs.map((j) => [j.id, j]));
  routeEdges(scene, edges.map((e) => ({ from: e.from, to: e.to, label: e.label, ...edgeTone(scene, e, (end) => byId.get(end)?.delta) })), { prefer: 'h' });
  if (doc.notes?.length) notePanel(scene, scene.h + 26, Math.max(scene.w, 480), doc.notesTitle || 'What changes for you', doc.notes.map((n) => ({ text: n.text, tone: n.tone, mark: '·' })));
  return scene;
}
