import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const modules = new Map();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      modules.set(path.relative(root, full).replaceAll(path.sep, '/'), full);
    }
  }
}
walk(root);

function resolveRelative(fromModule, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(root, path.dirname(fromModule), specifier);
  const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    return path.relative(root, candidate).replaceAll(path.sep, '/');
  }
  return null;
}

const importPattern = /^import\s+(?:[^'\"]*?from\s+)?['\"]([^'\"]+)['\"]/gm;
const dynamicImportPattern = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g;
const graph = new Map();
for (const [name, filename] of modules) {
  const source = fs.readFileSync(filename, 'utf8');
  const deps = [];
  for (const match of source.matchAll(importPattern)) {
    const resolved = resolveRelative(name, match[1]);
    if (resolved) deps.push(resolved);
  }
  for (const match of source.matchAll(dynamicImportPattern)) {
    const resolved = resolveRelative(name, match[1]);
    if (resolved) deps.push(resolved);
  }
  graph.set(name, deps);
}

const reachable = new Set();
const stack = ['main.ts'];
while (stack.length) {
  const current = stack.pop();
  if (!current || reachable.has(current)) continue;
  reachable.add(current);
  for (const dep of graph.get(current) ?? []) stack.push(dep);
}

const requiredRuntimeModules = ['interactions/pointer.ts', 'ui/wiring.ts'];
for (const required of requiredRuntimeModules) {
  if (!reachable.has(required)) {
    console.error(`FAIL: ${required} is not reachable from main.ts; its event listeners will never be installed.`);
    process.exit(1);
  }
}

const unreachable = [...modules.keys()].filter(name => !reachable.has(name));
if (unreachable.length) {
  console.error(`FAIL: unreachable TypeScript modules: ${unreachable.join(', ')}`);
  process.exit(1);
}

console.log(`OK: all ${modules.size} runtime TypeScript modules are reachable from main.ts.`);
console.log('OK: pointer interactions and UI wiring are installed by the entry point.');
