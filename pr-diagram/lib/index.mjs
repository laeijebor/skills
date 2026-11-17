import * as architecture from './types/architecture.mjs';
import * as beforeAfter from './types/before-after.mjs';
import * as decisionFlow from './types/decision-flow.mjs';
import * as stateMachine from './types/state-machine.mjs';
import * as pipeline from './types/pipeline.mjs';
import * as sequence from './types/sequence.mjs';
import * as timeline from './types/timeline.mjs';
import * as dataModel from './types/data-model.mjs';
import * as screenFlow from './types/screen-flow.mjs';
import * as measure from './types/measure.mjs';
import * as changeMap from './types/change-map.mjs';
import { finalize } from './scene.mjs';

export const TYPES = [architecture, sequence, beforeAfter, decisionFlow, stateMachine, timeline, dataModel, screenFlow, measure, pipeline, changeMap];
const byName = () => new Map(TYPES.map((t) => [t.name, t]));

export function validate(doc, opts = {}) {
  const issues = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [{ level: 'error', message: 'document: must be a JSON object' }];
  const type = byName().get(doc.type);
  if (!type) return [{ level: 'error', message: `type: must be one of: ${TYPES.map((t) => t.name).join(', ')}` }];
  type.validate(doc, issues, opts);
  return issues;
}

// Returns { svg, width, height, issues }. svg is absent when the document has errors.
export function render(doc, opts = {}) {
  const issues = validate(doc, opts);
  if (issues.some((i) => i.level === 'error')) return { issues };
  const scene = byName().get(doc.type).render(doc, opts);
  // Two cards on top of each other usually means col/row values that are too close.
  const cards = [...scene.boxes.values()].filter((b) => b.obstacle && !b.parent);
  cards.forEach((a, i) => cards.slice(i + 1).forEach((b) => {
    if (a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1) scene.error(`"${a.name || a.id}" and "${b.name || b.id}" overlap; give them col/row values at least 1 apart`);
  }));
  const out = finalize(scene);
  const all = [...issues, ...scene.issues];
  return all.some((i) => i.level === 'error') ? { issues: all, draft: out } : { ...out, issues: all };
}
