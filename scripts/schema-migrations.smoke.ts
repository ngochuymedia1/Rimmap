import { CURRENT_SCHEMA_VERSION, migrateProjectFile } from '../src/persistence/migrations';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const v3Fixture = {
  format: 'my-board-project',
  version: 3,
  name: 'Legacy board',
  savedAt: '2025-01-02T03:04:05.000Z',
  elements: [
    {
      id: 'rect-1', type: 'rectangle', x: 10, y: 20, width: 100, height: 80,
      color: '#111827', thickness: 3, borderRadius: 10, text: 'Legacy title', fontSize: 40,
    },
    {
      id: 'arrow-1', type: 'arrow', start: { x: 0, y: 0 }, control: { x: 50, y: 25 }, end: { x: 100, y: 50 },
      color: '#111827', thickness: 3, style: 'solid',
      branches: [{ root: 'end', end: { x: 140, y: 80 }, label: 'Branch' }],
    },
  ],
  settings: { currentColor: '#123456', camera: { x: 12, y: 34, zoom: 1.25 } },
};

const original = JSON.stringify(v3Fixture);
const migrated = migrateProjectFile(v3Fixture, 'Fallback');
assert(JSON.stringify(v3Fixture) === original, 'Migration mutated its input');
assert(migrated.fromVersion === 3, 'Expected v3 source detection');
assert(migrated.migrated === true, 'Expected v3 project to migrate');
assert(migrated.project.schemaVersion === CURRENT_SCHEMA_VERSION, 'Expected current schema version');
assert(!('version' in migrated.project), 'Current project should not retain legacy version field');
assert(migrated.project.settings.brushColor === '#123456', 'Legacy currentColor should seed brushColor once');

const rectangle = migrated.project.elements.find(el => el.id === 'rect-1') as any;
assert(rectangle?.name === 'Rectangle 1', 'v3→v4 should assign stable layer names');
assert(rectangle.locked === false, 'v3→v4 should make lock state explicit');
assert(rectangle.fontSize === 20 && rectangle.textScale === 2, 'v3→v4 should fold legacy fontSize into textScale exactly once');
assert(rectangle.strokeEnabled === true && rectangle.strokeStyle === 'solid' && rectangle.strokeColor === '#111111', 'v3→v4 should make rectangle stroke defaults explicit');
assert(rectangle.textDoc?.version === 1, 'v7→v8 should create canonical TextDocument');
assert(rectangle.textVerticalAlign === 'top', 'v8→v9 should default shape text to top alignment');
assert(rectangle.hidden === false, 'v9→v10 should default migrated elements to visible');

const arrow = migrated.project.elements.find(el => el.id === 'arrow-1') as any;
assert(arrow?.name === 'Arrow 1', 'Arrow should receive a stable layer name');
assert(arrow.style === 'arrow', 'v4→v5 should migrate legacy solid arrow style');
assert(arrow.curveMode === 'smooth' && arrow.arrowMode === 'connection', 'v4→v5 should make arrow modes explicit');
assert(arrow.routingMode === 'manual', 'v11→v12 must preserve legacy connector geometry by defaulting routing to Manual');
assert(Array.isArray(arrow.controls) && arrow.controls.length === 1, 'v4→v5 should make connector controls explicit');
assert(arrow.branches?.[0]?.id === 'arrow-1-branch-1', 'Missing branch IDs should migrate deterministically');
assert(arrow.branches?.[0]?.labelPosition === 0.5, 'Branch label position should receive the v5 default');
assert(arrow.branches?.[0]?.labelDoc?.version === 1, 'Arrow branch labels should migrate to TextDocument');

const secondPass = migrateProjectFile(migrated.project);
assert(secondPass.migrated === false && secondPass.fromVersion === CURRENT_SCHEMA_VERSION, 'Current schema should not migrate again');
assert(JSON.stringify(secondPass.project) === JSON.stringify(migrated.project), 'Current-schema import must be idempotent');

const bare = migrateProjectFile([{ id: 'legacy-note', type: 'note', x: 0, y: 0, width: 120, height: 80, color: '#222', thickness: 1, text: 'Hi', fontSize: 20, borderRadius: 3 }], 'Bare array');
assert(bare.fromVersion === 1 && bare.project.schemaVersion === CURRENT_SCHEMA_VERSION, 'Bare legacy element arrays should migrate from v1 to current');
assert(bare.project.name === 'Bare array', 'Bare-array migration should retain fallback filename');

const staleNumberingV8 = {
  format: 'my-board-project', schemaVersion: 8, archiveVersion: 1, name: 'List repair', savedAt: '', assets: [], settings: {},
  elements: [{
    id: 'note-list', type: 'note', x: 0, y: 0, width: 300, height: 220, color: '#111827', thickness: 1,
    text: 'One\nChild\nTwo', fontSize: 20, textScale: 1, borderRadius: 3,
    textAlign: 'center', textVerticalAlign: 'middle',
    textDoc: { version: 1, lines: [
      { runs: [{ text: 'One', color: '#111827' }], listType: 'number', listIndex: 3, numberPath: [3], indent: 0 },
      { runs: [{ text: 'Child', color: '#111827' }], listType: 'number', listIndex: 7, numberPath: [3, 7], indent: 1 },
      { runs: [{ text: 'Two', color: '#111827' }], listType: 'number', listIndex: 8, numberPath: [8], indent: 0 },
    ] },
  }],
};
const repaired = migrateProjectFile(staleNumberingV8);
const repairedNote = repaired.project.elements[0] as any;
assert(JSON.stringify(repairedNote.textDoc.lines.map((line: any) => line.numberPath)) === JSON.stringify([[1], [1, 1], [2]]), 'v8→v9 should recompute ordered numbering from structure');
assert(repairedNote.textAlign === 'center' && repairedNote.textVerticalAlign === 'middle', 'v8→v9 should preserve explicit centered shape text');


const visibilityV9 = {
  format: 'my-board-project', schemaVersion: 9, archiveVersion: 1, name: 'Visibility migration', savedAt: '', assets: [], settings: {},
  elements: [{ id: 'visible-note', type: 'note', x: 0, y: 0, width: 120, height: 80, color: '#222', thickness: 1, text: 'Hi', textDoc: { version: 1, lines: [{ runs: [{ text: 'Hi', color: '#222' }] }] }, fontSize: 20, textScale: 1, borderRadius: 3, textAlign: 'left', textVerticalAlign: 'top', fontFamily: 'Montserrat', fillColor: '#FFF9E8', locked: false }],
};
const visibilityMigrated = migrateProjectFile(visibilityV9);
assert(visibilityMigrated.fromVersion === 9 && visibilityMigrated.project.schemaVersion === CURRENT_SCHEMA_VERSION, 'v9 project should migrate to current schema');
assert((visibilityMigrated.project.elements[0] as any).hidden === false, 'v9→v10 should preserve old projects as fully visible');

const hiddenCurrent = migrateProjectFile({ ...visibilityV9, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [{ ...visibilityV9.elements[0], hidden: true }] });
assert((hiddenCurrent.project.elements[0] as any).hidden === true, 'Current schema should preserve hidden elements');


const flatGroupingV10 = {
  format: 'my-board-project', schemaVersion: 10, archiveVersion: 1, name: 'Flat group migration', savedAt: '', assets: [], settings: {},
  elements: [
    { id: 'group-a-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60, borderRadius: 8, color: '#111827', thickness: 2, hidden: false, groupId: 'legacy-g' },
    { id: 'outside', type: 'rectangle', x: 10, y: 10, width: 100, height: 60, borderRadius: 8, color: '#111827', thickness: 2, hidden: false },
    { id: 'group-a-2', type: 'rectangle', x: 20, y: 20, width: 100, height: 60, borderRadius: 8, color: '#111827', thickness: 2, hidden: false, groupId: 'legacy-g' },
  ],
};
const groupingMigrated = migrateProjectFile(flatGroupingV10);
assert(groupingMigrated.fromVersion === 10 && groupingMigrated.project.schemaVersion === CURRENT_SCHEMA_VERSION, 'v10 project should migrate through v11 Layer groups to the current schema');
assert(groupingMigrated.project.elements.map(el => el.id).join(',') === 'group-a-1,outside,group-a-2', 'v10→v11 grouping migration must preserve exact element z-order');
assert(groupingMigrated.project.layerGroups.length === 1 && groupingMigrated.project.layerGroups[0]?.id === 'legacy-g', 'legacy groupId should become one first-class Layer group');
assert((groupingMigrated.project.elements[0] as any).parentGroupId === 'legacy-g' && (groupingMigrated.project.elements[2] as any).parentGroupId === 'legacy-g', 'legacy group members should reference the migrated Layer group');
assert(!('groupId' in (groupingMigrated.project.elements[0] as any)), 'legacy groupId must not survive in the current element model');

const nestedCurrent = migrateProjectFile({
  ...groupingMigrated.project,
  layerGroups: [
    { id: 'outer', name: 'Outer' },
    { id: 'legacy-g', name: 'Inner', parentGroupId: 'outer' },
  ],
  elements: groupingMigrated.project.elements.map((element: any) => element.id === 'outside' ? { ...element, parentGroupId: 'outer' } : element),
});
assert(nestedCurrent.migrated === false, 'current v12 nested group project should not migrate');
assert(nestedCurrent.project.layerGroups.find(group => group.id === 'legacy-g')?.parentGroupId === 'outer', 'current schema should preserve nested group parents');

const routingV11 = migrateProjectFile({
  format: 'my-board-project', schemaVersion: 11, archiveVersion: 1, name: 'Routing migration', savedAt: '', assets: [], settings: {}, layerGroups: [],
  elements: [{ id: 'legacy-arrow', type: 'arrow', start: { x: 0, y: 0 }, control: { x: 50, y: 20 }, controls: [{ x: 50, y: 20 }], pointCount: 3, end: { x: 100, y: 0 }, style: 'line', curveMode: 'smooth', arrowMode: 'connection', routingMode: 'auto', color: '#111827', thickness: 2 }],
});
assert(routingV11.fromVersion === 11 && routingV11.project.schemaVersion === CURRENT_SCHEMA_VERSION, 'v11 should migrate to v12');
assert((routingV11.project.elements[0] as any).routingMode === 'manual', 'v11→v12 must force legacy connectors to Manual even if an unknown routingMode field was present');

let futureRejected = false;
try {
  migrateProjectFile({ format: 'my-board-project', schemaVersion: CURRENT_SCHEMA_VERSION + 1, name: 'Future', savedAt: '', elements: [], settings: {} });
} catch (error) {
  futureRejected = error instanceof Error && error.message.includes('newer than this build');
}
assert(futureRejected, 'Future schemas must be rejected explicitly');

console.log(`OK: schema migration chain reaches v${CURRENT_SCHEMA_VERSION}, including v9→v10 visibility, v10→v11 real Layer groups, v11→v12 Manual routing compatibility, nested groups, idempotence, and future-version guard.`);
