import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
const source = fs.readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
  .map(entry => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
  .join('\n');

function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

for (const token of [
  '--surface', '--surface-raised', '--border', '--text-primary', '--text-muted', '--accent',
  '--radius-sm', '--radius-md', '--shadow-panel', '--space-1', '--space-2',
]) {
  if (!css.includes(`${token}:`)) fail(`missing design token ${token}`);
}

const forbidden = [
  'color-popover', 'custom-color-popover', 'color-current-preview', 'color-collapse-btn',
  'color-recent-row', 'color-quick-row', 'panel-icon-color', 'text-selection-toolbar', 'alignment-menu',
  'arrow-type-icon', 'arrow-style-icon',
];
for (const className of forbidden) {
  if (new RegExp(`\\.${className}(?![\\w-])`).test(css)) fail(`obsolete selector .${className} is still present`);
}

// Every remaining class selector must correspond to a class/state name used by current TypeScript.
// Strip URLs first so domains such as fonts.googleapis.com are not mistaken for class selectors.
const selectorSurface = css.replace(/url\((?:[^)(]+|\([^)]*\))*\)/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const cssClasses = [...selectorSurface.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(match => match[1]);
const unused = [...new Set(cssClasses)].filter(className => !source.includes(className));
if (unused.length) fail(`CSS contains selectors with no current source reference: ${unused.join(', ')}`);

function findClose(text, open) {
  let depth = 1, quote = null, comment = false;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (comment) { if (c === '*' && n === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '/' && n === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

const selectors = [];
function collectRules(text, scope = 'root') {
  let start = 0, quote = null, comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (comment) { if (c === '*' && n === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '/' && n === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c !== '{') continue;
    const header = text.slice(start, i).trim().replace(/^.*?;\s*/s, '').trim();
    const close = findClose(text, i);
    if (close < 0) fail('unbalanced CSS braces');
    const body = text.slice(i + 1, close);
    if (header.startsWith('@')) collectRules(body, `${scope}/${header}`);
    else if (header) selectors.push(`${scope}::${header}`);
    i = close;
    start = close + 1;
  }
}
collectRules(css);
const seen = new Set();
for (const selector of selectors) {
  if (seen.has(selector)) fail(`duplicate selector remains after consolidation: ${selector.split('::').pop()}`);
  seen.add(selector);
}

const afterTokens = css.slice(css.indexOf('/* ===== Foundation & canvas ===== */'));
for (const literal of ['#18181b', '#27272a', '#3f3f46', '#71717a', '#e4e4e7', '#a1a1aa', '#f4f4f5', '#fafafa']) {
  if (afterTokens.toLowerCase().includes(literal)) fail(`repeated neutral literal ${literal} should use a design token`);
}

for (const effect of ['box-shadow:', 'backdrop-filter:', '-webkit-backdrop-filter:', 'transition:', 'animation:', 'filter:']) {
  if (css.includes(effect)) fail(`performance-first CSS still contains ${effect}`);
}

console.log(`OK: CSS is tokenized and consolidated (${selectors.length} rules, no duplicate selectors, no obsolete controls, no animated/blurred/shadow effects).`);
