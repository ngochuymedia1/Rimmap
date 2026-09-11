import fs from 'node:fs';

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };
const read = path => fs.readFileSync(path, 'utf8');
const source = [
  'src/main.ts',
  'src/persistence/index.ts',
  'src/ui/wiring.ts',
  'src/ui/context-menu.ts',
  'src/ui/dialogs.ts',
  'src/desktop/index.ts',
  'src/shortcuts/index.ts',
  'src/shortcuts/definitions.ts',
  'src/ui/dom.ts',
  'src/style.css',
].map(read).join('\n');

if (/window\.(alert|confirm|prompt)\s*\(/.test(source)) fail('browser alert/confirm/prompt remains in current UI code');
if (!read('src/shortcuts/definitions.ts').includes("defaultBinding: 'Ctrl+N'")) fail('New project is not Ctrl+N by default');
if (!read('src/shortcuts/index.ts').includes("binding === 'Ctrl+Alt+N'")) fail('historical Ctrl+Alt+N preference migration is missing');
if (/project-status|V5\.5-NO-TEXT-TOOL/.test(read('src/ui/dom.ts') + read('src/persistence/index.ts'))) fail('technical project status/build strip is still user-visible');
if (!read('src/ui/dom.ts').includes('id="project-exit"')) fail('desktop Exit command is missing from File menu');
if (!read('src/ui/dialogs.ts').includes("title: 'Unsaved changes'")) fail('custom unsaved-exit dialog is missing');
if (!read('src/main.ts').includes('installDesktopCloseGuard')) fail('desktop close guard is not installed');
if (!read('src/persistence/index.ts').includes('chooseProjectSavePath')) fail('desktop Save does not use a native save picker');
if (!read('src/persistence/index.ts').includes('writeDesktopFile')) fail('desktop Save does not write through Tauri filesystem access');
if (!read('src/persistence/index.ts').includes('chooseProjectOpenPath')) fail('desktop Open does not use a native picker');
if (!read('src/style.css').includes('.rimmap-dialog') || !read('src/style.css').includes('border-radius: 18px')) fail('modern rounded Rimmap dialog styling is missing');

console.log('OK: desktop save/open, Ctrl+N, Rimmap dialogs, clean File menu, and unsaved-exit guard are wired.');
