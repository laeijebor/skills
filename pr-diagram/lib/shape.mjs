// A small strict validator: unknown keys are errors, so a typo never silently drops a field.
export const str = (o = {}) => ({ t: 'str', max: 80, ...o });
export const int = (o = {}) => ({ t: 'int', ...o });
export const num = (o = {}) => ({ t: 'num', ...o });
export const bool = (o = {}) => ({ t: 'bool', ...o });
export const enm = (values, o = {}) => ({ t: 'enum', values, ...o });
export const arr = (item, o = {}) => ({ t: 'arr', item, ...o });
export const obj = (fields, o = {}) => ({ t: 'obj', fields, ...o });
export const req = (spec) => ({ ...spec, required: true });
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const id = (o = {}) => str({ pattern: ID, max: 48, what: 'an id (letters, digits, . _ -)', ...o });

export function checkShape(value, spec, path, issues) {
  const fail = (m) => issues.push({ level: 'error', message: `${path || 'document'}: ${m}` });
  switch (spec.t) {
    case 'str':
      if (typeof value !== 'string') return fail('must be a string');
      if (!value.trim() && !spec.empty) return fail('must not be empty');
      if (value.length > spec.max) return fail(`is ${value.length} characters; the limit is ${spec.max}`);
      if (spec.pattern && !spec.pattern.test(value)) return fail(`must be ${spec.what || 'in the expected format'}`);
      return;
    case 'int':
    case 'num':
      if (typeof value !== 'number' || !Number.isFinite(value) || (spec.t === 'int' && !Number.isInteger(value))) return fail(spec.t === 'int' ? 'must be a whole number' : 'must be a number');
      if (spec.min !== undefined && value < spec.min) return fail(`must be at least ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) return fail(`must be at most ${spec.max}`);
      return;
    case 'bool':
      if (typeof value !== 'boolean') fail('must be true or false');
      return;
    case 'enum':
      if (!spec.values.includes(value)) fail(`must be one of: ${spec.values.join(', ')}`);
      return;
    case 'arr':
      if (!Array.isArray(value)) return fail('must be a list');
      if (value.length < (spec.min ?? 0)) return fail(`needs at least ${spec.min} item${spec.min === 1 ? '' : 's'}`);
      if (spec.max !== undefined && value.length > spec.max) return fail(`has ${value.length} items; the limit is ${spec.max}`);
      value.forEach((v, i) => checkShape(v, spec.item, `${path}[${i}]`, issues));
      return;
    case 'obj': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('must be an object');
      for (const key of Object.keys(value)) if (!(key in spec.fields)) fail(`unknown field "${key}" (allowed: ${Object.keys(spec.fields).join(', ')})`);
      for (const [key, sub] of Object.entries(spec.fields)) {
        if (value[key] === undefined) { if (sub.required) issues.push({ level: 'error', message: `${path ? path + '.' : ''}${key}: is required` }); continue; }
        checkShape(value[key], sub, `${path ? path + '.' : ''}${key}`, issues);
      }
      return;
    }
    default: throw new Error(`unknown spec ${spec.t}`);
  }
}

// Ids unique within a list; returns a Map id -> item.
export function indexById(list, path, issues) {
  const map = new Map();
  (list || []).forEach((item, i) => {
    if (item && typeof item.id === 'string') {
      if (map.has(item.id)) issues.push({ level: 'error', message: `${path}[${i}].id: "${item.id}" is used twice` });
      else map.set(item.id, item);
    }
  });
  return map;
}
export function checkRef(value, map, path, issues, what = 'id') {
  if (typeof value === 'string' && !map.has(value)) issues.push({ level: 'error', message: `${path}: "${value}" is not a declared ${what} (declared: ${[...map.keys()].slice(0, 12).join(', ') || 'none'})` });
}
