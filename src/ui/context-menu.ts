// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { copyAsPng, copyAsSvg, exportAsPng, exportAsSvg } from '../exports/index';
import { alignSelection } from '../interactions/align';
import { requestLayersPanelRefresh } from '../layers/index';
import { canGroupLayerSelection, getDescendantElementIds, groupsFullyContainedBySelection, nextLayerGroupName, selectionHasLayerGroup } from '../layers/model';
import { arrowMode, createArrowBranches, getArrowInteriorPoints, getSpatialIndexBounds, hitTestElement, removeArrowBranch, setArrowMode, setArrowPointCount } from '../model/geometry';
import { generateId } from '../model/ids';
import { ArrowElement, CanvasElement, FreehandElement, LayerClipboardPayload, LayerGroupNode, Point } from '../model/types';
import { saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { shortcutLabel } from '../shortcuts/index';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { appState, dispatch } from '../state/store';
import { querySceneElements } from '../performance/scene-index';
import { contextMenu } from './dom';
import { updateTextStylePanel } from './inspector';
import { promptDialog } from './dialogs';

export function findTextTarget(p: Point): {
    id: string | null;
    element?: CanvasElement;
    anchor?: Point;
} {
    const pad = 8 / Math.max(.1, appState.camera.zoom);
    const candidates = querySceneElements({ x: p.x - pad, y: p.y - pad, width: pad * 2, height: pad * 2 }, getSpatialIndexBounds);
    for (let i = candidates.length - 1; i >= 0; i--) {
        const el = candidates[i];
        if (el.locked || el.hidden)
            continue;
        if ((el.type === 'note' || el.type === 'rectangle' || el.type === 'text') && hitTestElement(p, el))
            return { id: el.id, element: el };
    }
    return { id: null, anchor: p };
}

// --- 7. CONTEXT MENU ---
export function hideContextMenu() {
    contextMenu.classList.remove('visible');
    contextMenu.setAttribute('aria-hidden', 'true');
}

export function getContextMenuPosition(x: number, y: number) {
    const menuWidth = 238, menuHeight = 640;
    return {
        left: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    };
}

export function getStructuralSelectionIds(): string[] {
    return appState.selectedLayerGroupId
        ? getDescendantElementIds(appState.elements, appState.layerGroups, appState.selectedLayerGroupId)
        : [...appState.selectedIds];
}

export function showContextMenu(x: number, y: number) {
    dispatch({ type: 'SET_UI', patch: { contextMenuX: x, contextMenuY: y } });
    const pos = getContextMenuPosition(x, y);
    contextMenu.style.left = `${pos.left}px`;
    contextMenu.style.top = `${pos.top}px`;
    contextMenu.classList.add('visible');
    contextMenu.setAttribute('aria-hidden', 'false');
    const structuralIds = getStructuralSelectionIds();
    const exactGroupSelected = !!appState.selectedLayerGroupId;
    const structuralSelectionLocked = selectionContainsLocked(structuralIds);
    const canGroup = canGroupLayerSelection(appState.elements, appState.layerGroups, appState.selectedIds) && !selectionContainsLocked();
    const hasGroup = selectionHasLayerGroup(appState.elements, appState.layerGroups, appState.selectedIds, appState.selectedLayerGroupId);
    contextMenu.querySelector('[data-action="group"]')?.classList.toggle('disabled', !canGroup);
    contextMenu.querySelector('[data-action="ungroup"]')?.classList.toggle('disabled', !hasGroup || structuralSelectionLocked);
    // A group row is one structural node. Align/distribute would otherwise align
    // its children against each other, and Arrange would silently invent group
    // z-order semantics. Keep those commands leaf/multi-object only for now.
    contextMenu.querySelector('#context-align-trigger')?.classList.toggle('disabled', exactGroupSelected || appState.selectedIds.length < 2 || selectionContainsLocked());
    contextMenu.querySelectorAll<HTMLElement>('.distribution-context').forEach(el => el.classList.toggle('disabled', exactGroupSelected || appState.selectedIds.length < 3 || selectionContainsLocked()));
    contextMenu.querySelector('[data-action="delete"]')?.classList.toggle('disabled', structuralSelectionLocked || structuralIds.length === 0);
    contextMenu.querySelector('[data-action="duplicate"]')?.classList.toggle('disabled', structuralSelectionLocked || structuralIds.length === 0);
    contextMenu.querySelector('[data-action="cut"]')?.classList.toggle('disabled', structuralSelectionLocked || structuralIds.length === 0);
    contextMenu.querySelectorAll<HTMLElement>('[data-action="front"],[data-action="back"],[data-action="forward"],[data-action="backward"]').forEach(el => el.classList.toggle('disabled', exactGroupSelected || selectionContainsLocked() || appState.selectedIds.length === 0));
    const selectedArrow = !exactGroupSelected && appState.selectedIds.length === 1 ? appState.elements.find(el => el.id === appState.selectedIds[0]) : undefined;
    const showArrowPoints = !!selectedArrow && (selectedArrow.type === 'arrow' || selectedArrow.type === 'connector');
    contextMenu.classList.toggle('has-arrow-points', showArrowPoints);
    contextMenu.querySelectorAll<HTMLElement>('.arrow-points-context,.arrow-mode-context').forEach(el => el.hidden = !showArrowPoints);
    const branchMode = showArrowPoints && arrowMode(selectedArrow as ArrowElement) === 'branches';
    const showBranchMenu = !!branchMode && (!!appState.contextArrowEndpoint || !!appState.contextArrowBranchId);
    contextMenu.querySelectorAll<HTMLElement>('.branch-context').forEach(el => el.hidden = !showBranchMenu);
    contextMenu.querySelectorAll<HTMLElement>('.branch-add-context').forEach(el => el.hidden = !appState.contextArrowEndpoint);
    contextMenu.querySelectorAll<HTMLElement>('.branch-remove-context').forEach(el => el.hidden = !appState.contextArrowBranchId);
    if (showArrowPoints) {
        const arrow = selectedArrow as ArrowElement, waypointCount = getArrowInteriorPoints(arrow).length, count = waypointCount === 1 ? 3 : waypointCount === 3 ? 5 : 0, modeValue = arrowMode(arrow);
        contextMenu.querySelector('[data-action="arrow-points-3"]')?.classList.toggle('context-selected', count === 3);
        contextMenu.querySelector('[data-action="arrow-points-5"]')?.classList.toggle('context-selected', count === 5);
        contextMenu.querySelector('[data-action="arrow-mode-connection"]')?.classList.toggle('context-selected', modeValue === 'connection');
        contextMenu.querySelector('[data-action="arrow-mode-branches"]')?.classList.toggle('context-selected', modeValue === 'branches');
    }
    // Position every submenu against its actual trigger after optional Arrow/Branch
    // rows are shown/hidden. This avoids brittle hard-coded top offsets.
    contextMenu.querySelectorAll<HTMLElement>('.context-item.has-submenu').forEach(trigger => { const submenu = trigger.nextElementSibling as HTMLElement | null; if (submenu?.classList.contains('context-submenu'))
        submenu.style.top = `${trigger.offsetTop}px`; });
}

export function isElementLocked(el: CanvasElement | undefined | null): boolean { return !!el?.locked; }

export function selectionContainsLocked(ids: string[] = appState.selectedIds): boolean { return ids.some(id => isElementLocked(appState.elements.find(el => el.id === id))); }

export function canMutateSelection(ids: string[] = appState.selectedIds): boolean { return ids.length > 0 && !selectionContainsLocked(ids); }

export function updateSelectedLockButton() {
    const btn = document.getElementById('btn-lock-selected') as HTMLButtonElement | null;
    if (!btn)
        return;
    const ids = getStructuralSelectionIds();
    const selected = appState.elements.filter(el => ids.includes(el.id) && !el.locked);
    btn.disabled = selected.length === 0;
    btn.classList.remove('active');
    btn.setAttribute('aria-label', 'Lock selected layers');
    btn.setAttribute('title', `Lock selected (${shortcutLabel('toggleLock')})`);
}

export function toggleLockForIds(ids: string[], force?: boolean, fromLayerControl = false) {
    const targets = appState.elements.filter(el => ids.includes(el.id));
    if (!targets.length)
        return;
    const next = force ?? !targets.every(el => !!el.locked);
    // Unlocking is intentionally restricted to the All Layers lock control.
    if (!next && !fromLayerControl)
        return;
    const before = beginHistoryTransaction();
    dispatch({ type: 'LOCK_ELEMENTS', ids, locked: next });
    saveToLocal();
    commitHistory(before);
    redraw();
    requestLayersPanelRefresh();
    updateTextStylePanel();
}

export function lockSelectedObjects() {
    const ids = getStructuralSelectionIds().filter(id => !appState.elements.find(el => el.id === id)?.locked);
    if (!ids.length)
        return;
    toggleLockForIds(ids, true, false);
    dispatch({ type: 'SET_SELECTION', ids: [] });
    redraw();
    requestLayersPanelRefresh();
    updateTextStylePanel();
}

export function copyRuntimeMediaReference(source: CanvasElement, copy: CanvasElement) {
    if (source.type !== 'media' || copy.type !== 'media') return;
    // Runtime media is cached by assetId, so duplicates intentionally share the
    // same Blob asset without copying bytes or per-element media instances.
    copy.assetId = source.assetId;
}

export function duplicateSelectionForAltDrag(): boolean {
    if (!canMutateSelection()) return false;
    const source = appState.elements.filter(el => appState.selectedIds.includes(el.id));
    if (!source.length) return false;
    const cloned = cloneSelectionHierarchy(source, appState.layerGroups, 0, 0, appState.elements);
    source.forEach((el, i) => copyRuntimeMediaReference(el, cloned.elements[i]));
    dispatch({ type: 'ADD_ELEMENTS', elements: cloned.elements });
    if (cloned.layerGroups.length) dispatch({ type: 'ADD_LAYER_GROUPS', groups: cloned.layerGroups });
    dispatch({ type: 'SET_SELECTION', ids: cloned.elements.map(el => el.id) });
    dispatch({ type: 'SET_INTERACTION', patch: { altDragDuplicated: true } });
    return true;
}

export function deleteSelectedObjects() {
    const ids = getStructuralSelectionIds();
    if (!canMutateSelection(ids)) return false;
    const before = beginHistoryTransaction();
    dispatch({ type: 'DELETE_ELEMENTS', ids });
    dispatch({ type: 'SET_SELECTION', ids: [] });
    saveToLocal();
    commitHistory(before);
    redraw();
    requestLayersPanelRefresh();
    updateTextStylePanel();
    return true;
}

export function cloneElements(items: CanvasElement[], dx = 20, dy = 20): CanvasElement[] {
    return items.map(el => {
        const cloned = structuredClone(el) as CanvasElement;
        cloned.id = generateId();
        // Structural membership is cloned separately by cloneSelectionHierarchy().
        cloned.parentGroupId = undefined;
        if (cloned.type === 'rectangle' || cloned.type === 'text' || cloned.type === 'note' || cloned.type === 'media') {
            cloned.x += dx;
            cloned.y += dy;
        }
        else if (cloned.type === 'arrow' || cloned.type === 'connector') {
            cloned.start.x += dx;
            cloned.start.y += dy;
            cloned.control.x += dx;
            cloned.control.y += dy;
            if (cloned.controls)
                cloned.controls = cloned.controls.map(p => ({ x: p.x + dx, y: p.y + dy }));
            cloned.end.x += dx;
            cloned.end.y += dy;
            cloned.startBinding = undefined;
            cloned.endBinding = undefined;
            cloned.startBindingPoint = undefined;
            cloned.endBindingPoint = undefined;
            cloned.startBindingAnchor = undefined;
            cloned.endBindingAnchor = undefined;
            if (cloned.branches)
                cloned.branches = cloned.branches.map(branch => ({ ...branch, end: { x: branch.end.x + dx, y: branch.end.y + dy }, controls: branch.controls?.map(p => ({ x: p.x + dx, y: p.y + dy })), endBinding: undefined, endBindingPoint: undefined, endBindingAnchor: undefined }));
        }
        else {
            const free = cloned as FreehandElement;
            free.points = free.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        }
        return cloned;
    });
}

function clipboardPayloadForSelection(items: CanvasElement[], groups: LayerGroupNode[], universeElements: CanvasElement[] = items): LayerClipboardPayload {
    const selectedIds = items.map(element => element.id);
    const includedGroups = groupsFullyContainedBySelection(universeElements, groups, selectedIds);
    const includedIds = new Set(includedGroups.map(group => group.id));
    return {
        elements: structuredClone(items).map(element => {
            if (element.parentGroupId && !includedIds.has(element.parentGroupId)) element.parentGroupId = undefined;
            return element;
        }),
        layerGroups: structuredClone(includedGroups).map(group => ({
            ...group,
            parentGroupId: group.parentGroupId && includedIds.has(group.parentGroupId) ? group.parentGroupId : undefined,
        })),
    };
}

export function cloneSelectionHierarchy(items: CanvasElement[], groups: LayerGroupNode[], dx = 20, dy = 20, universeElements: CanvasElement[] = items): LayerClipboardPayload {
    const source = clipboardPayloadForSelection(items, groups, universeElements);
    const groupIdMap = new Map(source.layerGroups.map(group => [group.id, generateId()]));
    const elements = cloneElements(source.elements, dx, dy);
    const elementIdMap = new Map(source.elements.map((element, index) => [element.id, elements[index].id]));
    elements.forEach((element, index) => {
        const original = source.elements[index];
        const originalParent = original?.parentGroupId;
        element.parentGroupId = originalParent ? groupIdMap.get(originalParent) : undefined;

        // Preserve bindings that point to another object inside the duplicated
        // payload. cloneElements() intentionally clears bindings first so links
        // to objects outside the copied selection remain detached.
        if (!original || (element.type !== 'arrow' && element.type !== 'connector') || (original.type !== 'arrow' && original.type !== 'connector')) return;
        const mapBinding = (bindingId: string | undefined) => bindingId ? elementIdMap.get(bindingId) : undefined;
        const startBinding = mapBinding(original.startBinding);
        if (startBinding) {
            element.startBinding = startBinding;
            element.startBindingPoint = original.startBindingPoint;
            element.startBindingAnchor = original.startBindingAnchor ? { ...original.startBindingAnchor } : undefined;
        }
        const endBinding = mapBinding(original.endBinding);
        if (endBinding) {
            element.endBinding = endBinding;
            element.endBindingPoint = original.endBindingPoint;
            element.endBindingAnchor = original.endBindingAnchor ? { ...original.endBindingAnchor } : undefined;
        }
        if (element.branches && original.branches) {
            element.branches = element.branches.map((branch, branchIndex) => {
                const originalBranch = original.branches?.[branchIndex];
                const rebound = originalBranch ? mapBinding(originalBranch.endBinding) : undefined;
                return rebound && originalBranch ? {
                    ...branch,
                    endBinding: rebound,
                    endBindingPoint: originalBranch.endBindingPoint,
                    endBindingAnchor: originalBranch.endBindingAnchor ? { ...originalBranch.endBindingAnchor } : undefined,
                } : branch;
            });
        }
    });
    const layerGroups = source.layerGroups.map(group => ({
        ...structuredClone(group),
        id: groupIdMap.get(group.id)!,
        parentGroupId: group.parentGroupId ? groupIdMap.get(group.parentGroupId) : undefined,
    }));
    return { elements, layerGroups };
}

export function groupSelectedObjects(): boolean {
    if (selectionContainsLocked() || !canGroupLayerSelection(appState.elements, appState.layerGroups, appState.selectedIds)) return false;
    const before = beginHistoryTransaction();
    const group: LayerGroupNode = { id: generateId(), name: nextLayerGroupName(appState.layerGroups) };
    dispatch({ type: 'GROUP_LAYER_SELECTION', ids: [...appState.selectedIds], group });
    saveToLocal();
    commitHistory(before);
    redraw();
    requestLayersPanelRefresh();
    updateTextStylePanel();
    return true;
}

export function ungroupSelectedObjects(): boolean {
    const ungroupIds = appState.selectedLayerGroupId
        ? getDescendantElementIds(appState.elements, appState.layerGroups, appState.selectedLayerGroupId)
        : appState.selectedIds;
    if (selectionContainsLocked(ungroupIds) || !selectionHasLayerGroup(appState.elements, appState.layerGroups, appState.selectedIds, appState.selectedLayerGroupId)) return false;
    const before = beginHistoryTransaction();
    dispatch({ type: 'UNGROUP_LAYER_SELECTION', ids: [...appState.selectedIds], preferredGroupId: appState.selectedLayerGroupId });
    saveToLocal();
    commitHistory(before);
    redraw();
    requestLayersPanelRefresh();
    updateTextStylePanel();
    return true;
}

export async function copySelectionToClipboard(removeAfter = false) {
    const ids = getStructuralSelectionIds();
    const items = appState.elements.filter(el => ids.includes(el.id));
    if (!items.length)
        return;
    const internalClipboard = clipboardPayloadForSelection(items, appState.layerGroups, appState.elements);
    dispatch({ type: 'SET_UI', patch: { internalClipboard } });
    try {
        await navigator.clipboard.writeText(JSON.stringify(appState.internalClipboard));
    }
    catch {
        // Internal clipboard still works when browser permissions deny access.
    }
    if (removeAfter) {
        if (selectionContainsLocked(ids))
            return;
        const before = beginHistoryTransaction();
        dispatch({ type: 'DELETE_ELEMENTS', ids });
        dispatch({ type: 'SET_SELECTION', ids: [] });
        await saveToLocal();
        commitHistory(before);
        redraw();
    }
}

export function pasteFromClipboard() {
    if (!appState.internalClipboard.elements.length)
        return;
    const before = beginHistoryTransaction();
    const pasted = cloneSelectionHierarchy(appState.internalClipboard.elements, appState.internalClipboard.layerGroups, 24, 24, appState.internalClipboard.elements);
    appState.internalClipboard.elements.forEach((el, i) => copyRuntimeMediaReference(el, pasted.elements[i]));
    pasted.elements.forEach(el => el.locked = false);
    dispatch({ type: 'ADD_ELEMENTS', elements: pasted.elements });
    if (pasted.layerGroups.length) dispatch({ type: 'ADD_LAYER_GROUPS', groups: pasted.layerGroups });
    dispatch({ type: 'SET_SELECTION', ids: pasted.elements.filter(el => !el.hidden && !el.locked).map(el => el.id) });
    saveToLocal();
    commitHistory(before);
    redraw();
    requestLayersPanelRefresh();
}

export function arrangeSelection(action: 'front' | 'back' | 'forward' | 'backward') {
    if (appState.selectedLayerGroupId || !canMutateSelection()) return;
    const before = beginHistoryTransaction();
    const selectedSet = new Set(appState.selectedIds);
    const selected = appState.elements.filter(el => selectedSet.has(el.id));
    const unselected = appState.elements.filter(el => !selectedSet.has(el.id));
    let nextElements: CanvasElement[];
    if (action === 'front') nextElements = [...unselected, ...selected];
    else if (action === 'back') nextElements = [...selected, ...unselected];
    else {
        nextElements = [...appState.elements];
        const direction = action === 'forward' ? 1 : -1;
        const orderedIds = selected.map(el => el.id);
        if (direction > 0) {
            for (let i = nextElements.length - 2; i >= 0; i--) {
                if (orderedIds.includes(nextElements[i].id) && !orderedIds.includes(nextElements[i + 1].id)) {
                    [nextElements[i], nextElements[i + 1]] = [nextElements[i + 1], nextElements[i]];
                }
            }
        } else {
            for (let i = 1; i < nextElements.length; i++) {
                if (orderedIds.includes(nextElements[i].id) && !orderedIds.includes(nextElements[i - 1].id)) {
                    [nextElements[i], nextElements[i - 1]] = [nextElements[i - 1], nextElements[i]];
                }
            }
        }
    }
    dispatch({ type: 'REORDER_ELEMENTS', elements: nextElements });
    saveToLocal();
    commitHistory(before);
    redraw();
    requestLayersPanelRefresh();
    updateTextStylePanel();
}

document.querySelectorAll<HTMLButtonElement>('[data-export-scale]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    dispatch({ type: 'SET_PROJECT', patch: { exportPngScale: Math.max(1, Number(btn.dataset.exportScale) || 4) } });
    document.querySelectorAll<HTMLButtonElement>('[data-export-scale]').forEach(b => b.classList.toggle('selected', b === btn));
}));

contextMenu.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!target || target.classList.contains('disabled'))
        return;
    const action = target.dataset.action!;
    switch (action) {
        case 'group': {
            groupSelectedObjects();
            break;
        }
        case 'ungroup': {
            ungroupSelectedObjects();
            break;
        }
        case 'duplicate': {
            const sourceIds = getStructuralSelectionIds();
            if (selectionContainsLocked(sourceIds))
                break;
            const before = beginHistoryTransaction();
            const source = appState.elements.filter(el => sourceIds.includes(el.id));
            const cloned = cloneSelectionHierarchy(source, appState.layerGroups, 20, 20, appState.elements);
            source.forEach((el, i) => copyRuntimeMediaReference(el, cloned.elements[i]));
            dispatch({ type: 'ADD_ELEMENTS', elements: cloned.elements });
            if (cloned.layerGroups.length) dispatch({ type: 'ADD_LAYER_GROUPS', groups: cloned.layerGroups });
            dispatch({ type: 'SET_SELECTION', ids: cloned.elements.filter(el => !el.hidden && !el.locked).map(el => el.id) });
            saveToLocal();
            commitHistory(before);
            redraw();
            break;
        }
        case 'delete': {
            deleteSelectedObjects();
            break;
        }
        case 'copy':
            await copySelectionToClipboard();
            break;
        case 'cut':
            await copySelectionToClipboard(true);
            break;
        case 'paste':
            pasteFromClipboard();
            break;
        case 'front':
        case 'back':
        case 'forward':
        case 'backward':
            arrangeSelection(action);
            break;
        case 'align-left':
            alignSelection('left');
            break;
        case 'align-center-h':
            alignSelection('center-h');
            break;
        case 'align-right':
            alignSelection('right');
            break;
        case 'align-top':
            alignSelection('top');
            break;
        case 'align-center-v':
            alignSelection('center-v');
            break;
        case 'align-bottom':
            alignSelection('bottom');
            break;
        case 'distribute-h':
            alignSelection('distribute-h');
            break;
        case 'distribute-v':
            alignSelection('distribute-v');
            break;
        case 'space-h':
            alignSelection('space-h');
            break;
        case 'space-v':
            alignSelection('space-v');
            break;
        case 'arrow-mode-connection':
        case 'arrow-mode-branches': {
            const arrow = appState.selectedIds.length === 1 ? appState.elements.find(el => el.id === appState.selectedIds[0]) : undefined;
            if (arrow && (arrow.type === 'arrow' || arrow.type === 'connector')) {
                const before = beginHistoryTransaction();
                dispatch({ type: 'UPDATE_ELEMENT', id: arrow.id, update: el => { if (el.type === 'arrow' || el.type === 'connector') setArrowMode(el as ArrowElement, action === 'arrow-mode-branches' ? 'branches' : 'connection'); } });
                saveToLocal();
                commitHistory(before);
                redraw();
            }
            break;
        }
        case 'branch-add-1':
        case 'branch-add-2':
        case 'branch-add-3':
        case 'branch-add-5':
        case 'branch-add-x': {
            const arrow = appState.selectedIds.length === 1 ? appState.elements.find(el => el.id === appState.selectedIds[0]) : undefined;
            if (arrow && (arrow.type === 'arrow' || arrow.type === 'connector')) {
                let count = action === 'branch-add-x' ? Number(await promptDialog({ title: 'Add branches', message: 'How many branches should Rimmap add?', value: '4', inputMode: 'numeric', confirmLabel: 'Add branches' })) : Number(action.split('-').pop());
                if (Number.isFinite(count) && count > 0) {
                    const before = beginHistoryTransaction();
                    dispatch({ type: 'UPDATE_ELEMENT', id: arrow.id, update: el => {
                        if (el.type !== 'arrow' && el.type !== 'connector') return;
                        const a = el as ArrowElement;
                        setArrowMode(a, 'branches');
                        createArrowBranches(a, appState.contextArrowEndpoint || 'end', Math.min(50, count));
                    } });
                    saveToLocal();
                    commitHistory(before);
                    redraw();
                }
            }
            break;
        }
        case 'branch-remove': {
            const arrow = appState.selectedIds.length === 1 ? appState.elements.find(el => el.id === appState.selectedIds[0]) : undefined;
            if (arrow && (arrow.type === 'arrow' || arrow.type === 'connector') && appState.contextArrowBranchId) {
                const before = beginHistoryTransaction();
                const branchId = appState.contextArrowBranchId;
                dispatch({ type: 'UPDATE_ELEMENT', id: arrow.id, update: el => { if ((el.type === 'arrow' || el.type === 'connector') && branchId) removeArrowBranch(el as ArrowElement, branchId); } });
                saveToLocal();
                commitHistory(before);
                redraw();
            }
            break;
        }
        case 'arrow-points-3':
        case 'arrow-points-5': {
            const arrow = appState.selectedIds.length === 1 ? appState.elements.find(el => el.id === appState.selectedIds[0]) : undefined;
            if (arrow && (arrow.type === 'arrow' || arrow.type === 'connector')) {
                const before = beginHistoryTransaction();
                dispatch({ type: 'UPDATE_ELEMENT', id: arrow.id, update: el => { if (el.type === 'arrow' || el.type === 'connector') setArrowPointCount(el as ArrowElement, action === 'arrow-points-5' ? 5 : 3); } });
                saveToLocal();
                commitHistory(before);
                redraw();
            }
            break;
        }
        case 'select-all':
            dispatch({ type: 'SET_SELECTION', ids: appState.elements.filter(el => !el.hidden).map(el => el.id) });
            redraw();
            break;
        case 'copy-svg':
            await copyAsSvg((document.getElementById('copy-transparent') as HTMLInputElement).checked);
            break;
        case 'copy-png':
            await copyAsPng((document.getElementById('copy-transparent') as HTMLInputElement).checked);
            break;
        case 'export-svg':
            await exportAsSvg((document.getElementById('export-transparent') as HTMLInputElement).checked);
            break;
        case 'export-png':
            await exportAsPng((document.getElementById('export-transparent') as HTMLInputElement).checked);
            break;
    }
    hideContextMenu();
    requestLayersPanelRefresh();
});

document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target as Node))
        hideContextMenu();
});
