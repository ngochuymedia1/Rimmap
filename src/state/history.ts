import { requestLayersPanelRefresh } from '../layers/index';
import type {
    CanvasElement,
    HistoryEntry,
    HistoryIndexedElement,
    HistoryTransactionToken,
    LayerGroupNode,
} from '../model/types';
import { buildPatchHistoryEntry, type HistoryElementVersion } from './history-core';
import { hydrateMediaElements, saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { appState, dispatch, store, type AppAction, type AppState } from './store';
import { closeTextEditor } from '../text-editor/index';

export const HISTORY_LIMIT = 100;

interface WorkingHistoryTransaction {
    token: HistoryTransactionToken;
    before: Map<string, HistoryElementVersion>;
    orderBefore?: string[];
    orderTouched: boolean;
    layerGroupsBefore?: LayerGroupNode[];
    layerGroupsTouched: boolean;
}

let nextTransactionId = 1;
let nextHistoryEntryId = 1;
let activeTransaction: WorkingHistoryTransaction | null = null;

function documentIdsForAction(action: AppAction, state: Readonly<AppState>): string[] {
    switch (action.type) {
        case 'ADD_ELEMENT':
        case 'INSERT_ELEMENT_AT':
            return [action.element.id];
        case 'ADD_ELEMENTS':
            return action.elements.map(element => element.id);
        case 'CREATE_ARROW':
            return [action.arrow.id];
        case 'APPEND_FREEHAND_POINT':
        case 'UPDATE_ELEMENT':
        case 'APPLY_ELEMENT_PATCH':
        case 'RENAME_ELEMENT':
            return [action.id];
        case 'DELETE_ELEMENTS':
        case 'MOVE_ELEMENTS':
        case 'LOCK_ELEMENTS':
        case 'SET_ELEMENTS_HIDDEN':
        case 'GROUP_LAYER_SELECTION':
        case 'UNGROUP_LAYER_SELECTION':
        case 'UPDATE_STYLE':
        case 'UPDATE_ELEMENTS':
            return action.ids;
        case 'REPLACE_ELEMENTS':
        case 'REPLACE_DOCUMENT': {
            const ids = new Set(state.elements.map(element => element.id));
            for (const element of action.elements) ids.add(element.id);
            return [...ids];
        }
        default:
            return [];
    }
}

function actionChangesOrder(action: AppAction): boolean {
    return action.type === 'REORDER_ELEMENTS' || action.type === 'REORDER_BY_IDS';
}

function actionChangesLayerGroups(action: AppAction): boolean {
    return action.type === 'REPLACE_ELEMENTS'
        || action.type === 'REPLACE_DOCUMENT'
        || action.type === 'DELETE_ELEMENTS'
        || action.type === 'ADD_LAYER_GROUPS'
        || action.type === 'REPLACE_LAYER_GROUPS'
        || action.type === 'GROUP_LAYER_SELECTION'
        || action.type === 'UNGROUP_LAYER_SELECTION'
        || action.type === 'RENAME_LAYER_GROUP';
}

function captureVersions(target: Map<string, HistoryElementVersion>, ids: string[], state: Readonly<AppState>) {
    if (!ids.length) return;
    const wanted = new Set(ids);
    const found = new Set<string>();
    state.elements.forEach((element, index) => {
        if (!wanted.has(element.id)) return;
        target.set(element.id, { element, index });
        found.add(element.id);
    });
    for (const id of wanted) {
        if (!found.has(id)) target.set(id, { element: null, index: -1 });
    }
}

store.subscribeBefore((state, action) => {
    const tx = activeTransaction;
    if (!tx) return;

    if (actionChangesOrder(action) && !tx.orderTouched) {
        tx.orderTouched = true;
        tx.orderBefore = state.elements.map(element => element.id);
    }
    if (actionChangesLayerGroups(action) && !tx.layerGroupsTouched) {
        tx.layerGroupsTouched = true;
        tx.layerGroupsBefore = state.layerGroups as LayerGroupNode[];
    }

    const ids = documentIdsForAction(action, state);
    if (!ids.length) return;
    const uncaptured = ids.filter(id => !tx.before.has(id));
    captureVersions(tx.before, uncaptured, state);
});

/**
 * Starts one Undo/Redo transaction without cloning the document. Store actions
 * record only the IDs they touch; the final history entry is built from those
 * changed elements/fields when commitHistory() is called.
 */
export function beginHistoryTransaction(): HistoryTransactionToken {
    // A new explicit user operation supersedes an abandoned transaction (for
    // example a pointer gesture that turned into text editing). This mirrors the
    // old behavior where its unused snapshot was simply discarded.
    if (activeTransaction) activeTransaction = null;
    const token: HistoryTransactionToken = Object.freeze({ id: nextTransactionId++ });
    activeTransaction = {
        token,
        before: new Map(),
        orderTouched: false,
        layerGroupsTouched: false,
    };
    return token;
}

export function cancelHistoryTransaction(token: HistoryTransactionToken | null | undefined) {
    if (token && activeTransaction?.token.id === token.id) activeTransaction = null;
}

export function updateHistoryButtons() {
    const undo = document.getElementById('btn-undo') as HTMLButtonElement | null;
    const redo = document.getElementById('btn-redo') as HTMLButtonElement | null;
    if (undo) undo.disabled = appState.historyPast.length === 0;
    if (redo) redo.disabled = appState.historyFuture.length === 0;
}

export function commitHistory(token: HistoryTransactionToken | null) {
    if (!token || !activeTransaction || activeTransaction.token.id !== token.id) {
        updateHistoryButtons();
        return;
    }
    const tx = activeTransaction;
    activeTransaction = null;
    // Capture final versions once at commit. High-frequency pointer updates can
    // dispatch dozens of UPDATE_ELEMENT actions, but history pays only one final
    // document scan instead of rescanning the board on every mousemove.
    const after = new Map<string, HistoryElementVersion>();
    captureVersions(after, [...tx.before.keys()], appState);
    const entry = buildPatchHistoryEntry({
        id: nextHistoryEntryId++,
        before: tx.before,
        after,
        orderTouched: tx.orderTouched,
        orderBefore: tx.orderBefore,
        orderAfter: tx.orderTouched ? appState.elements.map(element => element.id) : undefined,
        layerGroupsTouched: tx.layerGroupsTouched,
        layerGroupsBefore: tx.layerGroupsBefore,
        layerGroupsAfter: tx.layerGroupsTouched ? appState.layerGroups as LayerGroupNode[] : undefined,
    });
    if (!entry) {
        updateHistoryButtons();
        return;
    }
    const historyPast = [...appState.historyPast, entry].slice(-HISTORY_LIMIT);
    dispatch({ type: 'SET_HISTORY', patch: { historyPast, historyFuture: [] } });
    updateHistoryButtons();
}

function insertIndexed(elements: HistoryIndexedElement[]) {
    for (const item of [...elements].sort((a, b) => a.index - b.index)) {
        dispatch({ type: 'INSERT_ELEMENT_AT', index: item.index, element: item.element });
    }
}

function applyEntry(entry: HistoryEntry, direction: 'undo' | 'redo') {
    if (direction === 'undo') {
        if (entry.inserted.length) dispatch({ type: 'DELETE_ELEMENTS', ids: entry.inserted.map(item => item.element.id), preserveSelection: true });
        insertIndexed(entry.removed);
        for (const patch of entry.patches) dispatch({ type: 'APPLY_ELEMENT_PATCH', id: patch.id, patch: patch.before });
        if (entry.orderBefore) dispatch({ type: 'REORDER_BY_IDS', order: entry.orderBefore });
        if (entry.layerGroupsBefore) dispatch({ type: 'REPLACE_LAYER_GROUPS', groups: entry.layerGroupsBefore });
        return;
    }

    if (entry.removed.length) dispatch({ type: 'DELETE_ELEMENTS', ids: entry.removed.map(item => item.element.id), preserveSelection: true });
    insertIndexed(entry.inserted);
    for (const patch of entry.patches) dispatch({ type: 'APPLY_ELEMENT_PATCH', id: patch.id, patch: patch.after });
    if (entry.orderAfter) dispatch({ type: 'REORDER_BY_IDS', order: entry.orderAfter });
    if (entry.layerGroupsAfter) dispatch({ type: 'REPLACE_LAYER_GROUPS', groups: entry.layerGroupsAfter });
}

function afterHistoryNavigation() {
    dispatch({ type: 'SET_SELECTION', ids: [] });
    requestLayersPanelRefresh();
    hydrateMediaElements();
    saveToLocal();
    updateHistoryButtons();
    redraw();
}

export function undo() {
    if (appState.textEditor) closeTextEditor(true);
    if (!appState.historyPast.length) return;
    const entry = appState.historyPast[appState.historyPast.length - 1]!;
    activeTransaction = null;
    applyEntry(entry, 'undo');
    dispatch({
        type: 'SET_HISTORY',
        patch: {
            historyPast: appState.historyPast.slice(0, -1),
            historyFuture: [...appState.historyFuture, entry],
            pendingHistoryBefore: null,
        },
    });
    afterHistoryNavigation();
}

export function redo() {
    if (appState.textEditor) closeTextEditor(true);
    if (!appState.historyFuture.length) return;
    const entry = appState.historyFuture[appState.historyFuture.length - 1]!;
    activeTransaction = null;
    applyEntry(entry, 'redo');
    dispatch({
        type: 'SET_HISTORY',
        patch: {
            historyPast: [...appState.historyPast, entry].slice(-HISTORY_LIMIT),
            historyFuture: appState.historyFuture.slice(0, -1),
            pendingHistoryBefore: null,
        },
    });
    afterHistoryNavigation();
}
