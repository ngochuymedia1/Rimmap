import fs from 'node:fs';

const editor = fs.readFileSync(new URL('../src/text-editor/index.ts', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const closeStart = editor.indexOf('export function closeTextEditor');
const closeEnd = editor.indexOf('export function onEditorOutsidePointerDown', closeStart);
const closeBody = editor.slice(closeStart, closeEnd);
const teardown = closeBody.indexOf("textEditor: null");
const parse = closeBody.indexOf('textDocumentFromHtml');
if (teardown < 0 || parse < 0 || teardown > parse) {
  console.error('FAIL: text editor must be torn down before rich pasted DOM is parsed during commit.');
  process.exit(1);
}
if (!editor.includes("window.addEventListener('keydown', onEditorWindowKeyDown, true)")) {
  console.error('FAIL: missing window-capture Escape fallback for pasted rich text.');
  process.exit(1);
}
if (!editor.includes("document.addEventListener('pointerdown', onEditorOutsidePointerDown, true)")) {
  console.error('FAIL: missing document-capture outside-click exit for text editing.');
  process.exit(1);
}
if (!/data-kind="note"[\s\S]*data-kind="rectangle"[\s\S]*overflow-y:\s*auto\s*!important/.test(css)) {
  console.error('FAIL: Note/Rectangle editors must clip/scroll pasted content instead of overflowing over the canvas.');
  process.exit(1);
}
const copyStart = editor.indexOf("editor.addEventListener('copy', e => {");
const copyEnd = editor.indexOf("editor.addEventListener('paste', e => {", copyStart);
const copyBody = editor.slice(copyStart, copyEnd);
if (copyStart < 0 || !copyBody.includes('e.preventDefault()') || !copyBody.includes("setData('text/html', payload.html)")) {
  console.error('FAIL: editor copy must own the clipboard write so Chromium cannot overwrite canonical list HTML.');
  process.exit(1);
}
if (!editor.includes('clipboardTextWithoutListMarkers') || !editor.includes('isClipboardSurfaceWhite')) {
  console.error('FAIL: clipboard recovery must match markerless list text and strip native white editor-surface backgrounds.');
  process.exit(1);
}
console.log('OK: rich-list paste cannot trap text editing; Esc/outside-click teardown is fail-safe and shape editors are clipped.');
