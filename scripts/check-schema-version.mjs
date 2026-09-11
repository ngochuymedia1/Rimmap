import fs from 'node:fs';

const types = fs.readFileSync(new URL('../src/model/types.ts', import.meta.url), 'utf8');
const persistence = fs.readFileSync(new URL('../src/persistence/index.ts', import.meta.url), 'utf8');
const migrations = fs.readFileSync(new URL('../src/persistence/migrations.ts', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/schemaVersion:\s*12;/.test(types), 'ProjectFile must declare schemaVersion: 12.');
assert(/archiveVersion:\s*1;/.test(types), 'ProjectFile must declare archiveVersion: 1.');
assert(!/currentColor\?:|previousColor\?:|recentColors\?:/.test(types), 'ProjectSettings still exposes legacy Color-panel fields.');
assert(!/currentColor:\s*string|previousColor:\s*string|recentColors:\s*string/.test(fs.readFileSync(new URL('../src/state/store.ts', import.meta.url), 'utf8')), 'AppState still owns legacy Color-panel state.');
assert(!/currentColor:\s*appState|previousColor:\s*appState|recentColors:\s*\[/.test(persistence), 'Persistence still writes legacy color preferences.');
assert(/type MediaElement[\s\S]*assetId:\s*string/.test(types), 'MediaElement must reference assetId.');
assert(!/type MediaElement[\s\S]{0,260}\bsrc:\s*string/.test(types), 'MediaElement still stores src payloads.');
assert(/CURRENT_SCHEMA_VERSION\s*=\s*12/.test(migrations), 'CURRENT_SCHEMA_VERSION must be 12.');
assert(/migrateV3ToV4/.test(migrations) && /migrateV4ToV5/.test(migrations) && /migrateV5ToV6/.test(migrations) && /migrateV6ToV7/.test(migrations) && /migrateV7ToV8/.test(migrations) && /migrateV8ToV9/.test(migrations) && /migrateV9ToV10/.test(migrations) && /migrateV10ToV11/.test(migrations) && /migrateV11ToV12/.test(migrations), 'Required v3→v4→v5→v6→v7→v8→v9→v10→v11→v12 migration chain is missing.');
assert(/schemaVersion:\s*CURRENT_SCHEMA_VERSION/.test(persistence), 'Saved project snapshots must emit the current schemaVersion.');
assert(!/project\.version\s*=|\bversion:\s*3\b/.test(persistence), 'Persistence still writes legacy version: 3.');
assert(/my-board-v12-current/.test(persistence) && /my-board-v12-checkpoint/.test(persistence), 'v12 current/checkpoint recovery keys are missing.');
assert(!/set\(['"]my-board-elements['"]/.test(persistence), 'Persistence still continuously writes the legacy my-board-elements copy.');

assert(/export type TextDocument[\s\S]*version:\s*1/.test(types), 'Canonical TextDocument model is missing.');
assert(/textDoc\?:\s*TextDocument/.test(types), 'Text-bearing elements must reference TextDocument.');
assert(!/richText\?:|richLines\?:|labelRichText\?:|labelRichLines\?:/.test(types), 'Current element model still exposes legacy HTML/richLines fields.');
assert(/textVerticalAlign\?:\s*TextVerticalAlign/.test(types), 'Shape text vertical positioning is missing from the current schema.');
assert(/migrateV8ToV9/.test(migrations), 'v8→v9 shape-text/list-numbering migration is missing.');
assert(/hidden\?:\s*boolean/.test(types), 'Element visibility field is missing.');
assert(/migrateV9ToV10/.test(migrations), 'v9→v10 visibility migration is missing.');

assert(/export type LayerGroupNode[\s\S]*parentGroupId\?:\s*string/.test(types), 'First-class nested LayerGroupNode model is missing.');
assert(/parentGroupId\?:\s*string/.test(types), 'Elements must reference Layer groups through parentGroupId.');
assert(!/\bgroupId\?:\s*string/.test(types), 'Current element schema still exposes legacy flat groupId.');
assert(/layerGroups:\s*LayerGroupNode\[\]/.test(types), 'ProjectFile must persist Layer-group nodes.');
assert(/migrateV10ToV11/.test(migrations), 'v10→v11 real Layer-group migration is missing.');
assert(/migrateV11ToV12/.test(migrations), 'v11→v12 arrow-routing migration is missing.');
assert(/routingMode\?:\s*ArrowRoutingMode/.test(types), 'Current connector schema must persist routingMode.');
console.log('OK: schema v12 persists explicit connector routing plus real nested Layer groups, visibility, structured text, shape positioning, color cleanup, and asset separation.');
