// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { setTool } from '../interactions/tools';
import { getSpatialIndexBounds, hitTestArrowVisual, hitTestElement } from '../model/geometry';
import { ArrowElement, CanvasElement, LayerGroupNode, Point } from '../model/types';
import { saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { appState, dispatch } from '../state/store';
import { escapeHtml } from '../text-editor/index';
import { showContextMenu, toggleLockForIds, updateSelectedLockButton } from '../ui/context-menu';
import { appDiv } from '../ui/dom';
import { enablePanelDrag, updateTextStylePanel } from '../ui/inspector';
import { querySceneElements } from '../performance/scene-index';
import { buildLayerPanelRows, getDescendantElementIds, getSelectableDescendantIds, getSelectionClusterForElement } from './model';

export const LAYERS_SEARCH_MIN_COUNT = 20;

export function elementTypeLabel(el: CanvasElement): string {
    if (el.type === 'note')
        return 'Note';
    if (el.type === 'rectangle')
        return 'Rectangle';
    if (el.type === 'arrow')
        return 'Arrow';
    if (el.type === 'connector')
        return 'Connector';
    if (el.type === 'text')
        return 'Text';
    if (el.type === 'freehand')
        return 'Brush';
    return 'Image';
}

export function defaultElementLayerName(el: CanvasElement): string {
    const index = appState.elements.findIndex(x => x.id === el.id);
    return `${elementTypeLabel(el)} ${index >= 0 ? index + 1 : ''}`.trim();
}

export function nextAutoLayerName(type: CanvasElement['type']): string {
    const label = elementTypeLabel({ type } as CanvasElement);
    let max = 0;
    for (const el of appState.elements) {
        const name = el.name?.trim() || '';
        if (!name)
            continue;
        const match = name.match(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`, 'i'));
        if (match)
            max = Math.max(max, Number(match[1]));
    }
    return `${label} ${max + 1}`;
}

export function ensureStableLayerNames() {
    const counters = new Map<string, number>();
    for (const el of appState.elements) {
        if (el.name?.trim())
            continue;
        const label = elementTypeLabel(el);
        const next = (counters.get(label) ?? 0) + 1;
        counters.set(label, next);
        dispatch({ type: 'RENAME_ELEMENT', id: el.id, name: `${label} ${next}` });
    }
}

export function getElementLayerName(el: CanvasElement): string {
    return el.name?.trim() || defaultElementLayerName(el);
}

export function findElementsAtPoint(p: Point): CanvasElement[] {
    const hits: CanvasElement[] = [];
    const pad = 12 / Math.max(.1, appState.camera.zoom);
    const candidates = querySceneElements({ x: p.x - pad, y: p.y - pad, width: pad * 2, height: pad * 2 }, getSpatialIndexBounds);
    for (let i = candidates.length - 1; i >= 0; i--) {
        const el = candidates[i];
        if (el.locked || el.hidden)
            continue;
        const hit = (el.type === 'arrow' || el.type === 'connector') ? hitTestArrowVisual(p, el as ArrowElement) : hitTestElement(p, el);
        if (hit)
            hits.push(el);
    }
    return hits;
}

export function closeLayerPicker() { appState.layerPicker?.remove(); dispatch({ type: 'SET_UI', patch: { layerPicker: null } }); }

export function showLayerPicker(p: Point, hits: CanvasElement[], screenX?: number, screenY?: number) {
    closeLayerPicker();
    if (!hits.length)
        return;
    const popup = document.createElement('div');
    dispatch({ type: 'SET_UI', patch: { layerPicker: popup } });
    popup.className = 'layer-picker';
    popup.innerHTML = `
    <div class="layer-picker-header"><span>Layers at cursor</span><button type="button" class="layer-picker-close" aria-label="Close">×</button></div>
    <div class="layer-picker-list">
      ${hits.map((el, idx) => `<div class="layer-row${idx === 0 ? ' top' : ''}" data-layer-id="${el.id}">
        <button type="button" class="layer-select-btn" title="Select ${escapeHtml(getElementLayerName(el))}"><span class="layer-z-dot"></span><span class="layer-row-label">${escapeHtml(getElementLayerName(el))}</span></button>
        <input class="layer-name-input" value="${escapeHtml(el.name || '')}" placeholder="${escapeHtml(defaultElementLayerName(el))}" aria-label="Layer name">
      </div>`).join('')}
    </div>`;
    appDiv.appendChild(popup);
    const width = 285, rowH = 44, height = Math.min(420, 58 + hits.length * rowH);
    const maxLeft = Math.max(8, window.innerWidth - width - 8), maxTop = Math.max(8, window.innerHeight - height - 8);
    // Alt+right-click uses the same anchor as the normal context menu so the
    // layer picker occupies the exact context-menu position instead of appearing
    // beside the canvas click.
    const anchorX = Number.isFinite(screenX) ? (screenX as number) : p.x + 12;
    const anchorY = Number.isFinite(screenY) ? (screenY as number) : p.y + 12;
    const left = Math.min(Math.max(8, anchorX), maxLeft), top = Math.min(Math.max(8, anchorY), maxTop);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.querySelector('.layer-picker-close')?.addEventListener('click', () => closeLayerPicker());
    popup.querySelectorAll<HTMLElement>('.layer-select-btn').forEach(btn => btn.addEventListener('click', () => {
        const row = btn.closest('.layer-row') as HTMLElement | null;
        const id = row?.dataset.layerId;
        if (!id)
            return;
        const cluster = getSelectionClusterForElement(appState.elements, appState.layerGroups, id);
        dispatch({ type: 'SET_SELECTION', ids: cluster.ids, layerGroupId: cluster.groupId });
        setTool('select');
        closeLayerPicker();
        redraw();
        updateTextStylePanel();
        requestLayersPanelRefresh();
    }));
    popup.querySelectorAll<HTMLInputElement>('.layer-name-input').forEach(input => {
        const row = input.closest('.layer-row') as HTMLElement | null;
        const id = row?.dataset.layerId;
        if (!id)
            return;
        input.addEventListener('mousedown', e => e.stopPropagation());
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                const el = appState.elements.find(x => x.id === id);
                input.value = el?.name || '';
                input.blur();
            }
        });
        input.addEventListener('change', () => {
            const el = appState.elements.find(x => x.id === id);
            if (!el || el.locked)
                return;
            const next = input.value.trim();
            if ((el.name || '') === next)
                return;
            const before = beginHistoryTransaction();
            dispatch({ type: 'RENAME_ELEMENT', id, name: next || undefined });
            saveToLocal();
            commitHistory(before);
            redraw();
            input.value = appState.elements.find(x => x.id === id)?.name || '';
        });
    });
}

export function reorderAllLayers(sourceId: string, targetId: string, insertBefore: boolean) {
    const visual = appState.elements.slice().reverse();
    const sourceIndex = visual.findIndex(el => el.id === sourceId);
    const targetIndex = visual.findIndex(el => el.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
        return;
    if (visual[sourceIndex]?.locked)
        return;
    const [moved] = visual.splice(sourceIndex, 1);
    let insertIndex = visual.findIndex(el => el.id === targetId);
    if (insertIndex < 0)
        return;
    if (!insertBefore)
        insertIndex += 1;
    visual.splice(insertIndex, 0, moved);
    const before = beginHistoryTransaction();
    dispatch({ type: 'REORDER_ELEMENTS', elements: visual.slice().reverse() });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
    requestLayersPanelRefresh();
}

export function requestLayersPanelRefresh() {
    if (appState.layersRefreshFrame !== null)
        return;
    const frame = requestAnimationFrame(() => { dispatch({ type: 'SET_UI', patch: { layersRefreshFrame: null } }); refreshAllLayersPanelNow(); });
    dispatch({ type: 'SET_UI', patch: { layersRefreshFrame: frame } });
}

export function layerLockIcon(locked: boolean): string {
    return locked
        ? `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.25" y="8.75" width="9.5" height="7" rx="1.6"/><path d="M7.5 8.75V6.8a2.5 2.5 0 0 1 5 0v1.95"/></svg>`
        : `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.25" y="8.75" width="9.5" height="7" rx="1.6"/><path d="M12.5 8.75V6.8a2.5 2.5 0 0 0-4.7-1.2"/></svg>`;
}

export function layerVisibilityIcon(hidden: boolean): string {
    return hidden
        ? `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.7 3.1 17.3 16.9"/><path d="M7.1 5.1A7.8 7.8 0 0 1 10 4.5c4.2 0 7.3 3.7 7.3 5.5a5.7 5.7 0 0 1-1.8 2.8"/><path d="M12.9 14.9a7.8 7.8 0 0 1-2.9.6c-4.2 0-7.3-3.7-7.3-5.5a5.8 5.8 0 0 1 1.8-2.8"/><path d="M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5"/></svg>`
        : `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.7 10c0-1.8 3.1-5.5 7.3-5.5s7.3 3.7 7.3 5.5-3.1 5.5-7.3 5.5S2.7 11.8 2.7 10Z"/><circle cx="10" cy="10" r="2.5"/></svg>`;
}

export function toggleVisibilityForIds(ids: string[], forceHidden?: boolean) {
    const targets = appState.elements.filter(el => ids.includes(el.id));
    if (!targets.length)
        return;
    const hidden = forceHidden ?? !targets.every(el => !!el.hidden);
    if (hidden && appState.editingTextId && ids.includes(appState.editingTextId))
        appState.textEditorContent?.blur();
    const before = beginHistoryTransaction();
    dispatch({ type: 'SET_ELEMENTS_HIDDEN', ids, hidden });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
    requestLayersPanelRefresh();
}

export function refreshAllLayersPanelNow() {
    const panel = document.getElementById('all-layers-panel') as HTMLDivElement | null;
    const list = document.getElementById('all-layers-list') as HTMLDivElement | null;
    const searchWrap = document.getElementById('all-layers-search') as HTMLLabelElement | null;
    const searchInput = document.getElementById('all-layers-search-input') as HTMLInputElement | null;
    if (!panel || !list)
        return;

    const layerNodeCount = appState.elements.length + appState.layerGroups.length;
    const searchEnabled = layerNodeCount >= LAYERS_SEARCH_MIN_COUNT;
    if (searchWrap)
        searchWrap.hidden = !searchEnabled;
    if (!searchEnabled && searchInput?.value)
        searchInput.value = '';
    if (searchInput && searchInput.dataset.layersSearchBound !== 'true') {
        searchInput.dataset.layersSearchBound = 'true';
        searchInput.addEventListener('input', () => refreshAllLayersPanelNow());
        searchInput.addEventListener('keydown', e => e.stopPropagation());
    }
    const query = searchEnabled ? (searchInput?.value.trim().toLocaleLowerCase() || '') : '';
    const reorderDisabledBySearch = !!query;
    const rows = buildLayerPanelRows(
        appState.elements,
        appState.layerGroups,
        appState.collapsedLayerGroupIds,
        query,
        el => `${elementTypeLabel(el)} ${getElementLayerName(el)}`,
    );
    const elementsById = new Map(appState.elements.map(el => [el.id, el]));
    const groupsById = new Map(appState.layerGroups.map(group => [group.id, group]));

    const elementRowHtml = (el: CanvasElement, depth: number) => `<div class="all-layer-row element${appState.selectedIds.includes(el.id) && !appState.selectedLayerGroupId ? ' selected' : ''}${el.locked ? ' locked' : ''}${el.hidden ? ' hidden' : ''}" data-layer-id="${el.id}" style="--layer-depth:${depth}">
    <button type="button" class="all-layer-reorder-handle" draggable="${el.locked || reorderDisabledBySearch ? 'false' : 'true'}" ${el.locked || reorderDisabledBySearch ? 'disabled' : ''} title="${el.locked ? 'Locked layer' : reorderDisabledBySearch ? 'Clear search to reorder layers' : 'Drag to reorder layer'}" aria-label="Reorder ${escapeHtml(getElementLayerName(el))}">
      <svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1.1"/><circle cx="9" cy="3" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="9" cy="8" r="1.1"/><circle cx="3" cy="13" r="1.1"/><circle cx="9" cy="13" r="1.1"/></svg>
    </button>
    <div class="all-layer-main" title="${el.hidden ? 'Hidden — show with the eye icon' : el.locked ? 'Locked — unlock with the lock icon' : `Select ${escapeHtml(getElementLayerName(el))}`}">
      <span class="all-layer-type">${escapeHtml(elementTypeLabel(el))}</span>
      <input class="all-layer-name" value="${escapeHtml(getElementLayerName(el))}" aria-label="Layer name for ${escapeHtml(getElementLayerName(el))}" readonly>
    </div>
    <button type="button" class="all-layer-visibility${el.hidden ? ' hidden' : ''}" title="${el.hidden ? 'Show' : 'Hide'} ${escapeHtml(getElementLayerName(el))}" aria-label="${el.hidden ? 'Show' : 'Hide'} ${escapeHtml(getElementLayerName(el))}" aria-pressed="${el.hidden ? 'false' : 'true'}">
      ${layerVisibilityIcon(!!el.hidden)}
    </button>
    <button type="button" class="all-layer-lock${el.locked ? ' active' : ''}" title="${el.locked ? 'Unlock' : 'Lock'} ${escapeHtml(getElementLayerName(el))}" aria-label="${el.locked ? 'Unlock' : 'Lock'} ${escapeHtml(getElementLayerName(el))}">
      ${layerLockIcon(!!el.locked)}
    </button>
  </div>`;

    const groupRowHtml = (group: LayerGroupNode, depth: number, descendantIds: string[]) => {
        const descendants = descendantIds.map(id => elementsById.get(id)).filter((el): el is CanvasElement => !!el);
        const allHidden = descendants.length > 0 && descendants.every(el => !!el.hidden);
        const someHidden = !allHidden && descendants.some(el => !!el.hidden);
        const allLocked = descendants.length > 0 && descendants.every(el => !!el.locked);
        const someLocked = !allLocked && descendants.some(el => !!el.locked);
        const collapsed = appState.collapsedLayerGroupIds.has(group.id) && !query;
        const selected = appState.selectedLayerGroupId === group.id;
        return `<div class="all-layer-row group${selected ? ' selected' : ''}${allLocked ? ' locked' : ''}${allHidden ? ' hidden' : ''}${someHidden ? ' mixed-hidden' : ''}${someLocked ? ' mixed-locked' : ''}" data-group-id="${group.id}" style="--layer-depth:${depth}">
    <button type="button" class="all-layer-group-toggle" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(group.name)}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(group.name)}">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 10 8l-4.5 4.5"/></svg>
    </button>
    <div class="all-layer-main" title="Select ${escapeHtml(group.name)}">
      <span class="all-layer-type">Group</span>
      <input class="all-layer-name" value="${escapeHtml(group.name)}" aria-label="Layer group name for ${escapeHtml(group.name)}" readonly>
    </div>
    <button type="button" class="all-layer-visibility${allHidden ? ' hidden' : ''}${someHidden ? ' mixed' : ''}" title="${allHidden ? 'Show' : 'Hide'} ${escapeHtml(group.name)}" aria-label="${allHidden ? 'Show' : 'Hide'} ${escapeHtml(group.name)}" aria-pressed="${allHidden ? 'false' : 'true'}">
      ${layerVisibilityIcon(allHidden)}
    </button>
    <button type="button" class="all-layer-lock${allLocked ? ' active' : ''}${someLocked ? ' mixed' : ''}" title="${allLocked ? 'Unlock' : 'Lock'} ${escapeHtml(group.name)}" aria-label="${allLocked ? 'Unlock' : 'Lock'} ${escapeHtml(group.name)}">
      ${layerLockIcon(allLocked)}
    </button>
  </div>`;
    };

    list.innerHTML = rows.length
        ? rows.map(row => {
            if (row.kind === 'element') {
                const el = elementsById.get(row.id);
                return el ? elementRowHtml(el, row.depth) : '';
            }
            const group = groupsById.get(row.id);
            return group ? groupRowHtml(group, row.depth, row.descendantElementIds) : '';
        }).join('')
        : layerNodeCount ? '<div class="all-layers-empty">No matching layers</div>' : '<div class="all-layers-empty">No layers yet</div>';

    // Keep selection feedback local to the existing DOM so clicking a row does not
    // replace its readonly input before the browser can deliver a double-click.
    const syncLayerSelectionClasses = () => {
        list.querySelectorAll<HTMLElement>('.all-layer-row').forEach(item => {
            const layerId = item.dataset.layerId;
            const groupId = item.dataset.groupId;
            const selected = groupId
                ? appState.selectedLayerGroupId === groupId
                : !!layerId && !appState.selectedLayerGroupId && appState.selectedIds.includes(layerId);
            item.classList.toggle('selected', selected);
        });
    };
    const finishSelectionUi = () => {
        setTool('select', { refreshLayers: false });
        redraw();
        updateTextStylePanel();
        syncLayerSelectionClasses();
        updateSelectedLockButton();
    };

    list.querySelectorAll<HTMLElement>('.all-layer-row.group').forEach(row => {
        const id = row.dataset.groupId;
        if (!id)
            return;
        const group = () => appState.layerGroups.find(item => item.id === id);
        const descendantIds = () => getDescendantElementIds(appState.elements, appState.layerGroups, id);
        const selectableIds = () => getSelectableDescendantIds(appState.elements, appState.layerGroups, id);
        const selectGroup = () => {
            if (!group())
                return;
            const ids = selectableIds();
            dispatch({ type: 'SET_SELECTION', ids, layerGroupId: id });
            finishSelectionUi();
        };
        row.querySelector<HTMLButtonElement>('.all-layer-group-toggle')?.addEventListener('click', e => {
            e.stopPropagation();
            const next = new Set(appState.collapsedLayerGroupIds);
            if (next.has(id)) next.delete(id); else next.add(id);
            dispatch({ type: 'SET_UI', patch: { collapsedLayerGroupIds: next } });
            refreshAllLayersPanelNow();
        });

        const main = row.querySelector('.all-layer-main') as HTMLElement | null;
        const input = row.querySelector('.all-layer-name') as HTMLInputElement | null;
        if (!input)
            return;
        let renameCancelled = false;
        let renameStart = '';
        const beginRename = () => {
            const current = group();
            if (!current)
                return;
            renameCancelled = false;
            renameStart = current.name;
            input.value = current.name;
            input.readOnly = false;
            row.classList.add('renaming');
            input.focus();
            input.select();
        };
        const finishRename = () => {
            const current = group();
            row.classList.remove('renaming');
            input.readOnly = true;
            if (!current)
                return;
            if (renameCancelled) {
                renameCancelled = false;
                input.value = current.name;
                return;
            }
            const next = input.value.trim() || current.name;
            if (next === renameStart || next === current.name) {
                input.value = current.name;
                return;
            }
            const before = beginHistoryTransaction();
            dispatch({ type: 'RENAME_LAYER_GROUP', id, name: next });
            saveToLocal();
            commitHistory(before);
            requestLayersPanelRefresh();
        };
        main?.addEventListener('click', e => {
            if (!(e.target as HTMLElement).closest('.all-layer-name')) selectGroup();
        });
        main?.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            beginRename();
        });
        input.addEventListener('click', e => {
            e.stopPropagation();
            if (input.readOnly) {
                selectGroup();
                input.blur();
            }
        });
        input.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            beginRename();
        });
        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            else if (e.key === 'Escape') {
                e.preventDefault();
                renameCancelled = true;
                input.value = renameStart || group()?.name || '';
                input.blur();
            }
        });
        row.addEventListener('contextmenu', e => {
            if (!input.readOnly && (e.target as HTMLElement).closest('.all-layer-name'))
                return;
            e.preventDefault();
            e.stopPropagation();
            selectGroup();
            showContextMenu(e.clientX, e.clientY);
        });
        row.querySelector<HTMLButtonElement>('.all-layer-visibility')?.addEventListener('click', e => {
            e.stopPropagation();
            const ids = descendantIds();
            const targets = appState.elements.filter(el => ids.includes(el.id));
            if (!targets.length)
                return;
            const allHidden = targets.every(el => !!el.hidden);
            toggleVisibilityForIds(ids, !allHidden);
        });
        row.querySelector<HTMLButtonElement>('.all-layer-lock')?.addEventListener('click', e => {
            e.stopPropagation();
            const ids = descendantIds();
            const targets = appState.elements.filter(el => ids.includes(el.id));
            if (!targets.length)
                return;
            const allLocked = targets.every(el => !!el.locked);
            toggleLockForIds(ids, !allLocked, true);
        });
    });

    list.querySelectorAll<HTMLElement>('.all-layer-row.element').forEach(row => {
        const id = row.dataset.layerId;
        if (!id)
            return;
        const layer = () => appState.elements.find(el => el.id === id);
        // A leaf row is an explicit drill-down surface. Canvas clicks keep selecting
        // the outermost group, while Layers lets the user address one child precisely.
        const selectLayer = () => {
            const el = layer();
            if (!el || el.locked || el.hidden)
                return;
            dispatch({ type: 'SET_SELECTION', ids: [id], layerGroupId: null });
            finishSelectionUi();
        };

        const main = row.querySelector('.all-layer-main') as HTMLElement | null;
        const input = row.querySelector('.all-layer-name') as HTMLInputElement | null;
        if (!input)
            return;
        let renameCancelled = false;
        let renameStartDisplay = '';
        const beginRename = () => {
            const el = layer();
            if (!el)
                return;
            renameCancelled = false;
            renameStartDisplay = getElementLayerName(el);
            input.value = renameStartDisplay;
            input.readOnly = false;
            row.classList.add('renaming');
            input.focus();
            input.select();
        };
        const finishRename = () => {
            const el = layer();
            row.classList.remove('renaming');
            input.readOnly = true;
            if (!el)
                return;
            if (renameCancelled) {
                renameCancelled = false;
                input.value = getElementLayerName(el);
                return;
            }
            const next = input.value.trim();
            if (next === renameStartDisplay) {
                input.value = getElementLayerName(el);
                return;
            }
            const nextName = next || undefined;
            const currentName = el.name?.trim() || undefined;
            if (currentName === nextName) {
                input.value = getElementLayerName(el);
                return;
            }
            const before = beginHistoryTransaction();
            dispatch({ type: 'RENAME_ELEMENT', id, name: nextName });
            saveToLocal();
            commitHistory(before);
            redraw();
            requestLayersPanelRefresh();
        };
        main?.addEventListener('click', e => {
            if (!(e.target as HTMLElement).closest('.all-layer-name')) selectLayer();
        });
        main?.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            beginRename();
        });
        input.addEventListener('click', e => {
            e.stopPropagation();
            if (input.readOnly) {
                selectLayer();
                input.blur();
            }
        });
        input.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            beginRename();
        });
        input.addEventListener('blur', finishRename);
        row.addEventListener('contextmenu', e => {
            if (!input.readOnly && (e.target as HTMLElement).closest('.all-layer-name'))
                return;
            e.preventDefault();
            e.stopPropagation();
            if (layer()?.hidden)
                return;
            selectLayer();
            showContextMenu(e.clientX, e.clientY);
        });
        input.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            else if (e.key === 'Escape') {
                e.preventDefault();
                renameCancelled = true;
                const current = layer();
                input.value = renameStartDisplay || (current ? getElementLayerName(current) : '');
                input.blur();
            }
        });
        row.querySelector<HTMLButtonElement>('.all-layer-visibility')?.addEventListener('click', e => {
            e.stopPropagation();
            const el = layer();
            if (el) toggleVisibilityForIds([id], !el.hidden);
        });
        row.querySelector<HTMLButtonElement>('.all-layer-lock')?.addEventListener('click', e => {
            e.stopPropagation();
            const el = layer();
            if (el) toggleLockForIds([id], !el.locked, true);
        });
    });

    updateSelectedLockButton();
    let draggingLayerId: string | null = null;
    list.querySelectorAll<HTMLButtonElement>('.all-layer-reorder-handle').forEach(handle => {
        handle.addEventListener('dragstart', e => {
            const row = handle.closest('.all-layer-row.element') as HTMLElement | null;
            const id = row?.dataset.layerId;
            if (!id)
                return;
            const layer = appState.elements.find(el => el.id === id);
            if (layer?.locked || reorderDisabledBySearch) {
                e.preventDefault();
                return;
            }
            draggingLayerId = id;
            handle.classList.add('dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
            }
        });
        handle.addEventListener('dragend', () => {
            draggingLayerId = null;
            list.querySelectorAll('.all-layer-row.is-drag-over, .all-layer-row.drop-before, .all-layer-row.drop-after').forEach(item => item.classList.remove('is-drag-over', 'drop-before', 'drop-after'));
            handle.classList.remove('dragging');
        });
    });
    // Group rows are intentionally not z-order drag targets in v11. Membership and
    // nesting are structural; canvas z-order is still the existing element array.
    list.querySelectorAll<HTMLElement>('.all-layer-row.element').forEach(row => {
        row.addEventListener('dragover', e => {
            if (!draggingLayerId || draggingLayerId === row.dataset.layerId)
                return;
            e.preventDefault();
            const rect = row.getBoundingClientRect();
            const before = e.clientY < rect.top + rect.height / 2;
            row.classList.toggle('drop-before', before);
            row.classList.toggle('drop-after', !before);
            row.classList.add('is-drag-over');
            if (e.dataTransfer)
                e.dataTransfer.dropEffect = 'move';
        });
        row.addEventListener('dragleave', e => {
            if (e.target === row || !row.contains(e.relatedTarget as Node | null))
                row.classList.remove('is-drag-over', 'drop-before', 'drop-after');
        });
        row.addEventListener('drop', e => {
            e.preventDefault();
            const sourceId = draggingLayerId || e.dataTransfer?.getData('text/plain');
            const targetId = row.dataset.layerId;
            const before = targetId ? e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 : true;
            row.classList.remove('is-drag-over', 'drop-before', 'drop-after');
            if (sourceId && targetId && sourceId !== targetId)
                reorderAllLayers(sourceId, targetId, before);
        });
    });
}

export function toggleAllLayersPanel() {
    const panel = document.getElementById('all-layers-panel') as HTMLDivElement | null;
    const btn = document.getElementById('btn-all-layers-toggle') as HTMLButtonElement | null;
    if (!panel || !btn)
        return;
    const collapsed = panel.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Expand layers panel' : 'Collapse layers panel');
    btn.setAttribute('title', collapsed ? 'Expand layers panel' : 'Collapse layers panel');
    btn.querySelector('.panel-toggle-chevron')?.classList.toggle('visible-when-expanded', !collapsed);
    btn.querySelector('.panel-collapsed-icon')?.classList.toggle('visible-when-collapsed', collapsed);
}

document.getElementById('btn-all-layers-toggle')?.addEventListener('click', e => { e.stopPropagation(); toggleAllLayersPanel(); });

export const initialLayersPanel = document.getElementById('all-layers-panel') as HTMLDivElement | null;

if (initialLayersPanel)
    enablePanelDrag(initialLayersPanel, initialLayersPanel.querySelector('#layers-drag') as HTMLElement);
