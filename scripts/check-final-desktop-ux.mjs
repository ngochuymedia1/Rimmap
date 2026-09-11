import fs from 'node:fs';

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };
const read = path => fs.readFileSync(path, 'utf8');

const dom = read('src/ui/dom.ts');
const css = read('src/style.css');
const shortcuts = read('src/shortcuts/definitions.ts');
const shortcutUi = read('src/shortcuts/index.ts');
const keyboard = read('src/interactions/keyboard.ts');
const wiring = read('src/ui/wiring.ts');
const persistence = read('src/persistence/index.ts');
const mediaImport = read('src/media/import.ts');
const desktop = read('src/desktop/index.ts');
const mediaFormats = read('src/media/formats.ts');
const types = read('src/model/types.ts');

if (!types.includes("'saveProjectAs'")) fail('ShortcutId is missing Save As');
if (!shortcuts.includes("id: 'saveProjectAs'") || !shortcuts.includes("defaultBinding: 'Ctrl+Shift+S'")) fail('Save As shortcut default is missing');
if (!dom.includes('id="project-save-as"') || !dom.includes('data-shortcut-display="saveProjectAs"')) fail('Save As is missing from File menu');
if (!shortcutUi.includes("['project-save-as', 'saveProjectAs']")) fail('Save As aria shortcut is not refreshed');
if (!keyboard.includes("shortcutMatches(e, 'saveProjectAs')") || !keyboard.includes('saveProjectAs()')) fail('Save As keyboard command is not wired');
if (!wiring.includes("getElementById('project-save-as')") || !wiring.includes('saveProjectAs()')) fail('Save As File-menu command is not wired');
if (!persistence.includes('export async function saveProjectAs()') || !persistence.includes('saveDesktopProjectAs')) fail('Save As persistence flow is missing');
if (!persistence.includes('const defaultPath = previousPath ||')) fail('Save As does not reuse the current file location as its default');

const metaStart = dom.indexOf('<div class="project-menu-meta">');
const metaEnd = dom.indexOf('</div>\n\n    <div class="project-menu-actions"', metaStart);
const meta = dom.slice(metaStart, metaEnd);
if (!(meta.indexOf('project-name-wrap') >= 0 && meta.indexOf('project-name-wrap') < meta.indexOf('project-brand'))) fail('Project name is not above the Rimmap logo in File header');
if (!css.includes('.project-name-wrap') || !css.includes('overflow-wrap: anywhere') || !css.includes('text-align: center')) fail('Long project names are not centered/wrappable');
if (!css.includes('.project-brand-logo') || !css.includes('width: 78px')) fail('Secondary Rimmap logo sizing is missing');

if (!wiring.includes("canvas.addEventListener('dragover'") || !wiring.includes("canvas.addEventListener('drop'")) fail('Browser canvas media drag/drop listeners are missing');
if (!desktop.includes('onDragDropEvent') || !wiring.includes('installDesktopFileDrop')) fail('Tauri native filesystem drag/drop path is missing');
if (!wiring.includes('mediaFilesFromDrop') || !wiring.includes('mediaFilesFromDesktopPaths') || !wiring.includes('insertMediaFiles')) fail('Browser/desktop drag/drop does not reuse the media import pipeline');
for (const token of ['png', 'jpeg', 'webp', 'svg', 'svgz', 'avif']) if (!mediaFormats.includes(`'${token}'`)) fail(`supported still image/vector format ${token} is not centralized`);
for (const token of ['gif', 'apng', 'mp4', 'mov', 'webm', 'mp3']) if (!mediaFormats.includes(`'${token}'`)) fail(`unsupported animated/video/audio token ${token} is not centralized`);
if (!mediaImport.includes('unsupportedMediaMessage') || !mediaImport.includes('showUnsupportedMediaWarning')) fail('clear unsupported media warnings are missing');
if (!mediaImport.includes("data.getData('text/uri-list')") || !mediaImport.includes("querySelector('img')")) fail('Browser-dragged image URL fallback is missing');
if (!css.includes('#canvas.media-drop-ready')) fail('Drag/drop feedback style is missing');

if (!keyboard.includes("window.addEventListener('paste'") || !keyboard.includes('imageFilesFromClipboard')) fail('Board clipboard image paste listener is missing');
const imagePaste = keyboard.indexOf('const images = imageFilesFromClipboard');
const unsupportedPaste = keyboard.indexOf('if (clipboardHasMediaPayload', imagePaste);
const internalPaste = keyboard.indexOf('if (appState.internalClipboard.elements.length)', imagePaste);
if (imagePaste < 0 || unsupportedPaste < 0 || internalPaste < 0 || !(imagePaste < unsupportedPaste && unsupportedPaste < internalPaste)) fail('Clipboard image/unsupported media handling order is incorrect');
if (!keyboard.includes("appState.shortcutBindings.paste !== 'Ctrl+V'")) fail('Native clipboard image paste does not respect the configured default paste binding');

console.log('OK: Save As, polished File header, image-only drag/drop, and clipboard image paste are wired without replacing internal object paste.');
