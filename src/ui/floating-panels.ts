import { redraw, requestVisualFrame } from '../renderer/index';
import { resizeCanvasForHighDpi } from '../renderer/dpi';
import { dispatch } from '../state/store';
import { appDiv, canvas } from './dom';
import { resize as legacyResize, syncHistoryBarPosition } from './inspector';

type HorizontalAnchor = 'left' | 'right';

type ViewportSize = {
    width: number;
    height: number;
};

const PANEL_SAFE_MARGIN = 8;
const DEFAULT_EDGE_OFFSET = 18;
const DEFAULT_TOP_OFFSET = 18;

function getViewportSize(): ViewportSize {
    return { width: window.innerWidth, height: window.innerHeight };
}

function isFloatingPanel(node: Element | null): node is HTMLElement {
    return node instanceof HTMLElement && (node.id === 'all-layers-panel' || node.id === 'inspector-panel');
}

function getFloatingPanels(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('#all-layers-panel, #inspector-panel'));
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

    const wasDragged = panel.dataset.userPositioned === '1';
    if (!wasDragged) {
        if (panel.id === 'inspector-panel') {
            setPanelAnchor(panel, 'right', DEFAULT_EDGE_OFFSET, DEFAULT_TOP_OFFSET);
            // inspector.ts still calls its legacy position helper when content
            // changes. A truthy compatibility marker prevents that helper from
            // restoring the obsolete 228px default while real drags still write 1.
            panel.dataset.userPositioned = 'responsive';
        }
        else {
            setPanelAnchor(panel, 'left', DEFAULT_EDGE_OFFSET, DEFAULT_TOP_OFFSET);
        }
        return;
    }

    capturePanelAnchor(panel);
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

    // The collapsed Properties rule historically forced right:18px!important.
    // Inline important coordinates let the stored anchor remain authoritative for
    // both collapsed and expanded sizes without changing control/font scaling.
    panel.style.setProperty('left', `${Math.round(left)}px`, 'important');
    panel.style.setProperty('right', 'auto', 'important');
    panel.style.setProperty('top', `${Math.round(top)}px`, 'important');
    panel.style.setProperty('bottom', 'auto', 'important');
}

export function reflowFloatingPanels(viewport = getViewportSize()) {
    for (const panel of getFloatingPanels())
        positionFloatingPanel(panel, viewport);
}

function reflowFloatingPanelsTask() {
    reflowFloatingPanels();
}

function requestFloatingPanelReflow() {
    requestVisualFrame(reflowFloatingPanelsTask);
}

function initializeKnownPanels() {
    for (const panel of getFloatingPanels()) {
        initializePanelAnchor(panel);
        positionFloatingPanel(panel);
    }
}

// The existing drag helper owns the pointer gesture. Its active handle identifies
// exactly which panel finished moving, so a temporary viewport clamp on another
// panel never overwrites that panel's saved edge offset.
window.addEventListener('pointerup', () => {
    const handle = document.querySelector<HTMLElement>('.panel-drag-handle.dragging');
    const panel = handle?.closest<HTMLElement>('#all-layers-panel, #inspector-panel') ?? null;
    if (!panel)
        return;
    queueMicrotask(() => {
        capturePanelAnchor(panel);
        positionFloatingPanel(panel);
    });
});

const panelObserver = new MutationObserver(records => {
    let needsReflow = false;
    for (const record of records) {
        if (record.type === 'childList') {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element))
                    continue;
                if (isFloatingPanel(node))
                    initializePanelAnchor(node);
                node.querySelectorAll<HTMLElement>('#all-layers-panel, #inspector-panel').forEach(initializePanelAnchor);
            }
            needsReflow = true;
            continue;
        }
        if (record.type === 'attributes') {
            const target = record.target instanceof Element ? record.target : null;
            const panel = target?.closest('#all-layers-panel, #inspector-panel') ?? null;
            if (isFloatingPanel(panel) && !document.body.classList.contains('panel-dragging'))
                needsReflow = true;
        }
    }
    if (needsReflow)
        requestFloatingPanelReflow();
});

panelObserver.observe(appDiv, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'hidden'],
});

function applyResponsiveResize() {
    dispatch({ type: 'SET_INTERACTION', patch: { moveBackgroundCanvas: null, moveSelectionCanvas: null } });
    const viewport = getViewportSize();
    resizeCanvasForHighDpi(canvas);
    syncHistoryBarPosition();
    reflowFloatingPanels(viewport);
}

function requestResponsiveResize() {
    // Windows/Tauri can emit several resize events during maximize/restore.
    // The renderer Set deduplicates this task and paints once after it runs.
    requestVisualFrame(applyResponsiveResize);
}

export function resize() {
    // Preserve Rimmap's synchronous startup resize before recovery loading.
    applyResponsiveResize();
    redraw();
}

// inspector.ts historically installed the resize listener itself. Replace that
// listener with the shared-frame responsive resize path while keeping the rest
// of the inspector module and its public API unchanged.
window.removeEventListener('resize', legacyResize);
window.addEventListener('resize', requestResponsiveResize);
initializeKnownPanels();
