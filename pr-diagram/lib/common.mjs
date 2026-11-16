import { str, enm, req, id } from './shape.mjs';
import { DELTAS } from './theme.mjs';

// Fields every diagram document shares.
export const base = (type) => ({
  type: req(enm([type])),
  title: req(str({ max: 70 })),
  caption: str({ max: 260 }),
  emphasis: enm(['auto', 'changes', 'new'])
});
export const delta = () => enm(DELTAS);
export const edgeFields = () => ({ from: req(str({ max: 100 })), to: req(str({ max: 100 })), label: str({ max: 30 }), delta: delta() });

// An added edge is animated. When the whole area is new, only edges that plug into existing code are.
export function edgeTone(scene, e, deltaOf) {
  const d = e.delta || 'unchanged';
  if (d === 'added' && scene.mode === 'new') {
    const touchesExisting = [e.from, e.to].some((end) => (deltaOf(end) || 'unchanged') === 'unchanged');
    return touchesExisting ? { tone: 'added', flow: true } : { tone: 'neutral' };
  }
  if (d === 'added') return { tone: 'added', flow: true };
  return { tone: d === 'unchanged' ? 'neutral' : d };
}
export const CIRCLED = (n) => String.fromCodePoint(0x245f + n);
