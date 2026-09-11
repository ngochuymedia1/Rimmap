import fs from 'node:fs';

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };
const read = path => fs.readFileSync(path, 'utf8');

const desktop = read('src/desktop/index.ts');
const wiring = read('src/ui/wiring.ts');
const mediaImport = read('src/media/import.ts');
const formats = read('src/media/formats.ts');
const env = read('src/env.d.ts');
const capability = JSON.parse(read('src-tauri/capabilities/default.json'));
const config = JSON.parse(read('src-tauri/tauri.conf.json'));

if (!desktop.includes('getCurrentWebview') || !desktop.includes('onDragDropEvent')) fail('Tauri native webview file-drop listener is missing');
if (!desktop.includes('payload.position.toLogical(scaleFactor)')) fail('native physical drop coordinates are not converted to logical/CSS coordinates');
if (!desktop.includes('onScaleChanged')) fail('native file-drop coordinate conversion does not follow DPI changes');
if (!wiring.includes('installDesktopFileDrop') || !wiring.includes('mediaFilesFromDesktopPaths')) fail('desktop file drops are not connected to the shared media import pipeline');
if (!wiring.includes('getScreenToWorld(event.clientX, event.clientY)')) fail('desktop drop position is not converted into board/world coordinates');
if (!mediaImport.includes('readDesktopFile(path)') || !mediaImport.includes('new File([buffer], name')) fail('dropped filesystem paths are not materialized as media Files');
for (const token of ['png', 'jpeg', 'webp', 'svg', 'svgz', 'avif']) if (!formats.includes(`'${token}'`)) fail(`missing supported image/vector format ${token}`);
for (const token of ['gif', 'apng', 'mp4', 'mov', 'webm', 'mp3']) if (!formats.includes(`'${token}'`)) fail(`missing unsupported-format classifier token ${token}`);
if (!mediaImport.includes('showUnsupportedMediaWarning')) fail('native/browser drop paths do not warn about skipped unsupported files');
if (!env.includes("declare module '@tauri-apps/api/webview'")) fail('local TypeScript declarations for Tauri webview drag/drop are missing');
if (!new Set(capability.permissions || []).has('fs:allow-read-file')) fail('native dropped paths cannot be read because fs read permission is missing');
const mainWindow = config.app?.windows?.find(window => window.label === 'main');
if (mainWindow?.dragDropEnabled !== true) fail('Tauri native drag/drop must remain enabled for Windows file path events');

console.log('OK: Windows/Tauri native media drops bridge filesystem paths into the shared Rimmap still-image importer with DPI-correct coordinates and unsupported-format warnings.');
