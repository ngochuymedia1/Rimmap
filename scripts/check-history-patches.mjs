import fs from 'node:fs';

const history = fs.readFileSync('src/state/history.ts', 'utf8');
const core = fs.readFileSync('src/state/history-core.ts', 'utf8');
const store = fs.readFileSync('src/state/store.ts', 'utf8');
const types = fs.readFileSync('src/model/types.ts', 'utf8');

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };

if (/structuredClone\s*\(/.test(history) || /structuredClone\s*\(/.test(core)) fail('history must not structuredClone document snapshots.');
if (/JSON\.stringify\s*\(/.test(history) || /JSON\.stringify\s*\(/.test(core)) fail('history must not compare document states with JSON.stringify.');
if (!history.includes('beginHistoryTransaction')) fail('history transactions are missing.');
if (!core.includes('diffHistoryElement')) fail('changed-element patch generation is missing.');
if (!history.includes('store.subscribeBefore')) fail('history is not recording store mutations incrementally.');
if (!types.includes('HistoryElementPatch') || !types.includes('HistoryIndexedElement')) fail('patch-based history schema is missing.');
if (!types.includes('layerGroupsBefore') || !types.includes('layerGroupsAfter')) fail('history schema cannot restore Layer-group structure.');
if (!history.includes('REPLACE_LAYER_GROUPS')) fail('history replay cannot restore Layer-group structure.');
if (!store.includes("type: 'APPLY_ELEMENT_PATCH'")) fail('store cannot replay element patches.');
if (!store.includes("type: 'INSERT_ELEMENT_AT'")) fail('store cannot restore removed elements at their original z-index.');
if (!store.includes("type: 'REORDER_BY_IDS'")) fail('store cannot replay order-only history without cloning elements.');
if (/element\.points\.push\s*\(/.test(store)) fail('freehand append still mutates an existing element in place, which would corrupt patch history references.');

console.log('OK: Undo/Redo uses changed-element patches plus Layer-group structure snapshots, with no full-board clone or JSON stringify comparison.');
