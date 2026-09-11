type HorizontalAnchor = 'left' | 'right';

type ViewportSize = {
    width: number;
    height: number;
};

const PANEL_SAFE_MARGIN = 8;
const DEFAULT_EDGE_OFFSET = 18;
const DEFAULT_TOP_OFFSET = 18;
const PANEL_SELECTOR = '#all-layers-panel, #inspector-panel';

let reflowFrame: number | null = null;

function getViewportSize(): ViewportSize {
    return { width: window.innerWidth, height: window.innerHeight };
}

function isFloatingPanel(node: Element | null): node is HTMLElement {
    return node instanceof HTMLElement && (node.id === 'all-layers-panel' || node.id === 'inspector-panel');
}

function getFloatingPanels(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(PANEL_SELECTOR));
}

function configurePanelSizing(panel: HTMLElement) {
    panel.style.maxWidth = `calc(100vw - ${PANEL_SAFE_MARGIN * 2}px)`;
    panel.style.maxHeight = `calc(100vh - ${PANEL_SAFE_MARGIN * 2}px)`;
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    if (panel.id === 'inspector-panel') {
        const content = panel.querySelector<HTMLElement>('.inspector-content');
        if (content) {
            content.style.minHeight = '0';
            content.style.flex = '1 1 auto';
            content.style.overflowY = 'auto';
            content.style.overscrollBehavior = 'contain';
        }
    }
    else {
        const list = panel.querySelector<HTMLElement>('.all-layers-list');
        if (list) {
            list.style.minHeight = '0';
            list.style.flex = '1 1 auto';
            list.style.overflowY = 'auto';
            list.style.overscrollBehavior = 'contain';
        }
    }
}

function setPanelAnchor(panel: HTMLElement, anchor: HorizontalAnchor, horizontalOffset: number, verticalOffset: number) {
    panel.dataset.panelHorizontalAnchor = anchor;
    panel.dataset.panelHorizontalOffset = String(Math.max(PANEL_SAFE_MARGIN, horizontalOffset));
    panel.dataset.panelVerticalOffset = String(Math.max(PANEL_SAFE_MARGIN, verticalOffset));
}

function capturePanelAnchor(panel: HTMLElement, viewport = getViewportSize()) {
    configurePanelSizing(panel);
    const rect = panel.getBoundingClientRect();
    if (!rect.width || !rect.height)
        return;
    const leftDistance = Math.max(0, rect.left);
    const rightDistance = Math.max(0, viewport.width - rect.right);
    const anchor: HorizontalAnchor = leftDistance <= rightDistance ? 'left' : 'right';
    setPanelAnchor(panel, anchor, anchor === 'left' ? leftDistance : rightDistance, rect.top);
}

function initializePanelAnchor(panel: HTMLElement) {
    configurePanelSizing(panel);
    if (panel.dataset.panelHorizontalAnchor)
        return;

    if (panel.dataset.userPositioned === '1') {
        capturePanelAnchor(panel);
        return;
    }

    if (panel.id === 'inspector-panel') {
        setPanelAnchor(panel, 'right', DEFAULT_EDGE_OFFSET, DEFAULT_TOP_OFFSET);
        // inspector.ts still owns Properties creation/content updates. A truthy
        // compatibility marker prevents its legacy helper from restoring the old
        // top:228px default. A real drag replaces this value with "1".
        panel.dataset.userPositioned = 'responsive';
    }
    else {
        setPanelAnchor(panel, 'left', DEFAULT_EDGE_OFFSET, DEFAULT_TOP_OFFSET);
    }
}

function numericDataset(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function positionFloatingPanel(panel: HTMLElement, viewport = getViewportSize()) {
    initializePanelAnchor(panel);
    configurePanelSizing(panel);

    const rect = panel.getBoundingClientRect();
    if (!rect.width || !rect.height)
        return;

    const anchor: HorizontalAnchor = panel.dataset.panelHorizontalAnchor === 'right' ? 'right' : 'left';
    const horizontalOffset = numericDataset(panel.dataset.panelHorizontalOffset, DEFAULT_EDGE_OFFSET);
    const verticalOffset = numericDataset(panel.dataset.panelVerticalOffset, DEFAULT_TOP_OFFSET);
    const desiredLeft = anchor === 'right'
        ? viewport.width - rect.width - horizontalOffset
        : horizontalOffset;
    const maxLeft = Math.max(PANEL_SAFE_MARGIN, viewport.width - rect.width - PANEL_SAFE_MARGIN);
    const maxTop = Math.max(PANEL_SAFE_MARGIN, viewport.height - rect.height - PANEL_SAFE_MARGIN);
    const left = Math.min(Math.max(PANEL_SAFE_MARGIN, desiredLeft), maxLeft);
    const top = Math.min(Math.max(PANEL_SAFE_MARGIN, verticalOffset), maxTop);

    // Important inline coordinates intentionally override the historical collapsed
    // Properties rule that forced right:18px. pointerdown temporarily removes the
    // priority again so the existing drag helper can keep owning the gesture.
    panel.style.setProperty('left', `${Math.round(left)}px`, 'important');
    panel.style.setProperty('right', 'auto', 'important');
    panel.style.setProperty('top', `${Math.round(top)}px`, 'important');
    panel.style.setProperty('bottom', 'auto', 'important');
}

export function reflowFloatingPanels(viewport = getViewportSize()) {
    for (const panel of getFloatingPanels())
        positionFloatingPanel(panel, viewport);
}

function scheduleFloatingPanelReflow() {
    if (reflowFrame !== null)
        return;
    reflowFrame = requestAnimationFrame(() => {
        reflowFrame = null;
        reflowFloatingPanels();
    });
}

function preparePanelForExistingDragHelper(panel: HTMLElement) {
    initializePanelAnchor(panel);
    const rect = panel.getBoundingClientRect();
    // setProperty without an !important priority deliberately makes the existing
    // inspector enablePanelDrag() assignments authoritative for the live gesture.
    panel.style.setProperty('left', `${rect.left}px`);
    panel.style.setProperty('top', `${rect.top}px`);
    panel.style.setProperty('right', 'auto');
    panel.style.setProperty('bottom', 'auto');
}

// Keep the existing inspector.ts drag implementation. This module only converts
// its final raw pixels into nearest-edge metadata once the gesture finishes.
window.addEventListener('pointerdown', event => {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest('.panel-drag-handle');
    const panel = handle?.closest(PANEL_SELECTOR) ?? null;
    if (isFloatingPanel(panel))
        preparePanelForExistingDragHelper(panel);
}, true);

window.addEventListener('pointerup', () => {
    const handle = document.querySelector<HTMLElement>('.panel-drag-handle.dragging');
    const panel = handle?.closest(PANEL_SELECTOR) ?? null;
    if (!isFloatingPanel(panel))
        return;
    capturePanelAnchor(panel);
    queueMicrotask(() => positionFloatingPanel(panel));
});

// Collapse/expand changes panel width. Recalculate from the same stored edge after
// the existing click handler has toggled the class.
document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('#btn-all-layers-toggle, #btn-inspector-collapse'))
        queueMicrotask(scheduleFloatingPanelReflow);
});

// Properties is created lazily and its visible sections change with selection.
// Observe only child insertion plus class/hidden changes; layout writes below do
// not touch those attributes, so this cannot recurse on its own positioning work.
const appRoot = document.getElementById('app');
if (appRoot) {
    const panelObserver = new MutationObserver(records => {
        let needsReflow = false;
        for (const record of records) {
            if (record.type === 'childList') {
                for (const node of record.addedNodes) {
                    if (!(node instanceof Element))
                        continue;
                    if (isFloatingPanel(node)) {
                        initializePanelAnchor(node);
                        needsReflow = true;
                    }
                    node.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach(panel => {
                        initializePanelAnchor(panel);
                        needsReflow = true;
                    });
                }
                continue;
            }
            const target = record.target instanceof Element ? record.target : null;
            const panel = target?.closest(PANEL_SELECTOR) ?? null;
            if (isFloatingPanel(panel) && !document.body.classList.contains('panel-dragging'))
                needsReflow = true;
        }
        if (needsReflow)
            scheduleFloatingPanelReflow();
    });
    panelObserver.observe(appRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'hidden'],
    });
}

// Keep Rimmap's original inspector resize/startup path intact. This listener only
// reflows DOM panels and does not import renderer/inspector/state modules, avoiding
// a new circular startup dependency in the packaged Tauri application.
window.addEventListener('resize', scheduleFloatingPanelReflow);

for (const panel of getFloatingPanels()) {
    initializePanelAnchor(panel);
    positionFloatingPanel(panel);
}
