import type { CanvasElement, LayerGroupNode } from '../model/types';

export type LayerNodeRef = { kind: 'element' | 'group'; id: string };

export function nextLayerGroupName(groups: LayerGroupNode[]): string {
    let max = 0;
    for (const group of groups) {
        const match = group.name.match(/^Group\s+(\d+)$/i);
        if (match) max = Math.max(max, Number(match[1]));
    }
    return `Group ${max + 1}`;
}

function groupMap(groups: LayerGroupNode[]): Map<string, LayerGroupNode> {
    return new Map(groups.map(group => [group.id, group]));
}

export function getLayerGroup(groups: LayerGroupNode[], id: string | undefined | null): LayerGroupNode | undefined {
    return id ? groups.find(group => group.id === id) : undefined;
}

export function getDirectChildElements(elements: CanvasElement[], groupId: string): CanvasElement[] {
    return elements.filter(element => element.parentGroupId === groupId);
}

export function getDirectChildGroups(groups: LayerGroupNode[], groupId: string): LayerGroupNode[] {
    return groups.filter(group => group.parentGroupId === groupId);
}

export function getDescendantElementIds(elements: CanvasElement[], groups: LayerGroupNode[], groupId: string): string[] {
    const childrenByGroup = new Map<string, LayerGroupNode[]>();
    for (const group of groups) {
        if (!group.parentGroupId) continue;
        const list = childrenByGroup.get(group.parentGroupId) ?? [];
        list.push(group);
        childrenByGroup.set(group.parentGroupId, list);
    }
    const elementsByGroup = new Map<string, string[]>();
    for (const element of elements) {
        if (!element.parentGroupId) continue;
        const list = elementsByGroup.get(element.parentGroupId) ?? [];
        list.push(element.id);
        elementsByGroup.set(element.parentGroupId, list);
    }
    const result: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        result.push(...(elementsByGroup.get(id) ?? []));
        for (const child of childrenByGroup.get(id) ?? []) visit(child.id);
    };
    visit(groupId);
    return result;
}

export function getAncestorGroupIds(elements: CanvasElement[], groups: LayerGroupNode[], elementId: string): string[] {
    const element = elements.find(item => item.id === elementId);
    if (!element?.parentGroupId) return [];
    const byId = groupMap(groups);
    const ancestors: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = element.parentGroupId;
    while (current && !seen.has(current)) {
        const group = byId.get(current);
        if (!group) break;
        seen.add(current);
        ancestors.push(current);
        current = group.parentGroupId;
    }
    return ancestors;
}

export function getOutermostGroupIdForElement(elements: CanvasElement[], groups: LayerGroupNode[], elementId: string): string | null {
    const ancestors = getAncestorGroupIds(elements, groups, elementId);
    return ancestors.length ? ancestors[ancestors.length - 1]! : null;
}

export function getSelectableDescendantIds(elements: CanvasElement[], groups: LayerGroupNode[], groupId: string): string[] {
    const descendants = new Set(getDescendantElementIds(elements, groups, groupId));
    return elements.filter(element => descendants.has(element.id) && !element.locked && !element.hidden).map(element => element.id);
}

export function getSelectionClusterForElement(elements: CanvasElement[], groups: LayerGroupNode[], elementId: string): { ids: string[]; groupId: string | null } {
    const element = elements.find(item => item.id === elementId);
    if (!element || element.locked || element.hidden) return { ids: [], groupId: null };
    const outer = getOutermostGroupIdForElement(elements, groups, elementId);
    if (!outer) return { ids: [elementId], groupId: null };
    return { ids: getSelectableDescendantIds(elements, groups, outer), groupId: outer };
}

function parentForNode(elements: CanvasElement[], groups: LayerGroupNode[], node: LayerNodeRef): string | undefined {
    return node.kind === 'element'
        ? elements.find(element => element.id === node.id)?.parentGroupId
        : groups.find(group => group.id === node.id)?.parentGroupId;
}

function selectionRoots(elements: CanvasElement[], groups: LayerGroupNode[], selectedIds: string[]): LayerNodeRef[] {
    const selected = new Set(selectedIds.filter(id => elements.some(element => element.id === id)));
    const byId = groupMap(groups);
    const descendantCache = new Map<string, string[]>();
    const descendants = (groupId: string) => {
        const cached = descendantCache.get(groupId);
        if (cached) return cached;
        const next = getDescendantElementIds(elements, groups, groupId);
        descendantCache.set(groupId, next);
        return next;
    };
    const roots = new Map<string, LayerNodeRef>();
    for (const elementId of selected) {
        const element = elements.find(item => item.id === elementId);
        if (!element) continue;
        let node: LayerNodeRef = { kind: 'element', id: element.id };
        let parentId = element.parentGroupId;
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = byId.get(parentId);
            if (!parent) break;
            const descendantIds = descendants(parent.id);
            if (!descendantIds.length || !descendantIds.every(id => selected.has(id))) break;
            node = { kind: 'group', id: parent.id };
            parentId = parent.parentGroupId;
        }
        roots.set(`${node.kind}:${node.id}`, node);
    }
    return [...roots.values()];
}

export function canGroupLayerSelection(elements: CanvasElement[], groups: LayerGroupNode[], selectedIds: string[]): boolean {
    if (selectedIds.length < 2) return false;
    const roots = selectionRoots(elements, groups, selectedIds);
    if (roots.length < 2) return false;
    const parents = new Set(roots.map(node => parentForNode(elements, groups, node) ?? ''));
    return parents.size === 1;
}

export function groupLayerSelection(
    elements: CanvasElement[],
    groups: LayerGroupNode[],
    selectedIds: string[],
    group: LayerGroupNode,
): { elements: CanvasElement[]; groups: LayerGroupNode[]; changed: boolean } {
    const roots = selectionRoots(elements, groups, selectedIds);
    if (roots.length < 2) return { elements, groups, changed: false };
    const parentIds = new Set(roots.map(node => parentForNode(elements, groups, node) ?? ''));
    if (parentIds.size !== 1) return { elements, groups, changed: false };
    const parentGroupId = [...parentIds][0] || undefined;
    const rootElementIds = new Set(roots.filter(node => node.kind === 'element').map(node => node.id));
    const rootGroupIds = new Set(roots.filter(node => node.kind === 'group').map(node => node.id));
    const nextElements = elements.map(element => rootElementIds.has(element.id)
        ? { ...structuredClone(element), parentGroupId: group.id } as CanvasElement
        : element);
    const nextGroups = groups.map(item => rootGroupIds.has(item.id)
        ? { ...structuredClone(item), parentGroupId: group.id }
        : item);
    nextGroups.push({ ...structuredClone(group), parentGroupId });
    return { elements: nextElements, groups: nextGroups, changed: true };
}

function groupsForUngroupSelection(elements: CanvasElement[], groups: LayerGroupNode[], selectedIds: string[], preferredGroupId?: string | null): string[] {
    if (preferredGroupId && groups.some(group => group.id === preferredGroupId)) return [preferredGroupId];
    const roots = selectionRoots(elements, groups, selectedIds);
    const fullGroups = roots.filter(node => node.kind === 'group').map(node => node.id);
    if (fullGroups.length) return fullGroups;
    const selected = new Set(selectedIds);
    const directParents = new Set<string>();
    for (const element of elements) {
        if (selected.has(element.id) && element.parentGroupId) directParents.add(element.parentGroupId);
    }
    return [...directParents];
}

export function selectionHasLayerGroup(elements: CanvasElement[], groups: LayerGroupNode[], selectedIds: string[], preferredGroupId?: string | null): boolean {
    return groupsForUngroupSelection(elements, groups, selectedIds, preferredGroupId).length > 0;
}

export function cleanupEmptyLayerGroups(elements: CanvasElement[], groups: LayerGroupNode[]): LayerGroupNode[] {
    let next = groups.map(group => structuredClone(group));
    let changed = true;
    while (changed) {
        changed = false;
        const ids = new Set(next.map(group => group.id));
        const nonEmpty = new Set<string>();
        for (const element of elements) if (element.parentGroupId && ids.has(element.parentGroupId)) nonEmpty.add(element.parentGroupId);
        for (const group of next) if (group.parentGroupId && ids.has(group.parentGroupId)) nonEmpty.add(group.parentGroupId);
        const filtered = next.filter(group => nonEmpty.has(group.id));
        if (filtered.length !== next.length) {
            const kept = new Set(filtered.map(group => group.id));
            next = filtered.map(group => group.parentGroupId && !kept.has(group.parentGroupId)
                ? { ...group, parentGroupId: undefined }
                : group);
            changed = true;
        }
    }
    return next;
}

export function ungroupLayerSelection(
    elements: CanvasElement[],
    groups: LayerGroupNode[],
    selectedIds: string[],
    preferredGroupId?: string | null,
): { elements: CanvasElement[]; groups: LayerGroupNode[]; changed: boolean } {
    // An exact group selection (for example from a Layers group row or a canvas
    // outer-group click) means structurally ungroup that node, including hidden
    // descendants. The UI blocks this action when any descendant is locked.
    const selected = new Set(preferredGroupId
        ? getDescendantElementIds(elements, groups, preferredGroupId)
        : selectedIds);
    const targets = groupsForUngroupSelection(elements, groups, selectedIds, preferredGroupId);
    if (!targets.length) return { elements, groups, changed: false };
    let nextElements = elements;
    let nextGroups = groups.map(group => structuredClone(group));
    let changed = false;

    for (const targetId of targets) {
        const target = nextGroups.find(group => group.id === targetId);
        if (!target) continue;
        const parentGroupId = target.parentGroupId;
        const fullySelectedChildGroups = new Set(
            nextGroups
                .filter(group => group.parentGroupId === targetId)
                .filter(group => {
                    const descendants = getDescendantElementIds(nextElements, nextGroups, group.id);
                    return descendants.length > 0 && descendants.every(id => selected.has(id));
                })
                .map(group => group.id),
        );
        nextElements = nextElements.map(element => element.parentGroupId === targetId && selected.has(element.id)
            ? { ...structuredClone(element), parentGroupId } as CanvasElement
            : element);
        nextGroups = nextGroups.map(group => fullySelectedChildGroups.has(group.id)
            ? { ...group, parentGroupId }
            : group);
        changed = true;
    }

    const cleaned = cleanupEmptyLayerGroups(nextElements, nextGroups);
    return { elements: nextElements, groups: cleaned, changed };
}

export function normalizeLayerHierarchy(elements: CanvasElement[], rawGroups: LayerGroupNode[]): { elements: CanvasElement[]; groups: LayerGroupNode[] } {
    const groups: LayerGroupNode[] = [];
    const seen = new Set<string>();
    for (const raw of rawGroups) {
        const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        groups.push({
            id,
            name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Group',
            ...(typeof raw.parentGroupId === 'string' && raw.parentGroupId.trim() ? { parentGroupId: raw.parentGroupId.trim() } : {}),
        });
    }
    const ids = new Set(groups.map(group => group.id));
    const byId = groupMap(groups);
    const safeParent = (id: string, candidate?: string): string | undefined => {
        if (!candidate || candidate === id || !ids.has(candidate)) return undefined;
        const visited = new Set([id]);
        let current: string | undefined = candidate;
        while (current) {
            if (visited.has(current)) return undefined;
            visited.add(current);
            current = byId.get(current)?.parentGroupId;
        }
        return candidate;
    };
    const normalizedGroups = groups.map(group => ({ ...group, parentGroupId: safeParent(group.id, group.parentGroupId) }));
    const validIds = new Set(normalizedGroups.map(group => group.id));
    const normalizedElements = elements.map(element => {
        const parentGroupId = typeof element.parentGroupId === 'string' && validIds.has(element.parentGroupId) ? element.parentGroupId : undefined;
        if (parentGroupId === element.parentGroupId) return element;
        const next = structuredClone(element) as CanvasElement;
        next.parentGroupId = parentGroupId;
        return next;
    });
    return { elements: normalizedElements, groups: cleanupEmptyLayerGroups(normalizedElements, normalizedGroups) };
}

export function groupsFullyContainedBySelection(elements: CanvasElement[], groups: LayerGroupNode[], selectedIds: string[]): LayerGroupNode[] {
    const selected = new Set(selectedIds);
    return groups.filter(group => {
        const descendants = getDescendantElementIds(elements, groups, group.id);
        return descendants.length > 0 && descendants.every(id => selected.has(id));
    });
}


export type LayerPanelRow =
    | { kind: 'element'; id: string; depth: number }
    | { kind: 'group'; id: string; depth: number; descendantElementIds: string[] };

export function buildLayerPanelRows(
    elements: CanvasElement[],
    groups: LayerGroupNode[],
    collapsedGroupIds: ReadonlySet<string>,
    query = '',
    elementSearchText: (element: CanvasElement) => string = element => `${element.type} ${element.name ?? ''}`,
): LayerPanelRow[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const elementById = new Map(elements.map(element => [element.id, element]));
    const groupById = new Map(groups.map(group => [group.id, group]));
    const zRank = new Map(elements.map((element, index) => [element.id, index]));
    const directElements = new Map<string, string[]>();
    const directGroups = new Map<string, string[]>();
    const ROOT = '';

    for (const element of elements) {
        const parent = element.parentGroupId && groupById.has(element.parentGroupId) ? element.parentGroupId : ROOT;
        const list = directElements.get(parent) ?? [];
        list.push(element.id);
        directElements.set(parent, list);
    }
    for (const group of groups) {
        const parent = group.parentGroupId && groupById.has(group.parentGroupId) ? group.parentGroupId : ROOT;
        const list = directGroups.get(parent) ?? [];
        list.push(group.id);
        directGroups.set(parent, list);
    }

    const descendantMemo = new Map<string, string[]>();
    const descendants = (groupId: string, visiting = new Set<string>()): string[] => {
        const memo = descendantMemo.get(groupId);
        if (memo) return memo;
        if (visiting.has(groupId)) return [];
        const nextVisiting = new Set(visiting).add(groupId);
        const ids = [...(directElements.get(groupId) ?? [])];
        for (const childId of directGroups.get(groupId) ?? []) ids.push(...descendants(childId, nextVisiting));
        descendantMemo.set(groupId, ids);
        return ids;
    };

    const rankMemo = new Map<string, number>();
    const groupRank = (groupId: string): number => {
        const memo = rankMemo.get(groupId);
        if (memo !== undefined) return memo;
        const ids = descendants(groupId);
        const rank = ids.reduce((max, id) => Math.max(max, zRank.get(id) ?? -1), -1);
        rankMemo.set(groupId, rank);
        return rank;
    };

    const elementMatches = (id: string) => {
        if (!normalizedQuery) return true;
        const element = elementById.get(id);
        return !!element && elementSearchText(element).toLocaleLowerCase().includes(normalizedQuery);
    };
    const groupMatchMemo = new Map<string, boolean>();
    const groupMatches = (groupId: string, visiting = new Set<string>()): boolean => {
        if (!normalizedQuery) return true;
        const memo = groupMatchMemo.get(groupId);
        if (memo !== undefined) return memo;
        if (visiting.has(groupId)) return false;
        const group = groupById.get(groupId);
        if (!group) return false;
        const own = `group ${group.name}`.toLocaleLowerCase().includes(normalizedQuery);
        if (own) {
            groupMatchMemo.set(groupId, true);
            return true;
        }
        const nextVisiting = new Set(visiting).add(groupId);
        const match = (directElements.get(groupId) ?? []).some(elementMatches)
            || (directGroups.get(groupId) ?? []).some(childId => groupMatches(childId, nextVisiting));
        groupMatchMemo.set(groupId, match);
        return match;
    };

    type SortableNode = { kind: 'element' | 'group'; id: string; rank: number };
    const childNodes = (parentId: string): SortableNode[] => [
        ...(directElements.get(parentId) ?? []).map(id => ({ kind: 'element' as const, id, rank: zRank.get(id) ?? -1 })),
        ...(directGroups.get(parentId) ?? []).map(id => ({ kind: 'group' as const, id, rank: groupRank(id) })),
    ].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));

    const rows: LayerPanelRow[] = [];
    const visit = (parentId: string, depth: number, forceShowAll = false) => {
        for (const node of childNodes(parentId)) {
            if (node.kind === 'element') {
                if (forceShowAll || elementMatches(node.id)) rows.push({ kind: 'element', id: node.id, depth });
                continue;
            }
            const group = groupById.get(node.id);
            if (!group) continue;
            const ownMatches = normalizedQuery && `group ${group.name}`.toLocaleLowerCase().includes(normalizedQuery);
            if (!forceShowAll && !groupMatches(node.id)) continue;
            rows.push({ kind: 'group', id: node.id, depth, descendantElementIds: descendants(node.id) });
            // Searching temporarily expands matching branches without mutating the user's collapse state.
            if (normalizedQuery || !collapsedGroupIds.has(node.id)) visit(node.id, depth + 1, forceShowAll || !!ownMatches);
        }
    };
    visit(ROOT, 0);
    return rows;
}
