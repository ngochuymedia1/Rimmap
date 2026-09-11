import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/layers/index.ts', import.meta.url), 'utf8');
const required = [
  ["main?.addEventListener('dblclick'", 'double-clicking the layer body starts rename'],
  ["input.addEventListener('dblclick'", 'double-clicking the layer name starts rename'],
  ['input.readOnly = false', 'rename switches the name field into edit mode'],
  ["e.key === 'Enter'", 'Enter commits rename'],
  ["e.key === 'Escape'", 'Escape cancels rename'],
  ['saveToLocal();', 'rename persists'],
  ['commitHistory(before);', 'rename participates in Undo/Redo'],
];

for (const [needle, description] of required) {
  if (!source.includes(needle)) {
    console.error(`FAIL: missing layer rename behavior: ${description}`);
    process.exit(1);
  }
}

const panelStart = source.indexOf('export function refreshAllLayersPanelNow()');
const clickStart = source.indexOf("input.addEventListener('click'", panelStart);
const dblClickStart = source.indexOf("input.addEventListener('dblclick'", clickStart);
if (clickStart < 0 || dblClickStart < 0) {
  console.error('FAIL: could not locate layer-name click/double-click handlers.');
  process.exit(1);
}
const clickHandler = source.slice(clickStart, dblClickStart);
if (clickHandler.includes('requestLayersPanelRefresh')) {
  console.error('FAIL: layer-name first click rebuilds the panel and can destroy dblclick detection.');
  process.exit(1);
}


const selectionUiStart = source.indexOf('const finishSelectionUi = () =>', panelStart);
const selectionUiEnd = source.indexOf('};', selectionUiStart);
if (selectionUiStart < 0 || selectionUiEnd < 0) {
  console.error('FAIL: could not locate the shared All Layers selection UI handler.');
  process.exit(1);
}
const selectionUiHandler = source.slice(selectionUiStart, selectionUiEnd);
if (!selectionUiHandler.includes("setTool('select', { refreshLayers: false })")) {
  console.error('FAIL: selecting a layer/group still allows setTool() to rebuild the list between clicks.');
  process.exit(1);
}

const toolsSource = fs.readFileSync(new URL('../src/interactions/tools.ts', import.meta.url), 'utf8');
if (!toolsSource.includes('options.refreshLayers !== false')) {
  console.error('FAIL: setTool() has no way to suppress the Layers-panel refresh during a double-click sequence.');
  process.exit(1);
}

const keydownStart = source.indexOf("input.addEventListener('keydown'", panelStart);
const keydownEnd = source.indexOf('});', keydownStart);
const keydownHandler = source.slice(keydownStart, keydownEnd);
if (!keydownHandler.includes('e.stopPropagation()')) {
  console.error('FAIL: layer-name typing can bubble to global keyboard shortcuts (notably Space/Escape).');
  process.exit(1);
}

console.log('OK: All Layers inline rename keeps a stable DOM target and isolates editing keystrokes.');
