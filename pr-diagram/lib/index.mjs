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
  const out = finalize(scene);
  const all = [...issues, ...scene.issues];
  return all.some((i) => i.level === 'error') ? { issues: all, draft: out } : { ...out, issues: all };
}
