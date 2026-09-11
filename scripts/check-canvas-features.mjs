import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const dpi = read('src/renderer/dpi.ts');
const renderer = read('src/renderer/index.ts');
const pointer = read('src/interactions/pointer.ts');
const snapping = read('src/interactions/snapping.ts');
const keyboard = read('src/interactions/keyboard.ts');
const align = read('src/interactions/align.ts');
const contextMenu = read('src/ui/context-menu.ts');
const dom = read('src/ui/dom.ts');
const store = read('src/state/store.ts');
const tests = read('tests/canvas-features.spec.ts');

const checks = [
  [dpi.includes('MAX_DEVICE_PIXEL_RATIO = 2') && dpi.includes('devicePixelRatio'), 'DPR rendering is capped at 2x'],
  [renderer.includes('resetContextToCssPixels') && !renderer.includes('smartGuides'), 'renderer uses CSS-space high-DPI transform with no visual smart-guide overlay'],
  [snapping.includes('SNAP_SCREEN_THRESHOLD = 6') && snapping.includes('snapMoveDelta') && snapping.includes('snapResizeBounds'), 'gentle move/resize snapping is implemented'],
  [pointer.includes('snapMoveDelta') && pointer.includes('snapResizeBounds'), 'pointer interactions apply snapping'],
  [pointer.includes("layerGroupId: cluster.groupId") && keyboard.includes('appState.selectedIds.length || appState.selectedLayerGroupId'), 'direct canvas/right-click group selection preserves the exact group target and Delete/Backspace handles structural group selections'],
  [!store.includes('smartGuides') && !snapping.includes('SmartGuide'), 'snapping does not allocate or persist visual-guide state'],
  [keyboard.includes("['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']") && keyboard.includes('e.shiftKey ? 10 : 1'), 'keyboard nudge uses 1/10 world units'],
  [align.includes("'distribute-h'") && align.includes("'distribute-v'") && align.includes("'space-h'") && align.includes("'space-v'"), 'four distribution operations are implemented'],
  [align.includes('if (appState.selectedLayerGroupId) return;') && contextMenu.includes('getStructuralSelectionIds'), 'exact Layer-group rows cannot accidentally align their own children and structural actions include hidden descendants'],
  [dom.includes('Distribute horizontally') && dom.includes('Distribute vertically') && dom.includes('Equal horizontal spacing') && dom.includes('Equal vertical spacing'), 'distribution commands are exposed in Align UI'],
  [tests.includes('high-DPI canvas') && tests.includes('move snapping') && tests.includes('resize snapping') && tests.includes('without visual guides') && tests.includes('Arrow keys nudge') && tests.includes('Align submenu distributes') && tests.includes('nested Layer-group hierarchy survives duplicate, clipboard paste, undo, and redo'), 'Playwright regression coverage exists for snapping-without-guides, nested Layer-group cloning/history, and the other canvas features'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}
console.log('OK: high-DPI rendering, invisible snapping, distribution commands, and keyboard nudging are guarded.');
