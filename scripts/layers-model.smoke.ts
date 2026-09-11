import type { RectangleElement } from '../src/model/types';
import {
  buildLayerPanelRows,
  canGroupLayerSelection,
  getDescendantElementIds,
  groupLayerSelection,
  ungroupLayerSelection,
} from '../src/layers/model';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rect(id: string, parentGroupId?: string): RectangleElement {
  return {
    id, type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
    borderRadius: 8, color: '#111827', thickness: 2,
    ...(parentGroupId ? { parentGroupId } : {}),
  };
}

const base = [rect('a'), rect('outside'), rect('b'), rect('c')];
assert(canGroupLayerSelection(base, [], ['a', 'b']), 'two root elements should be groupable');
const first = groupLayerSelection(base, [], ['a', 'b'], { id: 'g1', name: 'Pair' });
assert(first.changed, 'first group should be created');
assert(first.elements.map(el => el.id).join(',') === 'a,outside,b,c', 'grouping must not change canvas z-order');
assert(getDescendantElementIds(first.elements, first.groups, 'g1').sort().join(',') === 'a,b', 'group descendants are wrong');

// Selecting the complete existing group plus a sibling root creates a real nested group.
assert(canGroupLayerSelection(first.elements, first.groups, ['a', 'b', 'c']), 'complete group plus sibling should be groupable');
const nested = groupLayerSelection(first.elements, first.groups, ['a', 'b', 'c'], { id: 'g2', name: 'Outer' });
assert(nested.changed, 'nested group should be created');
assert(nested.groups.find(group => group.id === 'g1')?.parentGroupId === 'g2', 'existing group should become a child group');
assert(nested.elements.find(el => el.id === 'c')?.parentGroupId === 'g2', 'sibling should become a direct child of nested group');
assert(getDescendantElementIds(nested.elements, nested.groups, 'g2').sort().join(',') === 'a,b,c', 'nested descendants are wrong');
assert(nested.elements.map(el => el.id).join(',') === 'a,outside,b,c', 'nesting must preserve interleaved z-order');

const rows = buildLayerPanelRows(
  nested.elements,
  nested.groups,
  new Set<string>(),
  '',
  element => `${element.type} ${element.name ?? element.id}`,
);
assert(rows.some(row => row.kind === 'group' && row.id === 'g2' && row.depth === 0), 'outer group row missing');
assert(rows.some(row => row.kind === 'group' && row.id === 'g1' && row.depth === 1), 'nested group row missing');
assert(rows.some(row => row.kind === 'element' && row.id === 'a' && row.depth === 2), 'nested leaf depth is wrong');

const collapsed = buildLayerPanelRows(nested.elements, nested.groups, new Set(['g2']));
assert(collapsed.some(row => row.kind === 'group' && row.id === 'g2'), 'collapsed group row should remain visible');
assert(!collapsed.some(row => row.id === 'g1' || row.id === 'a' || row.id === 'b' || row.id === 'c'), 'collapsed descendants should be hidden from the Layers tree');

const searchThroughCollapse = buildLayerPanelRows(
  nested.elements,
  nested.groups,
  new Set(['g2']),
  'rectangle',
  element => `${element.type} ${element.name ?? ''}`,
);
assert(searchThroughCollapse.some(row => row.kind === 'element' && row.id === 'a'), 'search should reveal matches inside collapsed groups');

const withHiddenDescendant = nested.elements.map(element => element.id === 'a' ? { ...element, hidden: true } : element);
const ungroupedOuter = ungroupLayerSelection(withHiddenDescendant, nested.groups, ['b', 'c'], 'g2');
assert(ungroupedOuter.changed, 'exact outer group selection should ungroup even when a hidden descendant is not in selectedIds');
assert(!ungroupedOuter.groups.some(group => group.id === 'g2'), 'empty outer group should be removed');
assert(ungroupedOuter.groups.find(group => group.id === 'g1')?.parentGroupId === undefined, 'child group should move up one level');
assert(ungroupedOuter.elements.find(el => el.id === 'c')?.parentGroupId === undefined, 'direct child should move up one level');
assert(ungroupedOuter.elements.map(el => el.id).join(',') === 'a,outside,b,c', 'ungrouping must preserve canvas z-order');

console.log('OK: real Layer-group model supports grouping, nesting, collapse/search projection, ungrouping, and exact z-order preservation.');
