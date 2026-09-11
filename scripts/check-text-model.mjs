import fs from 'node:fs';

const types = fs.readFileSync('src/model/types.ts', 'utf8');
const model = fs.readFileSync('src/model/text-document.ts', 'utf8');
const editor = fs.readFileSync('src/text-editor/index.ts', 'utf8');
const commands = fs.readFileSync('src/text-editor/commands.ts', 'utf8');
const renderer = fs.readFileSync('src/renderer/index.ts', 'utf8');
const exportsSource = fs.readFileSync('src/exports/index.ts', 'utf8');
const migrations = fs.readFileSync('src/persistence/migrations.ts', 'utf8');
const persistence = fs.readFileSync('src/persistence/index.ts', 'utf8');

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };

if (!/export type TextDocument\s*=\s*\{[\s\S]*version:\s*1;[\s\S]*lines:\s*RichLine\[\]/.test(types)) fail('TextDocument is not the canonical structured model.');
if (!/textDoc\?:\s*TextDocument/.test(types) || !/labelDoc\?:\s*TextDocument/.test(types)) fail('Text-bearing elements do not reference TextDocument.');
if (/richText\?:|richLines\?:|labelRichText\?:|labelRichLines\?:|startLabelRichText\?:|endLabelRichText\?:/.test(types)) fail('Current element types still expose persisted editor HTML/richLines.');
if (!/textDocumentFromHtml/.test(editor) || !/textDocumentToHtml/.test(editor) || !/textDocumentPlainText/.test(editor)) fail('Editor is not projecting to/from the canonical TextDocument.');
if (!/canonicalLines\(/.test(renderer) || !/getElementRichTextLayout/.test(renderer)) fail('Canvas renderer is not consuming canonical TextDocument lines through the shared layout path.');
if (!/textDoc\?\.lines/.test(exportsSource)) fail('Export renderer is not consuming canonical textDoc lines.');
if (/document\.execCommand/.test(editor)) fail('Legacy execCommand leaked into the main editor module.');
if (!/document\.execCommand/.test(commands)) fail('Expected legacy compatibility boundary is missing.');
const allSource = fs.readdirSync('src', { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
  .map(entry => ({ path: `${entry.parentPath}/${entry.name}`, text: fs.readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8') }));
const leaked = allSource.filter(item => item.path.replaceAll('\\', '/').endsWith('/text-editor/commands.ts') === false && /document\.(?:execCommand|queryCommandState|queryCommandValue)/.test(item.text));
if (leaked.length) fail(`legacy contenteditable command API exists outside compatibility adapter: ${leaked.map(x => x.path).join(', ')}`);
if (!/insertPlainTextAtSelection/.test(editor) || /execCommand\(['"]insertText/.test(editor)) fail('Paste is still using execCommand instead of Selection/Range.');
if (!/migrateV7ToV8/.test(migrations) || !/delete item\[richTextKey\]/.test(migrations)) fail('v7→v8 text-model migration is missing legacy-field cleanup.');
if (!/currentSchemaElements/.test(persistence) || !/export function currentSchemaElements/.test(migrations)) fail('Current saves are not routed through current-schema field cleanup.');
if (!/delete target\[richTextKey\]/.test(migrations)) fail('Current-schema field cleanup does not strip legacy editor HTML/cache fields.');
if (/richTextLines\s*\(/.test(renderer)) fail('Renderer still owns an HTML→text parser; parsing belongs to the editor/model boundary.');
if (!/textDocumentFromHtml/.test(model) || !/textDocumentToHtml/.test(model)) fail('Canonical model lacks editor projection adapters.');

console.log('OK: TextDocument is canonical; editor HTML is ephemeral; canvas/export read the same model; execCommand is isolated behind one compatibility adapter.');
