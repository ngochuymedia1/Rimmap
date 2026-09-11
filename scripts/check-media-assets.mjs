import fs from 'node:fs';

const types = fs.readFileSync('src/model/types.ts', 'utf8');
const wiring = fs.readFileSync('src/ui/wiring.ts', 'utf8');
const mediaImport = fs.readFileSync('src/media/import.ts', 'utf8');
const persistence = fs.readFileSync('src/persistence/index.ts', 'utf8');
const assets = fs.readFileSync('src/media/assets.ts', 'utf8');

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };

const mediaType = types.match(/export type MediaElement[\s\S]*?\n};/)?.[0] || '';
if (!/assetId:\s*string/.test(mediaType)) fail('MediaElement does not reference assetId.');
if (/\bsrc:\s*string/.test(mediaType)) fail('MediaElement still stores src/Base64 data.');
if (/readAsDataURL\s*\(/.test(wiring + mediaImport)) fail('Media import still converts files to Base64 data URLs.');
if (!/insertMediaFiles/.test(wiring) || !/importAssetFile/.test(mediaImport) || !/putAssetBlob/.test(assets)) fail('Media import is not routed through the shared Blob asset store.');
if (!/project\.json/.test(persistence) || !/preview\.png/.test(persistence) || !/createZip/.test(persistence)) fail('ZIP project packaging is missing project.json/preview.png.');
if (!/assets\//.test(assets)) fail('Asset paths are not stored under assets/.');
if (/set\(['"]my-board-elements['"]/.test(persistence)) fail('Legacy my-board-elements is still written continuously.');
if (!/my-board-v12-current/.test(persistence) || !/my-board-v12-checkpoint/.test(persistence)) fail('Simplified current/checkpoint recovery keys are missing.');

console.log('OK: media is Blob-backed by assetId, project saves are ZIP-based, and recovery no longer writes the legacy element copy.');
