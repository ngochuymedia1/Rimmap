import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };

const panels = read('src/ui/floating-panels.ts');
const main = read('src/main.ts');
const style = read('src/style.css');
const tests = read('tests/floating-panels.spec.ts');

if (!main.includes("import './ui/floating-panels';") || !main.includes("import { resize } from './ui/inspector';"))
  fail('responsive panels must remain a DOM-only side effect while bootstrap keeps inspector.resize()');
if (/from ['"]\.\.\/(renderer|state)\//.test(panels) || /from ['"]\.\/inspector['"]/.test(panels))
  fail('floating panel layout reintroduced a renderer/state/inspector startup dependency');
if (!panels.includes("type HorizontalAnchor = 'left' | 'right'"))
  fail('floating panels do not store a horizontal edge anchor');
if (!panels.includes('panel.dataset.panelHorizontalOffset') || !panels.includes('panel.dataset.panelVerticalOffset'))
  fail('floating panels do not preserve edge/top offsets');
if (!panels.includes("panel.id === 'inspector-panel'") || !panels.includes("setPanelAnchor(panel, 'right'"))
  fail('Properties does not default to a right-edge anchor');
if (!panels.includes("setPanelAnchor(panel, 'left'"))
  fail('Layers does not default to a left-edge anchor');
if (!panels.includes('PANEL_SAFE_MARGIN = 8') || !panels.includes('maxLeft') || !panels.includes('maxTop'))
  fail('floating panels are not clamped to a safe viewport margin');
if (!panels.includes("content.style.overflowY = 'auto'") || !panels.includes("list.style.overflowY = 'auto'"))
  fail('short viewports do not scroll panel content internally');
if (!panels.includes("window.addEventListener('resize', scheduleFloatingPanelReflow)"))
  fail('floating-panel resize reflow is not frame-coalesced');
if (!panels.includes('new MutationObserver') || !panels.includes("attributeFilter: ['class', 'hidden']"))
  fail('lazy Properties creation/content-size changes are not covered by responsive reflow');
if (!style.includes('left: 50%;') || !style.includes('bottom: 22px;') || !style.includes('transform: translateX(-50%);'))
  fail('bottom toolbar no longer uses its bottom-center relationship');
if (!tests.includes('dragged panels preserve their nearest edge offset through resize') ||
    !tests.includes('temporary viewport clamping does not overwrite a dragged edge offset') ||
    !tests.includes('collapsed and expanded floating panels keep the same anchors') ||
    !tests.includes('short viewports constrain panel height and scroll content instead of scaling controls'))
  fail('responsive floating-panel browser regressions are incomplete');

console.log('OK: floating panels use DOM-only edge anchors, safe clamping, scrolling, and frame-coalesced reflow without changing bootstrap resize ownership.');
