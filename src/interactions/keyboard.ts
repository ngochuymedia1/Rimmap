// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { setTool } from './tools';
import { moveElementsAndBindings } from './movement';
import { findElementsAtPoint, nextAutoLayerName, requestLayersPanelRefresh } from '../layers/index';
import { anchorFromPoint, closestConnectionPair, closestPointOnBounds, elementCenter, getBoundingBox, getScreenToWorld, isConnectableShape, lerpPoint, rectsIntersect } from '../model/geometry';
import { generateId } from '../model/ids';
import { ArrowElement, BindingAnchor, Bounds, CanvasElement, ConnectionPoint, Point } from '../model/types';
import { newProject, openProject, saveProject, saveProjectAs, saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { getCanvasCssSize } from '../renderer/dpi';
import { keyboardEventToBinding, setShortcutPanelOpen, shortcutMatches } from '../shortcuts/index';
import { beginHistoryTransaction, commitHistory, redo, undo } from '../state/history';
import { appState, dispatch } from '../state/store';
import { arrangeSelection, cloneSelectionHierarchy, copyRuntimeMediaReference, copySelectionToClipboard, deleteSelectedObjects, getStructuralSelectionIds, groupSelectedObjects, lockSelectedObjects, pasteFromClipboard, selectionContainsLocked, ungroupSelectedObjects } from '../ui/context-menu';
import { canvas } from '../ui/dom';
import { updateTextStylePanel } from '../ui/inspector';
import { clipboardHasMediaPayload, imageFilesFromClipboard, insertMediaFiles, showMediaImportFailure } from '../media/import';

export function getAutoArrowAnchor(el: CanvasElement, toward: Point): Point {
    if (isConnectableShape(el)) {
        const b = getBoundingBox(el);
        return closestPointOnBounds(toward, b);
    }
    return elementCenter(el);
}

export function createArrowBetweenSelectedObjects() {
    if (appState.selectedIds.length !== 2)
        return false;
    const first = appState.elements.find(el => el.id === appState.selectedIds[0]), second = appState.elements.find(el => el.id === appState.selectedIds[1]);
    if (!first || !second || first.id === second.id)
        return false;
    const before = beginHistoryTransaction();
    let start: Point, end: Point;
    let startPoint: ConnectionPoint | undefined, endPoint: ConnectionPoint | undefined, startAnchor: BindingAnchor | undefined, endAnchor: BindingAnchor | undefined;
    if (isConnectableShape(first) && isConnectableShape(second)) {
        const pair = closestConnectionPair(first, second);
        start = pair.a.position;
        end = pair.b.position;
        startPoint = pair.a.point;
        endPoint = pair.b.point;
        startAnchor = anchorFromPoint(start, getBoundingBox(first));
        endAnchor = anchorFromPoint(end, getBoundingBox(second));
    }
    else {
        start = getAutoArrowAnchor(first, elementCenter(second));
        end = getAutoArrowAnchor(second, elementCenter(first));
    }
    const middle = lerpPoint(start, end, .5);
    const arrow: ArrowElement = { id: generateId(), type: 'arrow', start, control: middle, controls: [middle], pointCount: 3, end, arrowMode: 'connection', routingMode: 'manual', style: 'line', curveMode: 'smooth', color: appState.arrowColor, thickness: appState.currentThickness, opacity: 1, name: nextAutoLayerName('arrow') };
    if (isConnectableShape(first)) {
        arrow.startBinding = first.id;
        arrow.startBindingPoint = startPoint;
        arrow.startBindingAnchor = startAnchor ?? anchorFromPoint(start, getBoundingBox(first));
    }
    if (isConnectableShape(second)) {
        arrow.endBinding = second.id;
        arrow.endBindingPoint = endPoint;
        arrow.endBindingAnchor = endAnchor ?? anchorFromPoint(end, getBoundingBox(second));
    }
    dispatch({ type: 'CREATE_ARROW', arrow });
    dispatch({ type: 'SET_SELECTION', ids: [arrow.id] });
    setTool('select');
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
    return true;
}

let boardPasteSequence = 0;

window.addEventListener('paste', async event => {
    if (!appState.appReady || appState.textEditor || appState.shortcutBindings.paste !== 'Ctrl+V') return;
    const activeElement = document.activeElement as HTMLElement | null;
    const activeInput = activeElement?.tagName === 'INPUT' ? activeElement as HTMLInputElement : null;
    if ((activeInput && !activeInput.readOnly) || activeElement?.tagName === 'TEXTAREA' || activeElement?.isContentEditable)
        return;

    boardPasteSequence++;
    const images = imageFilesFromClipboard(event.clipboardData);
    if (images.length) {
        event.preventDefault();
        const anchor = getScreenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const inserted = await insertMediaFiles(images, anchor);
        if (!inserted) showMediaImportFailure('clipboard');
        return;
    }

    if (clipboardHasMediaPayload(event.clipboardData)) {
        event.preventDefault();
        showMediaImportFailure('clipboard');
        return;
    }

    if (appState.internalClipboard.elements.length) {
        event.preventDefault();
        pasteFromClipboard();
    }
});

window.addEventListener('keydown', async (e) => {
    if (!appState.appReady)
        return;
    const shortcutPanel = document.getElementById('keyboard-shortcuts-panel') as HTMLDivElement | null;
    if (shortcutPanel?.classList.contains('open')) {
        if (e.key === 'Escape') {
            e.preventDefault();
            setShortcutPanelOpen(false);
        }
        return;
    }
    if (appState.textEditor)
        return;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (appState.mode !== 'none')
            window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        dispatch({ type: 'SET_INTERACTION', patch: { mode: 'none', activeArrowPointIndex: null, activeArrowBranchId: null, activeArrowBranchPointIndex: null, activeArrowLabelMoveTarget: null } });
        dispatch({ type: 'SET_SELECTION', ids: [] });
        dispatch({ type: 'SET_HISTORY', patch: { pendingHistoryBefore: null } });
        redraw();
        updateTextStylePanel();
        requestLayersPanelRefresh();
        return;
    }
    // Space remains a fixed hold-to-pan gesture.
    if (e.code === 'Space') {
        if (!appState.isSpacePanning) {
            e.preventDefault();
            dispatch({ type: 'SET_TOOL_STATE', patch: { isSpacePanning: true, previousToolBeforeSpace: appState.activeTool } });
            canvas.className = 'panning';
        }
        return;
    }
    const activeElement = document.activeElement as HTMLElement | null;
    const activeInput = activeElement?.tagName === 'INPUT' ? activeElement as HTMLInputElement : null;
    // Readonly inputs in the Layers panel are selection surfaces, not editors.
    // Keep shortcuts active for them; only real text-editing controls suppress
    // canvas/object shortcuts.
    if ((activeInput && !activeInput.readOnly) || activeElement?.tagName === 'TEXTAREA' || activeElement?.isContentEditable)
        return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && appState.selectedIds.length && !selectionContainsLocked()) {
        e.preventDefault();
        const amount = e.shiftKey ? 10 : 1;
        const delta = e.key === 'ArrowLeft' ? { x: -amount, y: 0 }
            : e.key === 'ArrowRight' ? { x: amount, y: 0 }
            : e.key === 'ArrowUp' ? { x: 0, y: -amount }
            : { x: 0, y: amount };
        const before = beginHistoryTransaction();
        moveElementsAndBindings(appState.selectedIds, delta);
        saveToLocal();
        commitHistory(before);
        redraw();
        requestLayersPanelRefresh();
        return;
    }
    if (shortcutMatches(e, 'saveProjectAs')) {
        e.preventDefault();
        void saveProjectAs();
        return;
    }
    if (shortcutMatches(e, 'saveProject')) {
        e.preventDefault();
        void saveProject();
        return;
    }
    if (shortcutMatches(e, 'openProject')) {
        e.preventDefault();
        void openProject();
        return;
    }
    if (shortcutMatches(e, 'newProject')) {
        e.preventDefault();
        void newProject();
        return;
    }
    if (shortcutMatches(e, 'quickConnect')) {
        if (createArrowBetweenSelectedObjects())
            e.preventDefault();
        return;
    }
    if (shortcutMatches(e, 'undo')) {
        e.preventDefault();
        undo();
        return;
    }
    if (shortcutMatches(e, 'redo') || shortcutMatches(e, 'redoAlt')) {
        e.preventDefault();
        redo();
        return;
    }
    if (shortcutMatches(e, 'selectAll')) {
        e.preventDefault();
        dispatch({ type: 'SET_SELECTION', ids: appState.elements.filter(el => !el.locked && !el.hidden).map(el => el.id) });
        redraw();
        requestLayersPanelRefresh();
        return;
    }
    if (shortcutMatches(e, 'group')) {
        e.preventDefault();
        groupSelectedObjects();
        return;
    }
    if (shortcutMatches(e, 'ungroup')) {
        e.preventDefault();
        ungroupSelectedObjects();
        return;
    }
    if (shortcutMatches(e, 'duplicate')) {
        e.preventDefault();
        const sourceIds = getStructuralSelectionIds();
        if (!selectionContainsLocked(sourceIds)) {
            const before = beginHistoryTransaction(), source = appState.elements.filter(el => sourceIds.includes(el.id)), cloned = cloneSelectionHierarchy(source, appState.layerGroups, 20, 20, appState.elements);
            source.forEach((el, i) => copyRuntimeMediaReference(el, cloned.elements[i]));
            if (cloned.elements.length) {
                dispatch({ type: 'ADD_ELEMENTS', elements: cloned.elements });
                if (cloned.layerGroups.length) dispatch({ type: 'ADD_LAYER_GROUPS', groups: cloned.layerGroups });
                dispatch({ type: 'SET_SELECTION', ids: cloned.elements.filter(el => !el.hidden && !el.locked).map(el => el.id) });
                saveToLocal();
                commitHistory(before);
                redraw();
                requestLayersPanelRefresh();
            }
        }
        return;
    }
    if (shortcutMatches(e, 'copy')) {
        e.preventDefault();
        await copySelectionToClipboard();
        return;
    }
    if (shortcutMatches(e, 'cut')) {
        e.preventDefault();
        if (!selectionContainsLocked(getStructuralSelectionIds()))
            await copySelectionToClipboard(true);
        return;
    }
    if (shortcutMatches(e, 'paste')) {
        // For the normal Ctrl/Cmd+V binding, let the browser/WebView dispatch a
        // ClipboardEvent so image clipboard payloads remain available. If the
        // host suppresses that event, fall back to Rimmap's internal clipboard.
        if (keyboardEventToBinding(e) === 'Ctrl+V') {
            const pasteSequence = boardPasteSequence;
            setTimeout(() => {
                if (boardPasteSequence === pasteSequence && appState.internalClipboard.elements.length)
                    pasteFromClipboard();
            }, 0);
            return;
        }
        e.preventDefault();
        pasteFromClipboard();
        return;
    }
    if (shortcutMatches(e, 'toggleLock')) {
        e.preventDefault();
        lockSelectedObjects();
        return;
    }
    if (shortcutMatches(e, 'bringFront')) {
        e.preventDefault();
        arrangeSelection('front');
        return;
    }
    if (shortcutMatches(e, 'sendBack')) {
        e.preventDefault();
        arrangeSelection('back');
        return;
    }
    if (shortcutMatches(e, 'bringForward')) {
        e.preventDefault();
        arrangeSelection('forward');
        return;
    }
    if (shortcutMatches(e, 'sendBackward')) {
        e.preventDefault();
        arrangeSelection('backward');
        return;
    }
    if (shortcutMatches(e, 'deleteSelection')) {
        e.preventDefault();
        deleteSelectedObjects();
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (appState.selectedIds.length || appState.selectedLayerGroupId) {
            e.preventDefault();
            deleteSelectedObjects();
        }
        return;
    }
    if (shortcutMatches(e, 'selectTool'))
        setTool('select');
    else if (shortcutMatches(e, 'brushTool'))
        setTool('pencil');
    else if (shortcutMatches(e, 'rectangleTool'))
        setTool('rectangle');
    else if (shortcutMatches(e, 'noteTool'))
        setTool('note');
    else if (shortcutMatches(e, 'arrowTool'))
        setTool('arrow');
    else if (shortcutMatches(e, 'eraserTool'))
        setTool('eraser');
    else if (shortcutMatches(e, 'handTool'))
        setTool('hand');
});

window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !appState.isSpacePanning)
        return;
    e.preventDefault();
    dispatch({ type: 'SET_TOOL_STATE', patch: { isSpacePanning: false } });
    setTool(appState.previousToolBeforeSpace);
});

window.addEventListener('blur', () => {
    if (appState.isSpacePanning) {
        dispatch({ type: 'SET_TOOL_STATE', patch: { isSpacePanning: false } });
        setTool(appState.previousToolBeforeSpace);
    }
});

export function findEraserTarget(p: Point): CanvasElement | undefined {
    return findElementsAtPoint(p)[0];
}

export function cancelEraserPreview() {
    dispatch({ type: 'SET_INTERACTION', patch: { eraserTargetId: null, eraserPreviewIds: new Set(), mode: 'none' } });
    dispatch({ type: 'SET_HISTORY', patch: { pendingHistoryBefore: null } });
    redraw();
}

export function deleteEraserTargets(targetIds: string[]) {
    targetIds = targetIds.filter(id => { const el = appState.elements.find(item => item.id === id); return !!el && !el.locked && !el.hidden; });
    if (!targetIds.length)
        return;
    const before = beginHistoryTransaction();
    dispatch({ type: 'DELETE_ELEMENTS', ids: targetIds });
    dispatch({ type: 'SET_SELECTION', ids: [] });
    saveToLocal();
    commitHistory(before);
    redraw();
}

export function deleteEraserTarget() {
    if (!appState.eraserTargetId)
        return;
    deleteEraserTargets([appState.eraserTargetId]);
}

export function getSceneBounds(items: CanvasElement[] = appState.elements): Bounds | null {
    if (!items.length)
        return null;
    let out = getBoundingBox(items[0]);
    for (const el of items.slice(1)) {
        const b = getBoundingBox(el);
        const left = Math.min(out.x, b.x), top = Math.min(out.y, b.y);
        const right = Math.max(out.x + out.width, b.x + b.width), bottom = Math.max(out.y + out.height, b.y + b.height);
        out = { x: left, y: top, width: right - left, height: bottom - top };
    }
    return out;
}

export function ensureOpenedProjectVisible() {
    const { width: canvasWidth, height: canvasHeight } = getCanvasCssSize(canvas);
    const visibleElements = appState.elements.filter(el => !el.hidden);
    if (!visibleElements.length || canvasWidth <= 0 || canvasHeight <= 0)
        return;
    const zoom = Number.isFinite(appState.camera.zoom) && appState.camera.zoom > 0 ? appState.camera.zoom : 1;
    const viewport: Bounds = { x: -appState.camera.x / zoom, y: -appState.camera.y / zoom, width: canvasWidth / zoom, height: canvasHeight / zoom };
    const hasVisibleElement = visibleElements.some(el => rectsIntersect(getBoundingBox(el), viewport));
    if (hasVisibleElement)
        return;
    const bounds = getSceneBounds(visibleElements);
    if (!bounds)
        return;
    const pad = 72;
    const usableW = Math.max(80, canvasWidth - pad * 2), usableH = Math.max(80, canvasHeight - pad * 2);
    const zx = usableW / Math.max(1, bounds.width), zy = usableH / Math.max(1, bounds.height);
    const nextZoom = Math.min(5, Math.max(.1, Math.min(zx, zy, 1.5)));
    dispatch({ type: 'SET_CAMERA', camera: {
        zoom: nextZoom,
        x: canvasWidth / 2 - (bounds.x + bounds.width / 2) * nextZoom,
        y: canvasHeight / 2 - (bounds.y + bounds.height / 2) * nextZoom,
    } });
}
