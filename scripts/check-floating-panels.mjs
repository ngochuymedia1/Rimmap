import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const fail = message => { console.error(`FAIL: ${message}`); process.exit(1); };

const panels = read('src/ui/floating-panels.ts');
const main = read('src/main.ts');
const style = read('src/style.css');
const tests = read('tests/floating-panels.spec.ts');

if (!main.includes("import { resize } from './ui/floating-panels';"))
  fail('application bootstrap does not use the responsive floating-panel coordinator');
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
if (!panels.includes('requestVisualFrame(applyResponsiveResize)'))
  fail('window resize is not coalesced through the shared visual-frame scheduler');
if (!panels.includes("window.removeEventListener('resize', legacyResize)"))
  fail('legacy independent resize listener is still active alongside responsive resize');
if (!style.includes('left: 50%;') || !style.includes('bottom: 22px;') || !style.includes('transform: translateX(-50%);'))
  fail('bottom toolbar no longer uses its bottom-center relationship');
if (!tests.includes('dragged panels preserve their nearest edge offset through resize') ||
    !tests.includes('temporary viewport clamping does not overwrite a dragged edge offset') ||
    !tests.includes('collapsed and expanded floating panels keep the same anchors') ||
    !tests.includes('short viewports constrain panel height and scroll content instead of scaling controls'))
  fail('responsive floating-panel browser regressions are incomplete');

console.log('OK: floating panels use responsive edge anchors, safe clamping, scrolling, and shared-frame resize work.');
