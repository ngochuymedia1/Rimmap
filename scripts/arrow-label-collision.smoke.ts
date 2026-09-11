import { chooseCollisionAvoidedPathLabel } from '../src/arrows/label-collision';
import type { ArrowLabelLayout, Bounds } from '../src/model/types';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const build = (position: number, side: -1 | 1): ArrowLabelLayout => {
  const box = { x: position * 100 - 10, y: side === -1 ? 35 : 55, width: 20, height: 10 };
  return { anchor: { x: position * 100, y: 50 }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, side, textX: box.x, textBaselineY: box.y + 8, textWidth: 20, textHeight: 10, box, fontSize: 14, renderScale: 1, family: 'Montserrat', lines: [] };
};
const obstacle: Bounds = { x: 40, y: 30, width: 20, height: 20 };
const first = chooseCollisionAvoidedPathLabel(build, .5, -1, [obstacle]);
const second = chooseCollisionAvoidedPathLabel(build, .5, -1, [obstacle]);
assert(first.side === 1, 'Collision should prefer the opposite side before shifting path position');
assert(JSON.stringify(first) === JSON.stringify(second), 'Label collision avoidance must be deterministic');
const clear = chooseCollisionAvoidedPathLabel(build, .25, -1, [obstacle]);
assert(clear.side === -1 && Math.abs(clear.anchor.x - 25) < .001, 'Clear authored label placement should be preserved');
console.log('OK: arrow label collision avoidance is deterministic and preserves authored placement when clear.');
