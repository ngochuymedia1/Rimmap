import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const html = read('index.html');
const pkg = JSON.parse(read('package.json'));
const dom = read('src/ui/dom.ts');
const css = read('src/style.css');
const exportsSource = read('src/exports/index.ts');
const persistence = read('src/persistence/index.ts');
const handoff = read('AI_HANDOFF.md');

const assert = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

assert(pkg.name === 'rimmap', 'package identity is not Rimmap.');
assert(/<title>Rimmap<\/title>/.test(html) && /application-name" content="Rimmap/.test(html), 'browser/application title is not Rimmap.');
assert(fs.existsSync('public/rimmap-logo.png') && fs.existsSync('public/rimmap-icon.png') && fs.existsSync('public/rimmap-icon-64.png'), 'Rimmap logo/icon assets are missing.');
assert(dom.includes('project-brand-logo') && dom.includes('/rimmap-logo.png') && css.includes('.project-brand-logo'), 'Rimmap logo is not embedded in the project menu.');
assert(exportsSource.includes('`rimmap-${Date.now()}.svg`') && exportsSource.includes('`rimmap-${Date.now()}-${Math.round(appState.exportPngScale)}x.png`'), 'export filenames are not Rimmap-branded.');
assert(persistence.includes("description: 'Rimmap project'"), 'project picker description is not Rimmap-branded.');
// Rebrand must not invalidate existing v12 projects, recovery data, assets, or rich-text clipboard payloads.
assert(persistence.includes("SAFE_PROJECT_KEY = 'my-board-v12-current'") && persistence.includes("format: 'my-board-project'"), 'legacy persisted project identifiers were renamed; this would break compatibility.');
assert(handoff.includes('user-facing application name is **Rimmap**') && handoff.includes('intentionally retained for backward compatibility'), 'AI handoff does not document the branding/compatibility boundary.');

console.log('OK: Rimmap user-facing branding is applied while legacy project/storage identifiers remain backward compatible.');
