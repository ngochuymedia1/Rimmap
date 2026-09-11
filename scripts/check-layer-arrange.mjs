import fs from 'node:fs';

const layers = fs.readFileSync(new URL('../src/layers/index.ts', import.meta.url), 'utf8');
const keyboard = fs.readFileSync(new URL('../src/interactions/keyboard.ts', import.meta.url), 'utf8');
const contextMenu = fs.readFileSync(new URL('../src/ui/context-menu.ts', import.meta.url), 'utf8');

const layerChecks = [
  ["showContextMenu(e.clientX, e.clientY)", 'right-clicking a layer row opens the object context menu'],
  ["row.addEventListener('contextmenu'", 'All Layers rows have a context-menu bridge'],
  ["input.blur();", 'readonly name selection releases keyboard focus'],
  ["selectLayer();", 'layer interaction selects the backing canvas object'],
];

for (const [needle, description] of layerChecks) {
  if (!layers.includes(needle)) {
    console.error(`FAIL: ${description}`);
    process.exit(1);
  }
}

if (!keyboard.includes('activeInput && !activeInput.readOnly')) {
  console.error('FAIL: readonly layer-name inputs still suppress Arrange shortcuts.');
  process.exit(1);
}

for (const action of ["'front'", "'back'", "'forward'", "'backward'"]) {
  if (!contextMenu.includes(action)) {
    console.error(`FAIL: arrangeSelection is missing ${action}.`);
    process.exit(1);
  }
}


if (!contextMenu.includes('if (appState.selectedLayerGroupId || !canMutateSelection()) return;')) {
  console.error('FAIL: exact Layer-group rows can still invoke undefined group-level z-order Arrange semantics.');
  process.exit(1);
}
if (!contextMenu.includes('const exactGroupSelected = !!appState.selectedLayerGroupId')) {
  console.error('FAIL: context menu does not distinguish structural group selection from leaf selection.');
  process.exit(1);
}
for (const shortcut of ["'bringFront'", "'sendBack'", "'bringForward'", "'sendBackward'"]) {
  if (!keyboard.includes(shortcut)) {
    console.error(`FAIL: keyboard Arrange shortcut missing ${shortcut}.`);
    process.exit(1);
  }
}

console.log('OK: leaf Layers selection can drive Arrange shortcuts; exact group rows are protected from undefined group-level z-order semantics.');
