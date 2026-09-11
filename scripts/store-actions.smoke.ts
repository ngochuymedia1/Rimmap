import { appState, dispatch } from '../src/state/store';
import type { ArrowElement, RectangleElement } from '../src/model/types';

function assertEqual(actual: unknown, expected: unknown, message = 'assertion failed') {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const rectangle: RectangleElement = {
  id: 'rect-a', type: 'rectangle', x: 10, y: 20, width: 100, height: 60,
  borderRadius: 8, color: '#111827', thickness: 2, name: 'Card',
};

dispatch({ type: 'REPLACE_ELEMENTS', elements: [] });
dispatch({ type: 'SET_SELECTION', ids: [] });
dispatch({ type: 'ADD_ELEMENT', element: rectangle });
rectangle.x = 999;
assertEqual(appState.elements[0]?.type === 'rectangle' ? appState.elements[0].x : -1, 10, 'store must own incoming elements');

dispatch({ type: 'SET_SELECTION', ids: ['rect-a'] });
dispatch({ type: 'MOVE_ELEMENTS', ids: ['rect-a'], delta: { x: 5, y: -4 } });
let rect = appState.elements.find(el => el.id === 'rect-a');
assertEqual(rect?.type === 'rectangle' ? rect.x : -1, 15);
assertEqual(rect?.type === 'rectangle' ? rect.y : -1, 16);

dispatch({ type: 'UPDATE_STYLE', ids: ['rect-a'], patch: { color: '#ff0000', thickness: 7 } });
rect = appState.elements.find(el => el.id === 'rect-a');
assertEqual(rect?.color, '#ff0000');
assertEqual(rect?.thickness, 7);

dispatch({ type: 'LOCK_ELEMENTS', ids: ['rect-a'], locked: true, preserveSelection: true });
assertEqual(appState.elements.find(el => el.id === 'rect-a')?.locked, true);

dispatch({ type: 'SET_SELECTION', ids: ['rect-a'] });
dispatch({ type: 'SET_ELEMENTS_HIDDEN', ids: ['rect-a'], hidden: true });
assertEqual(appState.elements.find(el => el.id === 'rect-a')?.hidden, true, 'visibility action should hide the element');
assertEqual(appState.elements.find(el => el.id === 'rect-a')?.locked, true, 'visibility must not change lock state');
assertEqual(appState.selectedIds.includes('rect-a'), false, 'hiding should remove the element from selection');
dispatch({ type: 'SET_ELEMENTS_HIDDEN', ids: ['rect-a'], hidden: false });
assertEqual(appState.elements.find(el => el.id === 'rect-a')?.hidden, false, 'visibility action should show the element again');
assertEqual(appState.elements.find(el => el.id === 'rect-a')?.locked, true, 'showing must not unlock the element');

const arrow: ArrowElement = {
  id: 'arrow-a', type: 'arrow', start: { x: 0, y: 0 }, control: { x: 50, y: 0 }, controls: [{ x: 50, y: 0 }],
  pointCount: 3, end: { x: 100, y: 0 }, style: 'arrow', color: '#111827', thickness: 2,
};
dispatch({ type: 'CREATE_ARROW', arrow });
assertEqual(appState.elements.some(el => el.id === 'arrow-a'), true);

dispatch({ type: 'ADD_ELEMENT', element: { id: 'stroke-a', type: 'freehand', points: [{ x: 0, y: 0 }], color: '#111827', thickness: 2 } });
dispatch({ type: 'APPEND_FREEHAND_POINT', id: 'stroke-a', point: { x: 2, y: 3 } });
const stroke = appState.elements.find(el => el.id === 'stroke-a');
assertEqual(stroke?.type === 'freehand' ? stroke.points.length : 0, 2);

dispatch({ type: 'DELETE_ELEMENTS', ids: ['arrow-a', 'stroke-a'] });
assertEqual(appState.elements.some(el => el.id === 'arrow-a' || el.id === 'stroke-a'), false);


// First-class Layer groups are structural document state, independent from element z-order.
const groupElements: RectangleElement[] = [
  { id: 'ga', type: 'rectangle', x: 0, y: 0, width: 30, height: 30, borderRadius: 2, color: '#000', thickness: 1 },
  { id: 'between', type: 'rectangle', x: 5, y: 5, width: 30, height: 30, borderRadius: 2, color: '#000', thickness: 1 },
  { id: 'gb', type: 'rectangle', x: 10, y: 10, width: 30, height: 30, borderRadius: 2, color: '#000', thickness: 1 },
  { id: 'gc', type: 'rectangle', x: 15, y: 15, width: 30, height: 30, borderRadius: 2, color: '#000', thickness: 1 },
];
dispatch({ type: 'REPLACE_DOCUMENT', elements: groupElements, layerGroups: [] });
dispatch({ type: 'GROUP_LAYER_SELECTION', ids: ['ga', 'gb'], group: { id: 'g1', name: 'Pair' } });
assertEqual(appState.elements.map(el => el.id).join(','), 'ga,between,gb,gc', 'grouping must preserve canvas z-order');
assertEqual(appState.layerGroups.length, 1, 'group action should create a first-class group node');
assertEqual(appState.elements.find(el => el.id === 'ga')?.parentGroupId, 'g1', 'group member should reference its parent group');
assertEqual(appState.selectedLayerGroupId, 'g1', 'new group should become the exact selected Layer group');

dispatch({ type: 'GROUP_LAYER_SELECTION', ids: ['ga', 'gb', 'gc'], group: { id: 'g2', name: 'Outer' } });
assertEqual(appState.layerGroups.find(group => group.id === 'g1')?.parentGroupId, 'g2', 'existing complete group should nest under the new group');
assertEqual(appState.elements.find(el => el.id === 'gc')?.parentGroupId, 'g2', 'sibling element should become a direct child of nested group');
dispatch({ type: 'RENAME_LAYER_GROUP', id: 'g1', name: 'Inner' });
assertEqual(appState.layerGroups.find(group => group.id === 'g1')?.name, 'Inner', 'group rename should update structural metadata');
dispatch({ type: 'UNGROUP_LAYER_SELECTION', ids: ['ga', 'gb', 'gc'], preferredGroupId: 'g2' });
assertEqual(appState.layerGroups.some(group => group.id === 'g2'), false, 'ungroup should remove an empty group node');
assertEqual(appState.layerGroups.find(group => group.id === 'g1')?.parentGroupId, undefined, 'nested child group should move up one level');
assertEqual(appState.elements.find(el => el.id === 'gc')?.parentGroupId, undefined, 'direct child should move up one level');
assertEqual(appState.elements.map(el => el.id).join(','), 'ga,between,gb,gc', 'ungrouping must preserve canvas z-order');

// Duplicate/paste intentionally add cloned elements before their cloned group nodes.
// Parent references must survive that short intermediate state and become valid as
// soon as ADD_LAYER_GROUPS lands; otherwise nested clipboard duplication breaks.
const clonedHierarchyElements: RectangleElement[] = [
  { id: 'copy-a', type: 'rectangle', x: 40, y: 40, width: 30, height: 30, borderRadius: 2, color: '#000', thickness: 1, parentGroupId: 'copy-inner' },
  { id: 'copy-b', type: 'rectangle', x: 50, y: 50, width: 30, height: 30, borderRadius: 2, color: '#000', thickness: 1, parentGroupId: 'copy-inner' },
  { id: 'copy-c', type: 'rectangle', x: 60, y: 60, width: 30, height: 30, borderRadius: 2, color: '#000', thickness: 1, parentGroupId: 'copy-outer' },
];
dispatch({ type: 'ADD_ELEMENTS', elements: clonedHierarchyElements });
assertEqual(appState.elements.find(el => el.id === 'copy-a')?.parentGroupId, 'copy-inner', 'ADD_ELEMENTS must not discard pending cloned group membership');
dispatch({ type: 'ADD_LAYER_GROUPS', groups: [
  { id: 'copy-inner', name: 'Copied Inner', parentGroupId: 'copy-outer' },
  { id: 'copy-outer', name: 'Copied Outer' },
] });
assertEqual(appState.layerGroups.find(group => group.id === 'copy-inner')?.parentGroupId, 'copy-outer', 'cloned nested group relationship should survive insertion');
assertEqual(appState.elements.find(el => el.id === 'copy-a')?.parentGroupId, 'copy-inner', 'cloned element should remain in cloned inner group');
assertEqual(appState.elements.find(el => el.id === 'copy-c')?.parentGroupId, 'copy-outer', 'cloned direct child should remain in cloned outer group');

// Reset before testing low-level history replay actions.
dispatch({ type: 'REPLACE_DOCUMENT', elements: [], layerGroups: [] });


// History replay primitives restore only affected elements/order.
dispatch({ type: 'INSERT_ELEMENT_AT', index: 0, element: { id: 'rect-b', type: 'rectangle', x: 1, y: 2, width: 20, height: 10, borderRadius: 2, color: '#000', thickness: 1 } });
assertEqual(appState.elements[0]?.id, 'rect-b');
dispatch({ type: 'APPLY_ELEMENT_PATCH', id: 'rect-b', patch: { x: 9, color: '#00ff00' } });
const rectB = appState.elements.find(el => el.id === 'rect-b');
assertEqual(rectB?.type === 'rectangle' ? rectB.x : -1, 9);
assertEqual(rectB?.color, '#00ff00');
const orderBeforeReplay = appState.elements.map(el => el.id);
dispatch({ type: 'REORDER_BY_IDS', order: [...orderBeforeReplay].reverse() });
assertEqual(appState.elements.map(el => el.id).join(','), [...orderBeforeReplay].reverse().join(','));

console.log('OK: central document actions mutate store-owned state as expected.');
