import fs from 'node:fs';

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };
const read = file => fs.readFileSync(file, 'utf8');
const types = read('src/model/types.ts');
const text = read('src/model/text.ts');
const renderer = read('src/renderer/index.ts');
const shapes = read('src/renderer/shapes.ts');
const editor = read('src/text-editor/index.ts');
const inspector = read('src/ui/inspector.ts');
const css = read('src/style.css');
const migrations = read('src/persistence/migrations.ts');
const tests = read('tests/text-editor.regression.spec.ts');

if (!/export type TextVerticalAlign\s*=\s*'top'\s*\|\s*'middle'/.test(types)) fail('Shape vertical text alignment type is missing.');
if ((types.match(/textVerticalAlign\?: TextVerticalAlign/g) || []).length < 2) fail('Note and Rectangle do not both persist vertical text alignment.');
const padX = Number(text.match(/TEXT_PAD_X\s*=\s*(\d+)/)?.[1]);
const padY = Number(text.match(/TEXT_PAD_Y\s*=\s*(\d+)/)?.[1]);
if (!(padX >= 6 && padY >= 6)) fail('Note/Rectangle text padding is too small or missing.');
if (!renderer.includes("el.textVerticalAlign === 'middle'") || !renderer.includes('TEXT_PAD_X * 2') || !renderer.includes('TEXT_PAD_Y * 2')) fail('Canvas shape-text renderer does not use canonical padding/vertical centering.');
if (!editor.includes("shell.dataset.kind !== 'note' && shell.dataset.kind !== 'rectangle'") || !editor.includes("el.textVerticalAlign === 'middle'")) fail('HTML shape editor is not kept in sync with padded/centered shape text.');
if (!inspector.includes('data-shape-text-position="top-left"') || !inspector.includes('data-shape-text-position="center"')) fail('Properties is missing the shape text-position control.');
if (/>\s*Opacity\s*</i.test(inspector) || /arrow-opacity|data-arrow-opacity/i.test(inspector)) fail('Retired Arrow opacity control is still present in Properties.');
if (!/style === 'dots'[\s\S]*<circle[^>]+cx="7"[\s\S]*<circle[^>]+cx="41"/.test(inspector)) fail('Dots arrow-style icon is not explicit endpoint-dot SVG geometry.');
if (!/style === 'double'[\s\S]*M12 3 7 8l5 5M36 3l5 5-5 5/.test(inspector)) fail('Double arrow-style icon is not explicit two-headed SVG geometry.');
for (const expensive of ['backdrop-filter', 'box-shadow:', 'transition:', 'animation:', 'will-change']) {
  if (css.includes(expensive)) fail(`Performance CSS still contains ${expensive}`);
}
if (!editor.includes("editor.addEventListener('copy'") || !editor.includes("setData('text/html'") || !editor.includes('textDocumentClipboardText')) fail('Rich list clipboard copy projection is missing.');
if (!editor.includes("editor.addEventListener('paste'") || !editor.includes('textDocumentFromHtml') || !editor.includes('textDocumentToHtml')) fail('Rich list clipboard paste canonicalization is missing.');
if (!editor.includes("querySelectorAll('li[value]')") || !editor.includes("querySelectorAll('ol[start]')")) fail('Browser list counter cleanup is missing.');
if (!shapes.includes("roundedRectPath(c, b.x + 5, b.y + 5, b.width, b.height, radius)") || !shapes.includes("export const NOTE_DEFAULT_FILL = '#FFF4C7'") || !shapes.includes("c.strokeStyle = '#3F3D36'")) fail('Reference-style sticky Note treatment is missing.');
if (!editor.includes("document.addEventListener('keydown', onEditorDocumentKeyDown, true)") || !editor.includes('isTextEditorUiTarget') || !editor.includes('ensureEditorFocusAndCaret')) fail('Rich-list paste exit/focus recovery is missing.');
if (!migrations.includes('migrateV8ToV9') || !migrations.includes('textVerticalAlign')) fail('Schema v9 shape-text/list migration is missing.');
for (const required of [
  'Rectangle list nesting uses the same structural numbering as Note/Text',
  'Note and Rectangle editors respect padded shape text bounds and center positioning',
  'copy/paste preserves formatted list text and structure for text-bearing objects',
  'pasted bulleted/numbered lists can exit edit mode with Esc or an outside click',
  'numbered-list clipboard preserves visible numbering and structured HTML',
  'untouched empty Note reopens on the first logical line',
  'numbered list paste works immediately in Note, Rectangle, and Text without waiting for a deferred caret',
  'Properties omits arrow opacity and renders explicit Dots/Double SVG icons',
]) if (!tests.includes(required)) fail(`Missing regression test: ${required}`);

console.log(`OK: shape padding/centering, structural lists, rich clipboard, performance-first UI, and Dots/Double icons are guarded.`);
