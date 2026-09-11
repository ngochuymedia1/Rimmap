import type {
    CanvasElement,
    ElementPropertyPatch,
    HistoryElementPatch,
    HistoryEntry,
    HistoryIndexedElement,
    LayerGroupNode,
} from '../model/types';

export interface HistoryElementVersion {
    element: CanvasElement | null;
    index: number;
}

export interface HistoryEntryBuildInput {
    id: number;
    before: Map<string, HistoryElementVersion>;
    after: Map<string, HistoryElementVersion>;
    orderTouched: boolean;
    orderBefore?: string[];
    orderAfter?: string[];
    layerGroupsTouched?: boolean;
    layerGroupsBefore?: LayerGroupNode[];
    layerGroupsAfter?: LayerGroupNode[];
}

export function historyValueEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!historyValueEqual(a[i], b[i])) return false;
        return true;
    }
    if (typeof a === 'object') {
        if (Array.isArray(b)) return false;
        const aa = a as Record<string, unknown>;
        const bb = b as Record<string, unknown>;
        const aKeys = Object.keys(aa);
        const bKeys = Object.keys(bb);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(bb, key) || !historyValueEqual(aa[key], bb[key])) return false;
        }
        return true;
    }
    return false;
}

export function diffHistoryElement(before: CanvasElement, after: CanvasElement): HistoryElementPatch | null {
    const beforeRecord = before as unknown as Record<string, unknown>;
    const afterRecord = after as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    const beforePatch: ElementPropertyPatch = {};
    const afterPatch: ElementPropertyPatch = {};
    let changed = false;

    for (const key of keys) {
        if (key === 'id') continue;
        const a = beforeRecord[key];
        const b = afterRecord[key];
        if (historyValueEqual(a, b)) continue;
        beforePatch[key] = a;
        afterPatch[key] = b;
        changed = true;
    }

    return changed ? { id: before.id, before: beforePatch, after: afterPatch } : null;
}

function sameOrder(a?: string[], b?: string[]): boolean {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export function buildPatchHistoryEntry(input: HistoryEntryBuildInput): HistoryEntry | null {
    const patches: HistoryElementPatch[] = [];
    const inserted: HistoryIndexedElement[] = [];
    const removed: HistoryIndexedElement[] = [];
    const ids = new Set([...input.before.keys(), ...input.after.keys()]);

    for (const id of ids) {
        const before = input.before.get(id) ?? { element: null, index: -1 };
        const after = input.after.get(id) ?? { element: null, index: -1 };
        if (!before.element && after.element) {
            inserted.push({ index: after.index, element: after.element });
            continue;
        }
        if (before.element && !after.element) {
            removed.push({ index: before.index, element: before.element });
            continue;
        }
        if (before.element && after.element) {
            const patch = diffHistoryElement(before.element, after.element);
            if (patch) patches.push(patch);
        }
    }

    const orderChanged = input.orderTouched && input.orderBefore && input.orderAfter && !sameOrder(input.orderBefore, input.orderAfter);
    const layerGroupsChanged = !!input.layerGroupsTouched && !!input.layerGroupsBefore && !!input.layerGroupsAfter && !historyValueEqual(input.layerGroupsBefore, input.layerGroupsAfter);
    if (!patches.length && !inserted.length && !removed.length && !orderChanged && !layerGroupsChanged) return null;

    return {
        id: input.id,
        patches,
        inserted,
        removed,
        ...(orderChanged ? { orderBefore: input.orderBefore, orderAfter: input.orderAfter } : {}),
        ...(layerGroupsChanged ? { layerGroupsBefore: input.layerGroupsBefore, layerGroupsAfter: input.layerGroupsAfter } : {}),
    };
}
