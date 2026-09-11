const path = require('node:path');
const Module = require('node:module');

const compiledRoot = process.argv[2];
if (!compiledRoot) throw new Error('compiled root argument required');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../layers/index') return { requestLayersPanelRefresh() {} };
  if (request === '../persistence/index') return { hydrateMediaElements() {}, saveToLocal() {} };
  if (request === '../renderer/index') return { redraw() {} };
  if (request === '../text-editor/index') return { closeTextEditor() {} };
  return originalLoad.call(this, request, parent, isMain);
};

global.document = { getElementById() { return null; } };

const { appState, dispatch } = require(path.join(compiledRoot, 'state/store.js'));
const { beginHistoryTransaction, commitHistory, undo, redo } = require(path.join(compiledRoot, 'state/history.js'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rect(id, x = 0, y = 0) {
  return { id, type:'rectangle', x, y, width:100, height:60, borderRadius:8, color:'#111827', thickness:2 };
}

const media = { id:'media', type:'media', x:10, y:20, width:320, height:180, assetId:'asset-large', mime:'image/png', name:'Large media', color:'#111827', thickness:1 };

dispatch({ type:'REPLACE_ELEMENTS', elements:[media, rect('r1', 40, 50)] });
dispatch({ type:'SET_HISTORY', patch:{ historyPast:[], historyFuture:[], pendingHistoryBefore:null } });

let tx = beginHistoryTransaction();
dispatch({ type:'MOVE_ELEMENTS', ids:['media'], delta:{x:25,y:-5} });
commitHistory(tx);
assert(appState.historyPast.length === 1, 'move should create one history entry');
let entry = appState.historyPast[0];
assert(entry.patches.length === 1 && entry.patches[0].id === 'media', 'move patch missing');
assert(Object.keys(entry.patches[0].before).sort().join(',') === 'x,y', 'move patch contains unrelated fields');
assert(!('assetId' in entry.patches[0].before) && !('assetId' in entry.patches[0].after), 'media asset reference copied into move history');

undo();
let currentMedia = appState.elements.find(e => e.id === 'media');
assert(currentMedia.x === 10 && currentMedia.y === 20, 'undo move failed');
redo();
currentMedia = appState.elements.find(e => e.id === 'media');
assert(currentMedia.x === 35 && currentMedia.y === 15, 'redo move failed');

tx = beginHistoryTransaction();
dispatch({ type:'UPDATE_STYLE', ids:['r1'], patch:{ color:'#ff0000', thickness:7 } });
commitHistory(tx);
undo();
let r1 = appState.elements.find(e => e.id === 'r1');
assert(r1.color === '#111827' && r1.thickness === 2, 'undo style failed');
redo();
r1 = appState.elements.find(e => e.id === 'r1');
assert(r1.color === '#ff0000' && r1.thickness === 7, 'redo style failed');

tx = beginHistoryTransaction();
dispatch({ type:'ADD_ELEMENT', element:rect('r2', 5, 6) });
commitHistory(tx);
entry = appState.historyPast.at(-1);
assert(entry.inserted.length === 1 && entry.inserted[0].element.id === 'r2', 'insert history missing');
undo();
assert(!appState.elements.some(e => e.id === 'r2'), 'undo insert failed');
redo();
assert(appState.elements.some(e => e.id === 'r2'), 'redo insert failed');

tx = beginHistoryTransaction();
dispatch({ type:'DELETE_ELEMENTS', ids:['r2'] });
commitHistory(tx);
entry = appState.historyPast.at(-1);
assert(entry.removed.length === 1 && entry.removed[0].element.id === 'r2', 'delete history missing');
undo();
assert(appState.elements.some(e => e.id === 'r2'), 'undo delete failed');
redo();
assert(!appState.elements.some(e => e.id === 'r2'), 'redo delete failed');

const beforeOrder = appState.elements.map(e => e.id);
tx = beginHistoryTransaction();
dispatch({ type:'REORDER_ELEMENTS', elements:[...appState.elements].reverse() });
commitHistory(tx);
entry = appState.historyPast.at(-1);
assert(entry.orderBefore?.join(',') === beforeOrder.join(','), 'reorder before order missing');
assert(entry.orderAfter?.join(',') === [...beforeOrder].reverse().join(','), 'reorder after order missing');
assert(entry.patches.length === 0 && entry.inserted.length === 0 && entry.removed.length === 0, 'reorder copied element data');
undo();
assert(appState.elements.map(e=>e.id).join(',') === beforeOrder.join(','), 'undo reorder failed');
redo();
assert(appState.elements.map(e=>e.id).join(',') === [...beforeOrder].reverse().join(','), 'redo reorder failed');


// Layer-group structure and element parent references must undo/redo atomically.
dispatch({ type:'REPLACE_DOCUMENT', elements:[rect('ga'), rect('middle'), rect('gb'), rect('gc')], layerGroups:[] });
dispatch({ type:'SET_HISTORY', patch:{ historyPast:[], historyFuture:[], pendingHistoryBefore:null } });
tx = beginHistoryTransaction();
dispatch({ type:'GROUP_LAYER_SELECTION', ids:['ga','gb'], group:{ id:'g1', name:'Inner' } });
commitHistory(tx);
assert(appState.layerGroups.some(g => g.id === 'g1'), 'group history should persist structural node');
assert(appState.elements.map(e=>e.id).join(',') === 'ga,middle,gb,gc', 'group history must preserve z-order');
assert(appState.elements.find(e=>e.id === 'ga').parentGroupId === 'g1', 'group membership missing before undo');
undo();
assert(appState.layerGroups.length === 0, 'undo group should remove structural node');
assert(!appState.elements.find(e=>e.id === 'ga').parentGroupId && !appState.elements.find(e=>e.id === 'gb').parentGroupId, 'undo group should restore element parents');
assert(appState.elements.map(e=>e.id).join(',') === 'ga,middle,gb,gc', 'undo group changed z-order');
redo();
assert(appState.layerGroups.some(g => g.id === 'g1'), 'redo group should restore structural node');
assert(appState.elements.find(e=>e.id === 'ga').parentGroupId === 'g1', 'redo group should restore element parents');

tx = beginHistoryTransaction();
dispatch({ type:'GROUP_LAYER_SELECTION', ids:['ga','gb','gc'], group:{ id:'g2', name:'Outer' } });
commitHistory(tx);
assert(appState.layerGroups.find(g=>g.id === 'g1').parentGroupId === 'g2', 'nested group parent missing');
assert(appState.elements.find(e=>e.id === 'gc').parentGroupId === 'g2', 'nested direct element parent missing');
undo();
assert(!appState.layerGroups.some(g=>g.id === 'g2'), 'undo nested group should remove outer node');
assert(!appState.layerGroups.find(g=>g.id === 'g1').parentGroupId, 'undo nested group should restore inner root parent');
assert(!appState.elements.find(e=>e.id === 'gc').parentGroupId, 'undo nested group should restore sibling parent');
redo();
assert(appState.layerGroups.find(g=>g.id === 'g1').parentGroupId === 'g2', 'redo nested group should restore nesting');

// Duplicate/paste uses one transaction but two reducer steps: elements first,
// then their new group nodes. Undo/Redo must treat both as one structural edit.
const duplicateBeforeCount = appState.elements.length;
tx = beginHistoryTransaction();
dispatch({ type:'ADD_ELEMENTS', elements:[
  { ...rect('dup-a', 20, 20), parentGroupId:'dup-inner' },
  { ...rect('dup-b', 30, 30), parentGroupId:'dup-inner' },
  { ...rect('dup-c', 40, 40), parentGroupId:'dup-outer' },
] });
dispatch({ type:'ADD_LAYER_GROUPS', groups:[
  { id:'dup-inner', name:'Duplicate Inner', parentGroupId:'dup-outer' },
  { id:'dup-outer', name:'Duplicate Outer' },
] });
commitHistory(tx);
entry = appState.historyPast.at(-1);
assert(entry.inserted.length === 3, 'hierarchy duplicate history should capture all inserted elements');
assert(entry.layerGroupsBefore && entry.layerGroupsAfter, 'hierarchy duplicate history should capture group structure');
assert(appState.elements.find(e=>e.id === 'dup-a').parentGroupId === 'dup-inner', 'duplicate inner membership missing');
assert(appState.layerGroups.find(g=>g.id === 'dup-inner').parentGroupId === 'dup-outer', 'duplicate nested group relationship missing');
undo();
assert(appState.elements.length === duplicateBeforeCount, 'undo hierarchy duplicate should remove inserted elements');
assert(!appState.layerGroups.some(g=>g.id === 'dup-inner' || g.id === 'dup-outer'), 'undo hierarchy duplicate should remove inserted groups');
redo();
assert(appState.elements.find(e=>e.id === 'dup-a').parentGroupId === 'dup-inner', 'redo hierarchy duplicate should restore element membership');
assert(appState.layerGroups.find(g=>g.id === 'dup-inner').parentGroupId === 'dup-outer', 'redo hierarchy duplicate should restore nested groups');

console.log('OK: runtime patch history Undo/Redo replays move/style/insert/delete/reorder, nested Layer groups, and cloned hierarchy insertion without full-board snapshots.');
