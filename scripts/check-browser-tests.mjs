import fs from 'node:fs';

const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };
const text = fs.readFileSync('tests/text-editor.regression.spec.ts', 'utf8');
const workflow = fs.readFileSync('tests/workflows.spec.ts', 'utf8');
const ids = fs.readFileSync('src/model/ids.ts', 'utf8');
const main = fs.readFileSync('src/main.ts', 'utf8');
const config = fs.readFileSync('playwright.config.ts', 'utf8');

const requiredTextCases = [
  'new empty Note opens a visible editable surface',
  'Enter creates one canonical logical line per line break',
  'long words wrap instead of overflowing',
  'numbered lists survive',
  'bullet lists survive',
  'nested lists preserve',
  'Tab indents and Shift+Tab outdents',
  'forward and backward selections',
  'toolbar positioning stays inside',
  'Esc commits',
  'save/open preserves structured formatting',
  'Rectangle list nesting uses the same structural numbering as Note/Text',
  'Note and Rectangle editors respect padded shape text bounds and center positioning',
  'copy/paste preserves formatted list text and structure for text-bearing objects',
  'pasted bulleted/numbered lists can exit edit mode with Esc or an outside click',
  'copying only selected list items preserves the OL/UL container on paste',
  'numbered-list clipboard preserves visible numbering and structured HTML',
  'Properties omits arrow opacity and renders explicit Dots/Double SVG icons',
];
for (const name of requiredTextCases) if (!text.includes(name)) fail(`Missing text regression case: ${name}`);
if (!workflow.includes('bound arrow') || !workflow.includes('save → reload')) fail('Critical end-to-end workflow test is missing.');
if (!/cryptoApi\?\.randomUUID/.test(ids) || /Math\.random/.test(ids)) fail('ID generator is not based on crypto.randomUUID().');
if (!/import\('\.\/testing\/hooks'\)/.test(main)) fail('Test hooks are not gated behind the test query flag.');
if (!/webServer/.test(config) || !/Desktop Chrome/.test(config)) fail('Playwright browser configuration is incomplete.');

console.log('OK: Playwright text regressions, critical workflow coverage, test-only hooks, and UUID generation are present.');
