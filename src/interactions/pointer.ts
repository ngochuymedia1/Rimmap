// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { getMediaImage } from '../media/assets';
import { clampArrowLabelPosition, getArrowLabelLayout, getBranchLabelLayout, getEndpointLabelLayout, nearestArrowPathLocation, normalizeArrowStyle, pointInBounds } from '../arrows/index';
import { cancelEraserPreview, deleteEraserTarget, deleteEraserTargets, findEraserTarget } from './keyboard';
import { setTool } from './tools';
import { moveElementsAndBindings } from './movement';
import { createSnapTargets, snapMoveDelta, snapResizeBounds, type SnapTargets } from './snapping';
import { closeLayerPicker, findElementsAtPoint, nextAutoLayerName, requestLayersPanelRefresh, showLayerPicker } from '../layers/index';
import { arrowMode, distanceToBranchPath, expandSelectionToGroups, extendFreehandBounds, findConnectionAtPoint, getArrowAutoRoutePoints, getArrowBranchPathPoints, getArrowBranchRenderPoints, getArrowBranches, getArrowInteriorPoints, getArrowLabelCollisionBounds, getArrowPathPoints, getArrowRenderPoints, getBoundingBox, getBranchInteriorPoints, getFreehandBounds, getFreehandPath, getGroupBoundingBox, getResizeHandles, getSpatialIndexBounds, getScreenToWorld, hitTestPoint, invalidateFreehandRenderCache, isArrowAffectedByLiveMove, lerpPoint, insertArrowWaypoint, insertBranchWaypoint, isArrowAutoRouted, nearestBranchPathLocation, normalizedBounds, rectsIntersect, removeArrowWaypoint, removeBranchWaypoint, selectionFromMarquee, setArrowInteriorPoints, setBranchInteriorPoints } from '../model/geometry';
import { generateId } from '../model/ids';
import { getSelectionClusterForElement } from '../layers/model';
import { canonicalLines } from '../model/text-document';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE, MIN_TEXT_SCALE, TEXT_PAD_X, TEXT_PAD_Y, getTextScale } from '../model/text';
import { ArrowBranch, ArrowElement, Bounds, CanvasElement, FreehandElement, NoteElement, Point, RectangleElement, TextElement } from '../model/types';
import { saveToLocal } from '../persistence/index';
import { drawArrow, drawRichText, drawShapeText, measureRichTextLayoutFromLines, redraw, requestVisualFrame } from '../renderer/index';
import { NOTE_DEFAULT_FILL, drawNoteSurface, drawRectangleSurface } from '../renderer/shapes';
import { getCanvasCssSize, getCanvasPixelRatio, resetContextToCssPixels } from '../renderer/dpi';
import { getConnectedArrowIdsForElementIds, getSceneElementById, querySceneElements } from '../performance/scene-index';
import { getSelectedIdSet } from '../performance/selection-cache';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { appState, dispatch } from '../state/store';
import { closeTextEditor, positionTextEditor, startTextEditing } from '../text-editor/index';
import { duplicateSelectionForAltDrag, findTextTarget, getContextMenuPosition, hideContextMenu, selectionContainsLocked, showContextMenu } from '../ui/context-menu';
import { canvas } from '../ui/dom';
import { updateTextStylePanel } from '../ui/inspector';
import { findInteriorPathPointNear } from '../arrows/waypoints';

// --- 8. INTERACTION ENGINE ---
export function updateArrowContextHit(p: Point, arrow?: ArrowElement) {
    dispatch({ type: 'SET_INTERACTION', patch: { contextArrowEndpoint: null } });
    dispatch({ type: 'SET_INTERACTION', patch: { contextArrowBranchId: null } });
    if (!arrow)
        return;
    const trunk = getArrowPathPoints(arrow), start = trunk[0], end = trunk[trunk.length - 1], limit = 15 / appState.camera.zoom;
    const ds = Math.hypot(p.x - start.x, p.y - start.y), de = Math.hypot(p.x - end.x, p.y - end.y);
    if (Math.min(ds, de) <= limit) {
        dispatch({ type: 'SET_INTERACTION', patch: { contextArrowEndpoint: ds <= de ? 'start' : 'end' } });
        return;
    }
    if (arrowMode(arrow) === 'branches') {
        let best = Infinity;
        for (const branch of getArrowBranches(arrow)) {
            const d = distanceToBranchPath(p, arrow, branch);
            if (d < best && d <= 12 / appState.camera.zoom) {
                best = d;
                dispatch({ type: 'SET_INTERACTION', patch: { contextArrowBranchId: branch.id } });
            }
        }
    }
}

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (appState.activeTool === 'eraser' || appState.eraserTargetId || appState.mode === 'eraser-marquee') {
        cancelEraserPreview();
        return;
    }
    closeTextEditor(true);
    const p = getScreenToWorld(e.clientX, e.clientY);
    const hits = findElementsAtPoint(p);
    // Right-click keeps the normal context menu. Alt+right-click is reserved for
    // layer picking and uses the exact same screen anchor as that context menu.
    hideContextMenu();
    closeLayerPicker();
    if (e.altKey) {
        if (hits.length) {
            dispatch({ type: 'SET_INTERACTION', patch: { mode: 'none' } });
            const menuPos = getContextMenuPosition(e.clientX, e.clientY);
            showLayerPicker(p, hits, menuPos.left, menuPos.top);
            redraw();
        }
        return;
    }
    const clickedId = hits[0]?.id ?? null;
    if (clickedId && !appState.selectedIds.includes(clickedId)) {
        const cluster = getSelectionClusterForElement(appState.elements, appState.layerGroups, clickedId);
        dispatch({ type: 'SET_SELECTION', ids: cluster.ids, layerGroupId: cluster.groupId });
    }
    const selectedArrowForContext = appState.selectedIds.length === 1 ? getSceneElementById(appState.selectedIds[0]) : undefined;
    updateArrowContextHit(p, selectedArrowForContext && (selectedArrowForContext.type === 'arrow' || selectedArrowForContext.type === 'connector') ? selectedArrowForContext as ArrowElement : undefined);
    setTool('select');
    requestLayersPanelRefresh();
    showContextMenu(e.clientX, e.clientY);
    redraw();
});

canvas.addEventListener('mousedown', e => {
    if (!appState.appReady)
        return;
    closeLayerPicker();
    hideContextMenu();
    const p = getScreenToWorld(e.clientX, e.clientY);
    dispatch({ type: 'SET_INTERACTION', patch: { dragStartWorld: p } });
    dispatch({ type: 'SET_INTERACTION', patch: { currentMouseWorld: p } });
    if (appState.textEditor)
        return;
    if (appState.isSpacePanning || appState.activeTool === 'hand' || e.button === 1) {
        dispatch({ type: 'SET_INTERACTION', patch: { mode: 'panning' } });
        dispatch({ type: 'SET_INTERACTION', patch: { lastMousePos: { x: e.clientX, y: e.clientY } } });
        return;
    }
    dispatch({ type: 'SET_HISTORY', patch: { pendingHistoryBefore: beginHistoryTransaction() } });
    if (appState.activeTool === 'eraser') {
        dispatch({ type: 'SET_INTERACTION', patch: { eraserTargetId: findEraserTarget(p)?.id ?? null } });
        dispatch({ type: 'SET_INTERACTION', patch: { eraserPreviewIds: appState.eraserTargetId ? new Set([appState.eraserTargetId]) : new Set() } });
        dispatch({ type: 'SET_INTERACTION', patch: { mode: 'eraser-preview' } });
        redraw();
        return;
    }
    if (appState.activeTool === 'select') {
        const selectedArrow = appState.selectedIds.length === 1 ? getSceneElementById(appState.selectedIds[0]) : undefined;
        const isSingleArrow = !!selectedArrow && (selectedArrow.type === 'arrow' || selectedArrow.type === 'connector');
        const selectionLocked = selectionContainsLocked();
        const groupBox = getGroupBoundingBox(appState.selectedIds);
        if (groupBox && !isSingleArrow && !selectionLocked) {
            for (const [key, h] of Object.entries(getResizeHandles(groupBox))) {
                if (p.x >= h.x && p.x <= h.x + h.size && p.y >= h.y && p.y <= h.y + h.size) {
                    dispatch({ type: 'SET_INTERACTION', patch: { mode: 'resizing' } });
                    dispatch({ type: 'SET_INTERACTION', patch: { activeResizeHandle: key } });
                    dispatch({ type: 'SET_INTERACTION', patch: { initialGroupBounds: groupBox } });
                    dispatch({ type: 'SET_INTERACTION', patch: { initialElementsState: structuredClone(appState.elements.filter(el => appState.selectedIds.includes(el.id))) } });
                    dispatch({ type: 'SET_INTERACTION', patch: { initialElementsById: new Map(appState.initialElementsState.map(el => [el.id, el])) } });
                    refreshActiveSnapTargets(getSelectedIdSet());
                    return;
                }
            }
        }
        if (selectedArrow && (selectedArrow.type === 'arrow' || selectedArrow.type === 'connector') && !selectedArrow.locked) {
            const a = selectedArrow as ArrowElement, pts = getArrowPathPoints(a), label = getArrowLabelLayout(a, getArrowRenderPoints(a), getArrowLabelCollisionBounds(a.id));
            dispatch({ type: 'SET_INTERACTION', patch: { activeArrowLabelMoveTarget: null } });
            dispatch({ type: 'SET_INTERACTION', patch: { activeArrowBranchId: null } });
            dispatch({ type: 'SET_INTERACTION', patch: { activeArrowBranchPointIndex: null } });
            if (label && pointInBounds(p, label.box, 5 / appState.camera.zoom)) {
                dispatch({ type: 'SET_INTERACTION', patch: { activeArrowLabelMoveTarget: { kind: 'label' } } });
                dispatch({ type: 'SET_INTERACTION', patch: { mode: 'arrow-label-moving' } });
                return;
            }
            if (arrowMode(a) === 'branches') {
                for (const branch of getArrowBranches(a)) {
                    const bRender = getArrowBranchRenderPoints(a, branch), bLabel = getBranchLabelLayout(branch, bRender, getArrowLabelCollisionBounds(a.id));
                    if (bLabel && pointInBounds(p, bLabel.box, 5 / appState.camera.zoom)) {
                        dispatch({ type: 'SET_INTERACTION', patch: { activeArrowLabelMoveTarget: { kind: 'branch', branchId: branch.id } } });
                        dispatch({ type: 'SET_INTERACTION', patch: { mode: 'arrow-label-moving' } });
                        return;
                    }
                }
                for (const branch of getArrowBranches(a)) {
                    const bpts = getArrowBranchPathPoints(a, branch);
                    for (let i = 1; i < bpts.length; i++)
                        if (hitTestPoint(p, bpts[i])) {
                            if (e.altKey && i < bpts.length - 1) {
                                const branchId = branch.id;
                                dispatch({ type: 'UPDATE_ELEMENT', id: a.id, update: element => {
                                    if (element.type !== 'arrow' && element.type !== 'connector') return;
                                    const target = getArrowBranches(element).find(item => item.id === branchId);
                                    if (target) removeBranchWaypoint(element, target, i);
                                } });
                                saveToLocal();
                                commitHistory(appState.pendingHistoryBefore);
                                dispatch({ type: 'SET_HISTORY', patch: { pendingHistoryBefore: null } });
                                redraw();
                                return;
                            }
                            dispatch({ type: 'SET_INTERACTION', patch: { activeArrowBranchId: branch.id } });
                            dispatch({ type: 'SET_INTERACTION', patch: { activeArrowBranchPointIndex: i } });
                            dispatch({ type: 'SET_INTERACTION', patch: { mode: i === bpts.length - 1 ? 'arrow-branch-end' : 'arrow-branch-control' } });
                            return;
                        }
                }
            }
            const editablePointIndexes = isArrowAutoRouted(a) ? [0, pts.length - 1] : pts.map((_, index) => index);
            for (const i of editablePointIndexes)
                if (hitTestPoint(p, pts[i])) {
                    if (e.altKey && i > 0 && i < pts.length - 1) {
                        dispatch({ type: 'UPDATE_ELEMENT', id: a.id, update: element => {
                            if (element.type === 'arrow' || element.type === 'connector') removeArrowWaypoint(element, i);
                        } });
                        saveToLocal();
                        commitHistory(appState.pendingHistoryBefore);
                        dispatch({ type: 'SET_HISTORY', patch: { pendingHistoryBefore: null } });
                        redraw();
                        return;
                    }
                    dispatch({ type: 'SET_INTERACTION', patch: { activeArrowPointIndex: i } });
                    dispatch({ type: 'SET_INTERACTION', patch: { mode: i === 0 ? 'arrow-start' : i === pts.length - 1 ? 'arrow-end' : 'arrow-control' } });
                    return;
                }
        }
        const clickedId = findElementsAtPoint(p)[0]?.id ?? null;
        if (clickedId) {
            if (e.shiftKey) {
                const cluster = getSelectionClusterForElement(appState.elements, appState.layerGroups, clickedId);
                const ids = cluster.ids.length ? cluster.ids : [clickedId];
                const all = ids.every(id => appState.selectedIds.includes(id));
                dispatch({ type: 'SET_SELECTION', ids: all ? appState.selectedIds.filter(id => !ids.includes(id)) : expandSelectionToGroups([...appState.selectedIds, clickedId]) });
            }
            else if (!appState.selectedIds.includes(clickedId)) {
                const cluster = getSelectionClusterForElement(appState.elements, appState.layerGroups, clickedId);
                dispatch({ type: 'SET_SELECTION', ids: cluster.ids, layerGroupId: cluster.groupId });
            }
            if (appState.selectedIds.includes(clickedId) && !selectionContainsLocked()) {
                dispatch({ type: 'SET_INTERACTION', patch: { altDragDuplicated: false } });
                if (e.altKey)
                    duplicateSelectionForAltDrag();
                dispatch({ type: 'SET_INTERACTION', patch: { mode: 'moving' } });
                dispatch({ type: 'SET_INTERACTION', patch: { activeMoveDelta: { x: 0, y: 0 } } });
                dispatch({ type: 'SET_INTERACTION', patch: { movingSelectionIds: new Set(appState.selectedIds) } });
                dispatch({ type: 'SET_INTERACTION', patch: { initialElementsState: structuredClone(appState.elements.filter(el => appState.selectedIds.includes(el.id))) } });
                dispatch({ type: 'SET_INTERACTION', patch: { initialElementsById: new Map(appState.initialElementsState.map(el => [el.id, el])) } });
                dispatch({ type: 'SET_INTERACTION', patch: { initialGroupBounds: getGroupBoundingBox(appState.selectedIds) } });
                refreshActiveSnapTargets(appState.movingSelectionIds);
                captureMoveBackground();
            }
        }
        else {
            dispatch({ type: 'SET_INTERACTION', patch: { marqueeStartSelection: e.shiftKey ? [...appState.selectedIds] : [] } });
            if (!e.shiftKey)
                dispatch({ type: 'SET_SELECTION', ids: [] });
            dispatch({ type: 'SET_INTERACTION', patch: { mode: 'marquee' } });
        }
        redraw();
        updateTextStylePanel();
        requestLayersPanelRefresh();
        return;
    }
    if (appState.activeTool === 'note') {
        // Notes are single-container editors: clicking inside an existing note edits
        // that note instead of silently creating a second note on top of it. A new
        // note is created only when the pointer is outside every existing note.
        for (const el of findElementsAtPoint(p)) {
            if (el.type === 'note') {
                // We are entering edit mode, not completing a drawing operation.
                // Clear the pending creation history slot so the click cannot later
                // commit a phantom undo entry for a note that was never created.
                dispatch({ type: 'SET_HISTORY', patch: { pendingHistoryBefore: null } });
                dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                dispatch({ type: 'SET_INTERACTION', patch: { mode: 'none' } });
                startTextEditing(p, el.id);
                return;
            }
        }
    }
    dispatch({ type: 'SET_INTERACTION', patch: { mode: 'drawing' } });
    const id = generateId();
    if (appState.activeTool === 'pencil') {
        const freehand = { id, type: 'freehand', points: [p], color: appState.brushColor, thickness: appState.currentThickness, name: nextAutoLayerName('freehand') } as FreehandElement;
        dispatch({ type: 'ADD_ELEMENT', element: freehand });
        getFreehandBounds(freehand);
    }
    else if (appState.activeTool === 'rectangle')
        dispatch({ type: 'ADD_ELEMENT', element: { id, type: 'rectangle', x: p.x, y: p.y, width: 0, height: 0, color: '#111827', thickness: appState.currentThickness, borderRadius: 10, fillColor: undefined, strokeEnabled: true, strokeStyle: 'solid', strokePatternSpacing: 1, strokeColor: '#111111', text: '', fontSize: DEFAULT_TEXT_FONT_SIZE, textScale: 1, textAlign: 'left', textVerticalAlign: 'top', fontFamily: DEFAULT_FONT_FAMILY, name: nextAutoLayerName('rectangle') } });
    else if (appState.activeTool === 'note')
        dispatch({ type: 'ADD_ELEMENT', element: { id, type: 'note', x: p.x, y: p.y, width: 0, height: 0, color: '#262626', thickness: 1.15, fillColor: NOTE_DEFAULT_FILL, text: '', fontSize: DEFAULT_TEXT_FONT_SIZE, textScale: .72, borderRadius: 1, textAlign: 'left', textVerticalAlign: 'top', fontFamily: DEFAULT_FONT_FAMILY, name: nextAutoLayerName('note') } });
    else if (appState.activeTool === 'arrow') {
        const startSnap = findConnectionAtPoint(p), start = startSnap?.position ?? p;
        const arrow: ArrowElement = { id, type: 'arrow', start, control: start, controls: [start], pointCount: 3, end: p, arrowMode: 'connection', routingMode: 'manual', style: normalizeArrowStyle(appState.arrowStyle), curveMode: 'smooth', color: appState.arrowColor, thickness: appState.currentThickness, opacity: 1, name: nextAutoLayerName('arrow') };
        if (startSnap) {
            arrow.startBinding = startSnap.id;
            arrow.startBindingPoint = startSnap.point;
            arrow.startBindingAnchor = startSnap.anchor;
        }
        dispatch({ type: 'CREATE_ARROW', arrow });
    }
});

canvas.addEventListener('dblclick', e => {
    e.preventDefault();
    // A note click may already have entered the live editor on mousedown. Do not
    // tear it down and recreate it on the follow-up dblclick event.
    if (appState.textEditor)
        return;
    const p = getScreenToWorld(e.clientX, e.clientY);
    for (const el of findElementsAtPoint(p)) {
        if (el.type !== 'arrow' && el.type !== 'connector')
            continue;
        const arrow = el as ArrowElement, label = getArrowLabelLayout(arrow, getArrowRenderPoints(arrow), getArrowLabelCollisionBounds(arrow.id));
        if (label && pointInBounds(p, label.box, 6 / appState.camera.zoom)) {
            dispatch({ type: 'SET_SELECTION', ids: [el.id] });
            startTextEditing(label.anchor, el.id, undefined, { kind: 'label' });
            return;
        }
        if (arrowMode(arrow) === 'branches') {
            const startLabel = getEndpointLabelLayout(arrow, 'start'), endLabel = getEndpointLabelLayout(arrow, 'end');
            if (startLabel && pointInBounds(p, startLabel.box, 6 / appState.camera.zoom)) {
                dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                startTextEditing(startLabel.anchor, el.id, undefined, { kind: 'start' });
                return;
            }
            if (endLabel && pointInBounds(p, endLabel.box, 6 / appState.camera.zoom)) {
                dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                startTextEditing(endLabel.anchor, el.id, undefined, { kind: 'end' });
                return;
            }
            for (const branch of getArrowBranches(arrow)) {
                const bpts = getArrowBranchRenderPoints(arrow, branch), bLabel = getBranchLabelLayout(branch, bpts, getArrowLabelCollisionBounds(arrow.id));
                if (bLabel && pointInBounds(p, bLabel.box, 6 / appState.camera.zoom)) {
                    dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                    startTextEditing(bLabel.anchor, el.id, undefined, { kind: 'branch', branchId: branch.id });
                    return;
                }
            }
            const trunkPts = getArrowPathPoints(arrow), endpointLimit = 16 / appState.camera.zoom;
            if (Math.hypot(p.x - trunkPts[0].x, p.y - trunkPts[0].y) <= endpointLimit) {
                dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                startTextEditing(trunkPts[0], el.id, undefined, { kind: 'start' });
                return;
            }
            if (Math.hypot(p.x - trunkPts[trunkPts.length - 1].x, p.y - trunkPts[trunkPts.length - 1].y) <= endpointLimit) {
                dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                startTextEditing(trunkPts[trunkPts.length - 1], el.id, undefined, { kind: 'end' });
                return;
            }
            let bestBranch: {
                branch: ArrowBranch;
                loc: ReturnType<typeof nearestBranchPathLocation>;
            } | null = null;
            for (const branch of getArrowBranches(arrow)) {
                const loc = nearestBranchPathLocation(p, arrow, branch);
                if (loc.hitDistance <= 12 / appState.camera.zoom && loc.pathPosition >= .1 && loc.pathPosition <= .92 && (!bestBranch || loc.hitDistance < bestBranch.loc.hitDistance))
                    bestBranch = { branch, loc };
            }
            if (bestBranch) {
                const branchId = bestBranch.branch.id;
                if (!e.shiftKey) {
                    const branchPath = getArrowBranchPathPoints(arrow, bestBranch.branch);
                    if (findInteriorPathPointNear(branchPath, p, 8 / appState.camera.zoom) === null) {
                        const before = beginHistoryTransaction();
                        dispatch({ type: 'UPDATE_ELEMENT', id: el.id, update: element => {
                            if (element.type !== 'arrow' && element.type !== 'connector') return;
                            const branch = getArrowBranches(element).find(item => item.id === branchId);
                            if (branch) insertBranchWaypoint(element, branch, bestBranch!.loc.point);
                        } });
                        saveToLocal();
                        commitHistory(before);
                    }
                    dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                    redraw();
                    updateTextStylePanel();
                    return;
                }
                const labelPosition = clampArrowLabelPosition(bestBranch.loc.pathPosition);
                dispatch({ type: 'UPDATE_ELEMENT', id: el.id, update: element => {
                    if (element.type !== 'arrow' && element.type !== 'connector') return;
                    const branch = getArrowBranches(element).find(item => item.id === branchId);
                    if (branch) {
                        branch.labelPosition = labelPosition;
                        if (branch.labelSide !== 1 && branch.labelSide !== -1) branch.labelSide = -1;
                    }
                } });
                dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                startTextEditing(bestBranch.loc.point, el.id, undefined, { kind: 'branch', branchId });
                return;
            }
        }
        const nearest = nearestArrowPathLocation(p, arrow);
        if (nearest.hitDistance <= 12 / appState.camera.zoom && nearest.pathPosition >= .12 && nearest.pathPosition <= .88) {
            if (!e.shiftKey) {
                const autoPoints = isArrowAutoRouted(arrow) ? getArrowAutoRoutePoints(arrow) : null;
                const authoredPath = autoPoints ?? getArrowPathPoints(arrow);
                const existingWaypoint = findInteriorPathPointNear(authoredPath, p, 8 / appState.camera.zoom);
                const before = beginHistoryTransaction();
                dispatch({ type: 'UPDATE_ELEMENT', id: el.id, update: element => {
                    if (element.type !== 'arrow' && element.type !== 'connector') return;
                    if (autoPoints) {
                        element.routingMode = 'manual';
                        setArrowInteriorPoints(element, autoPoints.slice(1, -1));
                    }
                    if (existingWaypoint === null) insertArrowWaypoint(element, nearest.point);
                } });
                dispatch({ type: 'SET_SELECTION', ids: [el.id] });
                saveToLocal();
                commitHistory(before);
                redraw();
                updateTextStylePanel();
                return;
            }
            const labelPosition = clampArrowLabelPosition(nearest.pathPosition);
            dispatch({ type: 'UPDATE_ELEMENT', id: el.id, update: element => {
                if (element.type !== 'arrow' && element.type !== 'connector') return;
                element.labelPosition = labelPosition;
                if (element.labelSide !== 1 && element.labelSide !== -1) element.labelSide = -1;
            } });
            dispatch({ type: 'SET_SELECTION', ids: [el.id] });
            startTextEditing(nearest.point, el.id, undefined, { kind: 'label' });
            return;
        }
    }
    const target = findTextTarget(p);
    if (target.id) {
        dispatch({ type: 'SET_SELECTION', ids: [target.id] });
        startTextEditing(p, target.id);
    }
    else if (appState.activeTool === 'select')
        startTextEditing(p, null, p);
});

export function getShapeTextMinSize(init: RectangleElement | NoteElement, nextScale: number, candidateWidth: number): {
    width: number;
    height: number;
} {
    const innerWidth = Math.max(20, candidateWidth - TEXT_PAD_X * 2);
    const layout = measureRichTextLayoutFromLines(canonicalLines(init), init.fontSize ?? DEFAULT_TEXT_FONT_SIZE, init.color, innerWidth, nextScale, init.fontFamily);
    const requiredWidth = Math.max(20, layout.maxTokenWidth) + TEXT_PAD_X * 2;
    const requiredHeight = Math.max(18, layout.height) + TEXT_PAD_Y * 2;
    return { width: requiredWidth, height: requiredHeight };
}

export function clampResizeForText(start: Bounds, sx: number, sy: number, fontScale: number, initialStates: CanvasElement[]): {
    sx: number;
    sy: number;
    fontScale: number;
} {
    let outSx = sx, outSy = sy;
    for (let pass = 0; pass < 5; pass++) {
        const nextFontScale = Math.max(MIN_TEXT_SCALE, Math.min(outSx, outSy));
        let minGroupSx = 0, minGroupSy = 0;
        for (const init of initialStates) {
            if (init.type !== 'note' && init.type !== 'rectangle')
                continue;
            const ib = getBoundingBox(init);
            if (ib.width <= 0 || ib.height <= 0)
                continue;
            const candidateWidth = Math.max(1, ib.width * outSx);
            const req = getShapeTextMinSize(init as RectangleElement | NoteElement, nextFontScale, candidateWidth);
            minGroupSx = Math.max(minGroupSx, req.width / ib.width);
            minGroupSy = Math.max(minGroupSy, req.height / ib.height);
        }
        const nextSx = Math.max(outSx, minGroupSx);
        const nextSy = Math.max(outSy, minGroupSy);
        if (Math.abs(nextSx - outSx) < 0.0005 && Math.abs(nextSy - outSy) < 0.0005) {
            outSx = nextSx;
            outSy = nextSy;
            break;
        }
        outSx = nextSx;
        outSy = nextSy;
    }
    return { sx: outSx, sy: outSy, fontScale: Math.max(MIN_TEXT_SCALE, Math.min(outSx, outSy)) };
}

export function drawMoveSnapshotElement(c: CanvasRenderingContext2D, el: CanvasElement) {
    if (el.hidden)
        return;
    c.save();
    c.strokeStyle = el.color;
    c.fillStyle = el.color;
    if (el.type === 'freehand') {
        c.lineWidth = el.thickness;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        if (el.points.length)
            c.stroke(getFreehandPath(el));
    }
    else if (el.type === 'rectangle') {
        const b = normalizedBounds(el.x, el.y, el.width, el.height);
        drawRectangleSurface(c, el, b);
        if (el.text) drawShapeText(c, el, b);
    }
    else if (el.type === 'note') {
        const b = normalizedBounds(el.x, el.y, el.width, el.height);
        drawNoteSurface(c, el, b);
        if (el.text) drawShapeText(c, el, b);
    }
    else if (el.type === 'text') {
        drawRichText(c, undefined, el.text, el.x, el.y, el.fontSize, el.color, undefined, el.textAlign || 'left', getTextScale(el), el.textDoc?.lines, el.fontFamily);
    }
    else if (el.type === 'media') {
        c.strokeStyle = '#a1a1aa';
        c.lineWidth = 1;
        c.strokeRect(el.x, el.y, el.width, el.height);
        const img = getMediaImage(el.assetId) as HTMLImageElement | undefined;
        if (img)
            c.drawImage(img, el.x, el.y, el.width, el.height);
        else {
            c.fillStyle = el.mime.startsWith('image/') ? '#eee' : '#f4f4f5';
            c.fillRect(el.x, el.y, el.width, el.height);
            c.fillStyle = '#555';
            c.font = '14px sans-serif';
            c.fillText(el.mime.startsWith('image/') ? el.name : `Unsupported · ${el.name}`, el.x + 10, el.y + 24);
        }
    }
    else
        drawArrow(c, el as ArrowElement);
    c.restore();
}

export function captureMoveBackground() {
    const moveBackgroundCanvas = appState.moveBackgroundCanvas ?? document.createElement('canvas');
    const moveSelectionCanvas = appState.moveSelectionCanvas ?? document.createElement('canvas');
    if (!appState.moveBackgroundCanvas || !appState.moveSelectionCanvas)
        dispatch({ type: 'SET_INTERACTION', patch: { moveBackgroundCanvas, moveSelectionCanvas } });
    moveBackgroundCanvas.width = canvas.width;
    moveBackgroundCanvas.height = canvas.height;
    moveSelectionCanvas.width = canvas.width;
    moveSelectionCanvas.height = canvas.height;
    const pixelRatio = getCanvasPixelRatio(canvas);
    moveBackgroundCanvas.dataset.pixelRatio = String(pixelRatio);
    moveSelectionCanvas.dataset.pixelRatio = String(pixelRatio);
    const bctx = moveBackgroundCanvas.getContext('2d');
    const sctx = moveSelectionCanvas.getContext('2d');
    if (!bctx || !sctx)
        return;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, bctx.canvas.width, bctx.canvas.height);
    sctx.clearRect(0, 0, sctx.canvas.width, sctx.canvas.height);
    resetContextToCssPixels(bctx, moveBackgroundCanvas);
    resetContextToCssPixels(sctx, moveSelectionCanvas);
    bctx.save();
    sctx.save();
    bctx.translate(appState.camera.x, appState.camera.y);
    bctx.scale(appState.camera.zoom, appState.camera.zoom);
    sctx.translate(appState.camera.x, appState.camera.y);
    sctx.scale(appState.camera.zoom, appState.camera.zoom);
    const { width: cssWidth, height: cssHeight } = getCanvasCssSize(canvas);
    const margin = 80 / appState.camera.zoom;
    const view = { x: -appState.camera.x / appState.camera.zoom - margin, y: -appState.camera.y / appState.camera.zoom - margin, width: cssWidth / appState.camera.zoom + margin * 2, height: cssHeight / appState.camera.zoom + margin * 2 };
    const affectedArrowIds = getConnectedArrowIdsForElementIds(appState.movingSelectionIds);
    for (const el of querySceneElements(view, getSpatialIndexBounds)) {
        if (el.hidden || !rectsIntersect(getBoundingBox(el), view)) continue;
        if (appState.movingSelectionIds.has(el.id)) {
            drawMoveSnapshotElement(sctx, el);
            continue;
        }
        // Bound arrows are redrawn live over the cached board. Dependency lookup
        // avoids scanning/re-evaluating unrelated connectors during the drag.
        if (affectedArrowIds.has(el.id)) continue;
        drawMoveSnapshotElement(bctx, el);
    }
    bctx.restore();
    sctx.restore();
}


type HotPointerFrameInput = {
    clientX: number;
    clientY: number;
    altKey: boolean;
    shiftKey: boolean;
};

let pendingHotPointerFrame: HotPointerFrameInput | null = null;
let activeSnapTargets: SnapTargets | null = null;

function refreshActiveSnapTargets(ids: ReadonlySet<string>): void {
    activeSnapTargets = createSnapTargets(ids);
}

function applyResizeFrame(p: Point, shiftKey: boolean): void {
    if (appState.mode !== 'resizing' || !appState.initialGroupBounds) return;
    const dx = p.x - appState.dragStartWorld.x, dy = p.y - appState.dragStartWorld.y;
    const start = appState.initialGroupBounds;
    let { x: nx, y: ny, width: nw, height: nh } = start;
    if (appState.activeResizeHandle === 'se') { nw += dx; nh += dy; }
    else if (appState.activeResizeHandle === 'sw') { nx += dx; nw -= dx; nh += dy; }
    else if (appState.activeResizeHandle === 'ne') { ny += dy; nw += dx; nh -= dy; }
    else { nx += dx; ny += dy; nw -= dx; nh -= dy; }
    nw = Math.max(5, nw);
    nh = Math.max(5, nh);

    if (shiftKey && start.width > 0 && start.height > 0) {
        const rawSx = nw / start.width, rawSy = nh / start.height;
        const useX = Math.abs(rawSx - 1) >= Math.abs(rawSy - 1);
        const scale = useX ? rawSx : rawSy;
        nw = Math.max(5, start.width * scale);
        nh = Math.max(5, start.height * scale);
        if (appState.activeResizeHandle === 'nw') {
            nx = start.x + start.width - nw;
            ny = start.y + start.height - nh;
        } else if (appState.activeResizeHandle === 'ne') ny = start.y + start.height - nh;
        else if (appState.activeResizeHandle === 'sw') nx = start.x + start.width - nw;
    }
    if (!shiftKey) {
        const snapped = snapResizeBounds(
            { x: nx, y: ny, width: nw, height: nh },
            appState.activeResizeHandle,
            getSelectedIdSet(),
            activeSnapTargets ?? undefined,
        );
        ({ x: nx, y: ny, width: nw, height: nh } = snapped);
    }

    let sx = nw / Math.max(.0001, start.width), sy = nh / Math.max(.0001, start.height);
    let fontScale = Math.min(sx, sy);
    const clamp = clampResizeForText(start, sx, sy, fontScale, appState.initialElementsState);
    sx = clamp.sx; sy = clamp.sy; fontScale = clamp.fontScale;
    nw = start.width * sx; nh = start.height * sy;
    if (appState.activeResizeHandle === 'nw') {
        nx = start.x + start.width - nw; ny = start.y + start.height - nh;
    } else if (appState.activeResizeHandle === 'ne') {
        nx = start.x; ny = start.y + start.height - nh;
    } else if (appState.activeResizeHandle === 'sw') {
        nx = start.x + start.width - nw; ny = start.y;
    } else {
        nx = start.x; ny = start.y;
    }

    const ids = appState.initialElementsState.map(item => item.id);
    dispatch({ type: 'UPDATE_ELEMENTS', ids, update: el => {
        const init = appState.initialElementsById.get(el.id);
        if (!init) return;
        const ib = getBoundingBox(init);
        if (el.type === 'rectangle' || el.type === 'note' || el.type === 'media') {
            el.x = nx + (ib.x - start.x) * sx;
            el.y = ny + (ib.y - start.y) * sy;
            el.width = ib.width * sx;
            el.height = ib.height * sy;
            if (el.type === 'note' && init.type === 'note') {
                el.fontSize = init.fontSize;
                el.textScale = getTextScale(init) * fontScale;
            } else if (el.type === 'rectangle' && init.type === 'rectangle' && el.fontSize !== undefined && init.fontSize !== undefined) {
                el.fontSize = init.fontSize;
                el.textScale = getTextScale(init) * fontScale;
            }
        } else if (el.type === 'text' && init.type === 'text') {
            el.x = nx + (init.x - start.x) * sx;
            el.y = ny + (init.y - start.y) * sy;
            el.fontSize = init.fontSize;
            el.textScale = getTextScale(init) * fontScale;
        } else if ((el.type === 'arrow' || el.type === 'connector') && (init.type === 'arrow' || init.type === 'connector')) {
            el.start = { x: nx + (init.start.x - start.x) * sx, y: ny + (init.start.y - start.y) * sy };
            const initControls = getArrowInteriorPoints(init);
            setArrowInteriorPoints(el, initControls.map(pt => ({ x: nx + (pt.x - start.x) * sx, y: ny + (pt.y - start.y) * sy })));
            el.end = { x: nx + (init.end.x - start.x) * sx, y: ny + (init.end.y - start.y) * sy };
        } else if (el.type === 'freehand' && init.type === 'freehand') {
            el.points = init.points.map(pt => ({ x: nx + (pt.x - start.x) * sx, y: ny + (pt.y - start.y) * sy }));
            invalidateFreehandRenderCache(el);
            getFreehandBounds(el);
        }
    } });
}

function flushHotPointerFrame(): void {
    const input = pendingHotPointerFrame;
    pendingHotPointerFrame = null;
    if (!input) return;
    const p = getScreenToWorld(input.clientX, input.clientY);

    if (appState.mode === 'panning') {
        dispatch({ type: 'PAN_CAMERA', dx: input.clientX - appState.lastMousePos.x, dy: input.clientY - appState.lastMousePos.y });
        dispatch({ type: 'SET_INTERACTION', patch: { lastMousePos: { x: input.clientX, y: input.clientY } } });
        if (appState.textEditor) positionTextEditor();
        return;
    }
    if (appState.mode === 'moving') {
        if (input.altKey && !appState.altDragDuplicated && duplicateSelectionForAltDrag()) {
            const movingIds = new Set(appState.selectedIds);
            dispatch({ type: 'SET_INTERACTION', patch: { movingSelectionIds: movingIds } });
            dispatch({ type: 'SET_INTERACTION', patch: { initialElementsState: structuredClone(appState.elements.filter(el => movingIds.has(el.id))) } });
            dispatch({ type: 'SET_INTERACTION', patch: { initialElementsById: new Map(appState.initialElementsState.map(el => [el.id, el])) } });
            dispatch({ type: 'SET_INTERACTION', patch: { initialGroupBounds: getGroupBoundingBox(appState.selectedIds) } });
            refreshActiveSnapTargets(movingIds);
            captureMoveBackground();
        }
        const rawDelta = { x: p.x - appState.dragStartWorld.x, y: p.y - appState.dragStartWorld.y };
        const snappedDelta = appState.initialGroupBounds
            ? snapMoveDelta(rawDelta, appState.initialGroupBounds, appState.movingSelectionIds, activeSnapTargets ?? undefined)
            : rawDelta;
        dispatch({ type: 'SET_INTERACTION', patch: { currentMouseWorld: p, activeMoveDelta: snappedDelta } });
        return;
    }
    if (appState.mode === 'resizing') {
        dispatch({ type: 'SET_INTERACTION', patch: { currentMouseWorld: p } });
        applyResizeFrame(p, input.shiftKey);
    }
}

function queueHotPointerFrame(e: MouseEvent): void {
    pendingHotPointerFrame = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey };
    requestVisualFrame(flushHotPointerFrame);
}

canvas.addEventListener('mousemove', e => {
    if (appState.mode === 'moving' || appState.mode === 'resizing' || appState.mode === 'panning') {
        queueHotPointerFrame(e);
        return;
    }
    const p = getScreenToWorld(e.clientX, e.clientY);
    dispatch({ type: 'SET_INTERACTION', patch: { currentMouseWorld: p } });
    const hoveredConnection = (appState.activeTool === 'arrow' || appState.mode === 'drawing' && appState.elements[appState.elements.length - 1]?.type === 'arrow') ? (() => { const snap = findConnectionAtPoint(p, appState.selectedIds.length === 1 ? appState.selectedIds[0] : undefined); return snap ? { id: snap.id, point: snap.point, position: snap.position } : null; })() : null;
    dispatch({ type: 'SET_INTERACTION', patch: { hoveredConnection } });
    if (appState.textEditor)
        positionTextEditor();
    if (appState.mode === 'eraser-preview' || appState.mode === 'eraser-marquee') {
        const dx = Math.abs(p.x - appState.dragStartWorld.x), dy = Math.abs(p.y - appState.dragStartWorld.y);
        if (e.buttons === 1 && appState.mode === 'eraser-preview' && (dx >= 4 / appState.camera.zoom || dy >= 4 / appState.camera.zoom)) {
            dispatch({ type: 'SET_INTERACTION', patch: { mode: 'eraser-marquee' } });
            dispatch({ type: 'SET_INTERACTION', patch: { eraserTargetId: null } });
        }
        if (appState.mode === 'eraser-marquee') {
            const box = { x: Math.min(appState.dragStartWorld.x, p.x), y: Math.min(appState.dragStartWorld.y, p.y), width: dx, height: dy };
            const candidates = querySceneElements(box, getSpatialIndexBounds);
            dispatch({ type: 'SET_INTERACTION', patch: { eraserPreviewIds: new Set(candidates.filter(el => !el.hidden && rectsIntersect(getBoundingBox(el), box)).map(el => el.id)) } });
        }
        else if (e.buttons === 1 || e.buttons === 0) {
            dispatch({ type: 'SET_INTERACTION', patch: { eraserTargetId: findEraserTarget(p)?.id ?? null } });
            dispatch({ type: 'SET_INTERACTION', patch: { eraserPreviewIds: appState.eraserTargetId ? new Set([appState.eraserTargetId]) : new Set() } });
        }
        redraw();
        return;
    }
    if (appState.mode === 'marquee') {
        dispatch({ type: 'SET_SELECTION', ids: selectionFromMarquee(appState.dragStartWorld, p) });
        redraw();
        return;
    }
    if (appState.mode === 'arrow-label-moving') {
        const id = appState.selectedIds.length === 1 ? appState.selectedIds[0] : undefined;
        const el = id ? getSceneElementById(id) : undefined;
        if (id && el && (el.type === 'arrow' || el.type === 'connector')) {
            const target = appState.activeArrowLabelMoveTarget;
            dispatch({ type: 'UPDATE_ELEMENT', id, update: element => {
                if (element.type !== 'arrow' && element.type !== 'connector') return;
                if (target?.kind === 'branch' && target.branchId) {
                    const branch = getArrowBranches(element).find(b => b.id === target.branchId);
                    if (!branch) return;
                    const nearest = nearestBranchPathLocation(p, element, branch);
                    branch.labelPosition = clampArrowLabelPosition(nearest.pathPosition);
                    const sideDot = (p.x - nearest.point.x) * nearest.normal.x + (p.y - nearest.point.y) * nearest.normal.y;
                    if (Math.abs(sideDot) > 2 / appState.camera.zoom) branch.labelSide = sideDot >= 0 ? 1 : -1;
                } else {
                    const nearest = nearestArrowPathLocation(p, element);
                    element.labelPosition = clampArrowLabelPosition(nearest.pathPosition);
                    const sideDot = (p.x - nearest.point.x) * nearest.normal.x + (p.y - nearest.point.y) * nearest.normal.y;
                    if (Math.abs(sideDot) > 2 / appState.camera.zoom) element.labelSide = sideDot >= 0 ? 1 : -1;
                }
            } });
            redraw();
        }
        return;
    }
    if (appState.mode === 'arrow-branch-control' || appState.mode === 'arrow-branch-end') {
        const id = appState.selectedIds.length === 1 ? appState.selectedIds[0] : undefined;
        const current = id ? getSceneElementById(id) : undefined;
        const branchId = appState.activeArrowBranchId;
        if (id && current && (current.type === 'arrow' || current.type === 'connector') && branchId) {
            const branch = getArrowBranches(current).find(b => b.id === branchId);
            if (branch) {
                const bpts = getArrowBranchPathPoints(current, branch);
                const idx = appState.activeArrowBranchPointIndex ?? bpts.length - 1;
                const isEnd = appState.mode === 'arrow-branch-end' || idx === bpts.length - 1;
                const snap = isEnd ? findConnectionAtPoint(p, current.id) : undefined;
                dispatch({ type: 'UPDATE_ELEMENT', id, update: element => {
                    if (element.type !== 'arrow' && element.type !== 'connector') return;
                    const targetBranch = getArrowBranches(element).find(b => b.id === branchId);
                    if (!targetBranch) return;
                    if (isEnd) {
                        targetBranch.end = snap?.position ?? p;
                        targetBranch.endBinding = snap?.id;
                        targetBranch.endBindingPoint = snap?.point;
                        targetBranch.endBindingAnchor = snap?.anchor;
                    } else {
                        const root = targetBranch.root === 'start' ? element.start : element.end;
                        const interiors = getBranchInteriorPoints(targetBranch, root);
                        interiors[idx - 1] = p;
                        setBranchInteriorPoints(targetBranch, interiors);
                    }
                } });
                redraw();
            }
        }
        return;
    }
    if (appState.mode === 'arrow-start' || appState.mode === 'arrow-control' || appState.mode === 'arrow-end') {
        const id = appState.selectedIds.length === 1 ? appState.selectedIds[0] : undefined;
        const current = id ? getSceneElementById(id) : undefined;
        if (id && current && (current.type === 'arrow' || current.type === 'connector')) {
            const pts = getArrowPathPoints(current);
            const idx = appState.activeArrowPointIndex ?? (appState.mode === 'arrow-start' ? 0 : appState.mode === 'arrow-end' ? pts.length - 1 : Math.floor(pts.length / 2));
            const snap = (idx === 0 || idx === pts.length - 1) ? findConnectionAtPoint(p, current.id) : undefined;
            dispatch({ type: 'UPDATE_ELEMENT', id, update: element => {
                if (element.type !== 'arrow' && element.type !== 'connector') return;
                const updatePts = getArrowPathPoints(element);
                if (idx === 0) {
                    element.start = snap?.position ?? p;
                    element.startBinding = snap?.id;
                    element.startBindingPoint = snap?.point;
                    element.startBindingAnchor = snap?.anchor;
                } else if (idx === updatePts.length - 1) {
                    element.end = snap?.position ?? p;
                    element.endBinding = snap?.id;
                    element.endBindingPoint = snap?.point;
                    element.endBindingAnchor = snap?.anchor;
                } else {
                    const interiors = getArrowInteriorPoints(element);
                    interiors[idx - 1] = p;
                    setArrowInteriorPoints(element, interiors);
                }
            } });
            redraw();
        }
        return;
    }
    if (appState.mode === 'drawing') {
        const current = appState.elements[appState.elements.length - 1] as CanvasElement | undefined;
        if (!current) return;
        const snap = (current.type === 'arrow' || current.type === 'connector') ? findConnectionAtPoint(p, current.id) : undefined;
        if (current.type === 'freehand') {
            dispatch({ type: 'APPEND_FREEHAND_POINT', id: current.id, point: p });
            const updated = getSceneElementById(current.id);
            if (updated?.type === 'freehand') extendFreehandBounds(updated, p);
        } else dispatch({ type: 'UPDATE_ELEMENT', id: current.id, update: element => {
            if (element.type === 'rectangle' || element.type === 'note') {
                element.width = p.x - appState.dragStartWorld.x;
                element.height = p.y - appState.dragStartWorld.y;
            } else if (element.type === 'arrow' || element.type === 'connector') {
                const end = snap?.position ?? p;
                element.end = end;
                element.endBinding = snap?.id;
                element.endBindingPoint = snap?.point;
                element.endBindingAnchor = snap?.anchor;
                setArrowInteriorPoints(element, [lerpPoint(element.start, end, .5)]);
            }
        } });
        redraw();
        return;
    }
    if (appState.activeTool === 'eraser') {
        dispatch({ type: 'SET_INTERACTION', patch: { eraserTargetId: findEraserTarget(p)?.id ?? null } });
        dispatch({ type: 'SET_INTERACTION', patch: { eraserPreviewIds: appState.eraserTargetId ? new Set([appState.eraserTargetId]) : new Set() } });
        redraw();
    }
});

window.addEventListener('mouseup', e => {
    if (pendingHotPointerFrame && (appState.mode === 'moving' || appState.mode === 'resizing' || appState.mode === 'panning')) flushHotPointerFrame();
    if (e.button === 0 && (appState.mode === 'eraser-preview' || appState.mode === 'eraser-marquee')) {
        if (appState.mode === 'eraser-marquee')
            deleteEraserTargets([...appState.eraserPreviewIds]);
        else
            deleteEraserTarget();
        cancelEraserPreview();
        return;
    }
    if (appState.mode === 'moving') {
        const dx = appState.activeMoveDelta.x, dy = appState.activeMoveDelta.y;
        if (dx !== 0 || dy !== 0) {
            moveElementsAndBindings([...appState.movingSelectionIds], { x: dx, y: dy });
        }
        dispatch({ type: 'SET_INTERACTION', patch: { activeMoveDelta: { x: 0, y: 0 } } });
    }
    if (appState.mode !== 'none') {
        if (appState.mode === 'marquee') {
            const dx = Math.abs(appState.currentMouseWorld.x - appState.dragStartWorld.x), dy = Math.abs(appState.currentMouseWorld.y - appState.dragStartWorld.y);
            if (dx < 3 / appState.camera.zoom && dy < 3 / appState.camera.zoom && appState.marqueeStartSelection.length === 0)
                dispatch({ type: 'SET_SELECTION', ids: [] });
        }
        if (appState.mode === 'drawing') {
            const current = appState.elements[appState.elements.length - 1];
            if (current?.type === 'note' && (Math.abs(current.width) < 12 || Math.abs(current.height) < 12)) {
                dispatch({ type: 'UPDATE_ELEMENT', id: current.id, update: element => {
                    if (element.type === 'note') { element.width = 170; element.height = 140; }
                } });
                dispatch({ type: 'SET_SELECTION', ids: [current.id] });
                const updated = getSceneElementById(current.id);
                if (updated?.type === 'note') startTextEditing({ x: Math.min(updated.x, updated.x + updated.width), y: Math.min(updated.y, updated.y + updated.height) }, updated.id);
            } else if (current?.type === 'rectangle' && (Math.abs(current.width) < 10 || Math.abs(current.height) < 10)) {
                dispatch({ type: 'DELETE_ELEMENTS', ids: [current.id] });
            } else if (current?.type === 'arrow' || current?.type === 'connector') {
                const startSnap = !current.startBinding ? findConnectionAtPoint(current.start, current.id) : undefined;
                const endSnap = !current.endBinding ? findConnectionAtPoint(current.end, current.id) : undefined;
                if (startSnap || endSnap) {
                    dispatch({ type: 'UPDATE_ELEMENT', id: current.id, update: element => {
                        if (element.type !== 'arrow' && element.type !== 'connector') return;
                        if (startSnap && !element.startBinding) {
                            element.startBinding = startSnap.id;
                            element.startBindingPoint = startSnap.point;
                            element.startBindingAnchor = startSnap.anchor;
                            element.start = startSnap.position;
                        }
                        if (endSnap && !element.endBinding) {
                            element.endBinding = endSnap.id;
                            element.endBindingPoint = endSnap.point;
                            element.endBindingAnchor = endSnap.anchor;
                            element.end = endSnap.position;
                        }
                    } });
                }
                dispatch({ type: 'SET_SELECTION', ids: [current.id] });
                setTool('select');
            }
        }
        dispatch({ type: 'SET_INTERACTION', patch: { mode: 'none' } });
        dispatch({ type: 'SET_INTERACTION', patch: { activeArrowPointIndex: null } });
        dispatch({ type: 'SET_INTERACTION', patch: { activeArrowBranchId: null } });
        dispatch({ type: 'SET_INTERACTION', patch: { activeArrowBranchPointIndex: null } });
        dispatch({ type: 'SET_INTERACTION', patch: { activeArrowLabelMoveTarget: null } });
        dispatch({ type: 'SET_INTERACTION', patch: { initialElementsState: [] } });
        dispatch({ type: 'SET_INTERACTION', patch: { initialElementsById: new Map() } });
        dispatch({ type: 'SET_INTERACTION', patch: { movingSelectionIds: new Set() } });
        dispatch({ type: 'SET_INTERACTION', patch: { activeMoveDelta: { x: 0, y: 0 } } });
        dispatch({ type: 'SET_INTERACTION', patch: { moveBackgroundCanvas: null } });
        dispatch({ type: 'SET_INTERACTION', patch: { moveSelectionCanvas: null } });
        dispatch({ type: 'SET_INTERACTION', patch: { altDragDuplicated: false } });
        dispatch({ type: 'SET_INTERACTION', patch: { initialGroupBounds: null } });
        activeSnapTargets = null;
        dispatch({ type: 'SET_INTERACTION', patch: { activeResizeHandle: null } });
        dispatch({ type: 'SET_INTERACTION', patch: { marqueeStartSelection: [] } });
        saveToLocal();
        commitHistory(appState.pendingHistoryBefore);
        dispatch({ type: 'SET_HISTORY', patch: { pendingHistoryBefore: null } });
        redraw();
    }
});

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const oldZoom = appState.camera.zoom;
    const newZoom = Math.min(Math.max(.1, oldZoom - e.deltaY * .001), 5);
    dispatch({ type: 'SET_CAMERA', camera: {
        x: e.clientX - (e.clientX - appState.camera.x) * (newZoom / oldZoom),
        y: e.clientY - (e.clientY - appState.camera.y) * (newZoom / oldZoom),
        zoom: newZoom,
    } });
    if (appState.textEditor) positionTextEditor();
    redraw();
}, { passive: false });
