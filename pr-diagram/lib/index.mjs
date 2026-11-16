import * as architecture from './types/architecture.mjs';
import { finalize } from './scene.mjs';

export const TYPES = [architecture];
const byName = () => new Map(TYPES.map((t) => [t.name, t]));

export function validate(doc) {
  const issues = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [{ level: 'error', message: 'document: must be a JSON object' }];
  const type = byName().get(doc.type);
  if (!type) return [{ level: 'error', message: `type: must be one of: ${TYPES.map((t) => t.name).join(', ')}` }];
  type.validate(doc, issues);
  return issues;
}

// Returns { svg, width, height, issues }. svg is absent when the document has errors.
export function render(doc) {
  const issues = validate(doc);
  if (issues.some((i) => i.level === 'error')) return { issues };
  const scene = byName().get(doc.type).render(doc);
  const out = finalize(scene);
  const all = [...issues, ...scene.issues];
  return all.some((i) => i.level === 'error') ? { issues: all, draft: out } : { ...out, issues: all };
}
