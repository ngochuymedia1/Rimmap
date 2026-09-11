import { buildPatchHistoryEntry, diffHistoryElement } from '../src/state/history-core';
import type { LayerGroupNode, MediaElement, RectangleElement } from '../src/model/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mediaBefore: MediaElement = {
  id: 'media-a', type: 'media', x: 10, y: 20, width: 320, height: 180,
  assetId: 'asset-large', mime: 'image/png', name: 'Large media', color: '#111827', thickness: 1,
};
const mediaAfter: MediaElement = { ...mediaBefore, x: 35, y: 15 };
const mediaPatch = diffHistoryElement(mediaBefore, mediaAfter);
assert(mediaPatch, 'media move should create a patch');
assert(Object.keys(mediaPatch.before).sort().join(',') === 'x,y', 'media move should store only x/y before values');
assert(Object.keys(mediaPatch.after).sort().join(',') === 'x,y', 'media move should store only x/y after values');
assert(!('assetId' in mediaPatch.before) && !('assetId' in mediaPatch.after), 'unchanged asset reference leaked into movement history patch');

const rectBefore: RectangleElement = {
  id: 'rect-a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60,
  borderRadius: 8, color: '#111827', thickness: 2,
};
const rectAfter: RectangleElement = { ...rectBefore, color: '#ff0000', thickness: 7 };
const stylePatch = diffHistoryElement(rectBefore, rectAfter);
assert(stylePatch, 'style change should create a patch');
assert(Object.keys(stylePatch.before).sort().join(',') === 'color,thickness', 'style patch contains unrelated fields');

const before = new Map([
  ['media-a', { element: mediaBefore, index: 0 }],
  ['rect-a', { element: rectBefore, index: 1 }],
]);
const after = new Map([
  ['media-a', { element: mediaAfter, index: 0 }],
  ['rect-a', { element: rectAfter, index: 1 }],
  ['rect-b', { element: { ...rectBefore, id: 'rect-b' }, index: 2 }],
]);
const entry = buildPatchHistoryEntry({ id: 1, before, after, orderTouched: false });
assert(entry, 'patch history entry should be created');
assert(entry.patches.length === 2, 'expected two changed-element patches');
assert(entry.inserted.length === 1 && entry.inserted[0].element.id === 'rect-b', 'insert should be stored once with its index');
assert(entry.removed.length === 0, 'unexpected removal');

const deleteEntry = buildPatchHistoryEntry({
  id: 2,
  before: new Map([['media-a', { element: mediaBefore, index: 0 }]]),
  after: new Map([['media-a', { element: null, index: -1 }]]),
  orderTouched: false,
});
assert(deleteEntry?.removed.length === 1, 'delete should retain only the removed element');
assert(deleteEntry.removed[0].element === mediaBefore, 'delete history should retain the existing element reference, not clone it');

const reorderEntry = buildPatchHistoryEntry({
  id: 3,
  before: new Map(),
  after: new Map(),
  orderTouched: true,
  orderBefore: ['a', 'b', 'c'],
  orderAfter: ['c', 'a', 'b'],
});
assert(reorderEntry, 'reorder should create an entry');
assert(reorderEntry.patches.length === 0 && reorderEntry.inserted.length === 0 && reorderEntry.removed.length === 0, 'reorder should not copy elements');
assert(reorderEntry.orderBefore?.join(',') === 'a,b,c', 'reorder before IDs missing');
assert(reorderEntry.orderAfter?.join(',') === 'c,a,b', 'reorder after IDs missing');


const groupsBefore: LayerGroupNode[] = [{ id: 'g1', name: 'Inner' }];
const groupsAfter: LayerGroupNode[] = [
  { id: 'g1', name: 'Inner', parentGroupId: 'g2' },
  { id: 'g2', name: 'Outer' },
];
const groupEntry = buildPatchHistoryEntry({
  id: 4,
  before: new Map(),
  after: new Map(),
  orderTouched: false,
  layerGroupsTouched: true,
  layerGroupsBefore: groupsBefore,
  layerGroupsAfter: groupsAfter,
});
assert(groupEntry, 'Layer-group structure change should create history');
assert(groupEntry.layerGroupsBefore === groupsBefore && groupEntry.layerGroupsAfter === groupsAfter, 'history should retain structural group snapshots by reference, not clone the board');
assert(groupEntry.patches.length === 0 && groupEntry.inserted.length === 0 && groupEntry.removed.length === 0, 'group-only history should not fabricate element patches');

console.log('OK: patch history stores changed element fields plus compact Layer-group structure snapshots; media asset references stay out of unrelated movement patches.');
