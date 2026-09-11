import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const storePath = path.join(root, 'state', 'store.ts');
const store = fs.readFileSync(storePath, 'utf8');

const requiredActions = ['MOVE_ELEMENTS', 'DELETE_ELEMENTS', 'LOCK_ELEMENTS', 'SET_ELEMENTS_HIDDEN', 'UPDATE_STYLE', 'CREATE_ARROW', 'GROUP_LAYER_SELECTION', 'UNGROUP_LAYER_SELECTION'];
for (const action of requiredActions) {
  if (!store.includes(`type: '${action}'`)) {
    console.error(`FAIL: central store is missing ${action}.`);
    process.exit(1);
  }
}
if (!store.includes('appState: Readonly<AppState>')) {
  console.error('FAIL: feature modules no longer receive a read-only appState facade.');
  process.exit(1);
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.ts') && full !== storePath) files.push(full);
  }
}
walk(root);

const forbidden = [
  [/appState\.[A-Za-z_$][\w$]*\s*(?:=(?!=)|\+=|-=|\*=|\/=|\+\+|--)/g, 'direct appState assignment'],
  [/appState\.camera\.(?:x|y|zoom)\s*(?:=(?!=)|\+=|-=|\*=|\/=)/g, 'direct camera mutation'],
  [/appState\.(?:elements|selectedIds|historyPast|historyFuture|pendingLocalSaveResolvers)\.(?:push|pop|splice|shift|unshift|sort|reverse)\s*\(/g, 'mutating a store-owned array'],
  [/appState\.(?:eraserPreviewIds|movingSelectionIds|initialElementsById)\.(?:add|delete|clear|set)\s*\(/g, 'mutating a store-owned Set/Map'],
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [pattern, description] of forbidden) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split('\n').length;
    console.error(`FAIL: ${description} in ${path.relative(root, file)}:${line}: ${match[0]}`);
    process.exit(1);
  }
}

const usage = {
  MOVE_ELEMENTS: ['interactions/pointer.ts', 'interactions/align.ts'],
  DELETE_ELEMENTS: ['interactions/keyboard.ts', 'ui/context-menu.ts'],
  LOCK_ELEMENTS: ['ui/context-menu.ts'],
  SET_ELEMENTS_HIDDEN: ['layers/index.ts'],
  UPDATE_STYLE: ['ui/inspector.ts'],
  CREATE_ARROW: ['interactions/pointer.ts', 'interactions/keyboard.ts'],
  GROUP_LAYER_SELECTION: ['ui/context-menu.ts'],
  UNGROUP_LAYER_SELECTION: ['ui/context-menu.ts'],
};
for (const [action, modules] of Object.entries(usage)) {
  if (!modules.some(module => fs.readFileSync(path.join(root, module), 'utf8').includes(`type: '${action}'`))) {
    console.error(`FAIL: ${action} exists but is not used by its feature modules.`);
    process.exit(1);
  }
}

console.log(`OK: ${files.length} feature modules use the central store without direct appState writes.`);
console.log(`OK: explicit document actions are present and wired: ${requiredActions.join(', ')}.`);
