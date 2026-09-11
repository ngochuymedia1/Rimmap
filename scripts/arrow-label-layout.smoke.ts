import { ARROW_LABEL_MAX_WIDTH, ARROW_LABEL_PATH_WIDTH_RATIO, arrowLabelWidthLimit } from '../src/arrows/label-layout';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const small = arrowLabelWidthLimit(240, 20);
const medium = arrowLabelWidthLimit(600, 20);
const long = arrowLabelWidthLimit(1600, 20);
const largeFontShortArrow = arrowLabelWidthLimit(120, 34);

assert(Math.abs(small - Math.max(20 * 4.25, 240 * ARROW_LABEL_PATH_WIDTH_RATIO)) < 0.001, 'Short connector width should follow the deterministic path/font policy.');
assert(medium > small, 'Longer connectors should grant more horizontal label space.');
assert(long === ARROW_LABEL_MAX_WIDTH, 'Very long connectors should stop at the hard maximum.');
assert(largeFontShortArrow >= 34 * 4.25, 'Large labels need a font-relative minimum width on short connectors.');
assert(arrowLabelWidthLimit(600, 20) === medium, 'Width policy must be deterministic.');

console.log('OK: arrow-label wrap width scales deterministically with connector length and font size.');
