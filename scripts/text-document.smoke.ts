import { clipboardTextHasListMarkers, normalizeTextDocument, textDocumentClipboardText, textDocumentFromClipboardText, textDocumentFromLines, textDocumentFromPlainText, textDocumentPlainText, textDocumentToHtml } from '../src/model/text-document';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const listDoc = textDocumentFromLines([
  { listType: 'number', listIndex: 1, numberPath: [1], indent: 0, runs: [{ text: 'Alpha', bold: true, color: '#111827' }] },
  { listType: 'number', listIndex: 2, numberPath: [2], indent: 0, runs: [{ text: 'Beta', italic: true, color: '#111827' }] },
  { listType: 'check', checked: true, runs: [{ text: 'Done', underline: true, color: '#111827' }] },
]);
assert(listDoc.version === 1, 'TextDocument version must be stable');
assert(textDocumentPlainText(listDoc) === 'Alpha\nBeta\nDone', 'Plain text must be derived from structured lines');
assert(listDoc.lines[0].listType === 'number' && listDoc.lines[0].runs[0].bold === true, 'List/run metadata must survive canonical construction');

const cloned = normalizeTextDocument(listDoc, '', '#111827');
cloned.lines[0].runs[0].text = 'Changed';
assert(listDoc.lines[0].runs[0].text === 'Alpha', 'TextDocument normalization must not share mutable run references');

const plain = textDocumentFromPlainText('One\nTwo', '#222222');
assert(plain.lines.length === 2 && plain.lines[1].runs[0].text === 'Two', 'Plain text conversion must preserve logical lines');
assert(plain.lines.every(line => line.runs[0].color === '#222222'), 'Plain conversion must preserve the element base color');

const emptyHtml = textDocumentToHtml(textDocumentFromPlainText('', '#222222'));
assert(emptyHtml === '<div><br></div>', 'Empty canonical lines must use a <br> editor placeholder, never an empty styled span');



const nestedNumbers = textDocumentFromLines([
  { listType: 'number', indent: 0, runs: [{ text: 'One', color: '#111827' }] },
  { listType: 'number', indent: 1, runs: [{ text: 'Child', color: '#111827' }] },
  { listType: 'number', indent: 0, runs: [{ text: 'Two', color: '#111827' }] },
]);
assert(JSON.stringify(nestedNumbers.lines.map(line => line.numberPath)) === JSON.stringify([[1], [1, 1], [2]]), 'Ordered-list numbering must be derived from structural indent, not stale DOM values');
const nestedHtml = textDocumentToHtml(nestedNumbers);
assert(!/\s(?:start|value)=/i.test(nestedHtml), 'Editor HTML must not persist explicit ordered-list start/value metadata');
assert(textDocumentClipboardText(nestedNumbers) === '1. One\n  1.1. Child\n2. Two', 'Clipboard plain text must preserve visible ordered-list markers and nesting');


const clipboardRecovered = textDocumentFromClipboardText('some text\n1. First\n2. Second\n  2.1. Child\n• Bullet', '#111827');
assert(clipboardTextHasListMarkers('1. First\n2. Second'), 'Clipboard marker detection must recognize ordered lists');
assert(clipboardRecovered.lines[0].listType === undefined, 'Plain clipboard lines must remain plain text');
assert(clipboardRecovered.lines[1].listType === 'number' && clipboardRecovered.lines[2].listType === 'number', 'Numbered clipboard lines must recover list metadata');
assert(clipboardRecovered.lines[3].listType === 'number' && clipboardRecovered.lines[3].indent === 1, 'Nested numeric clipboard markers must recover list depth');
assert(clipboardRecovered.lines[4].listType === 'bullet', 'Bullet clipboard markers must recover bullet metadata');

console.log('OK: canonical TextDocument preserves lines, structural list numbering, clipboard recovery, editor placeholders, formatting, and immutability.');
