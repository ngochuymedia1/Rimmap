import type { AppAction } from '../state/store';
import { appState, store } from '../state/store';
import type { ArrowElement, Bounds, CanvasElement } from '../model/types';
import { SpatialBucketIndex } from './spatial-index';
import { measurePerformance } from './instrumentation';

export const SCENE_SPATIAL_INDEX_THRESHOLD = 180;
export const SCENE_SPATIAL_CELL_SIZE = 320;

type BoundsResolver = (element: CanvasElement) => Bounds;

const index = new SpatialBucketIndex(SCENE_SPATIAL_CELL_SIZE);
const dirtyIds = new Set<string>();
const volatileArrowIds = new Set<string>();
const zIndexById = new Map<string, number>();
const bindingDependents = new Map<string, Set<string>>();
const arrowBindings = new Map<string, string[]>();
let fullRebuildNeeded = true;
let orderDirty = true;
let geometryGeneration = 1;
let lastEditingTextId: string | null = null;
let lastCandidateCount = 0;
let lastQueryUsedIndex = false;
let dependencyGraphDirty = true;

function isArrow(element: CanvasElement): element is ArrowElement { return element.type === 'arrow' || element.type === 'connector'; }
function isVolatileAutoArrow(element: CanvasElement): boolean {
  return isArrow(element) && element.arrowMode !== 'branches' && element.routingMode === 'auto';
}

function collectArrowBindings(element: CanvasElement): string[] {
  if (!isArrow(element)) return [];
  const ids = new Set<string>();
  if (element.startBinding) ids.add(element.startBinding);
  if (element.endBinding) ids.add(element.endBinding);
  for (const branch of element.branches || []) if (branch.endBinding) ids.add(branch.endBinding);
  return [...ids];
}

function rebuildDependencyGraph(): void {
  bindingDependents.clear();
  arrowBindings.clear();
  for (const element of appState.elements) updateArrowDependencies(element);
  dependencyGraphDirty = false;
}

function ensureDependencyGraph(): void {
  if (dependencyGraphDirty) rebuildDependencyGraph();
}

function removeArrowDependencies(id: string): void {
  const previous = arrowBindings.get(id) || [];
  for (const targetId of previous) {
    const set = bindingDependents.get(targetId);
    if (!set) continue;
    set.delete(id);
    if (!set.size) bindingDependents.delete(targetId);
  }
  arrowBindings.delete(id);
}

function updateArrowDependencies(element: CanvasElement): void {
  removeArrowDependencies(element.id);
  if (!isArrow(element)) return;
  const bindings = collectArrowBindings(element);
  arrowBindings.set(element.id, bindings);
  for (const targetId of bindings) {
    let set = bindingDependents.get(targetId);
    if (!set) {
      set = new Set<string>();
      bindingDependents.set(targetId, set);
    }
    set.add(element.id);
  }
}

function markDirty(ids: Iterable<string>, incrementsGeometry = true): void {
  for (const id of ids) {
    dirtyIds.add(id);
    for (const dependent of bindingDependents.get(id) || []) dirtyIds.add(dependent);
  }
  if (incrementsGeometry) geometryGeneration++;
}

function geometryStylePatch(action: Extract<AppAction, { type: 'UPDATE_STYLE' }>): boolean {
  const keys = Object.keys(action.patch);
  return keys.some(key => key === 'fontSize' || key === 'textScale' || key === 'fontFamily' || key === 'curveMode' || key === 'routingMode' || key === 'thickness');
}

function refreshDependenciesForIds(ids: Iterable<string>): void {
  if (dependencyGraphDirty) return;
  if (orderDirty || zIndexById.size !== appState.elements.length) refreshOrder();
  for (const id of ids) {
    const element = elementForId(id);
    if (element) updateArrowDependencies(element);
    else removeArrowDependencies(id);
  }
}

function onStoreAction(action: AppAction): void {
  switch (action.type) {
    case 'REPLACE_DOCUMENT':
    case 'REPLACE_ELEMENTS':
      fullRebuildNeeded = true;
      orderDirty = true;
      dependencyGraphDirty = true;
      geometryGeneration++;
      dirtyIds.clear();
      return;
    case 'ADD_ELEMENT':
      markDirty([action.element.id]); orderDirty = true; refreshDependenciesForIds([action.element.id]); return;
    case 'ADD_ELEMENTS':
      markDirty(action.elements.map(element => element.id)); orderDirty = true; refreshDependenciesForIds(action.elements.map(element => element.id)); return;
    case 'CREATE_ARROW':
      markDirty([action.arrow.id]); orderDirty = true; refreshDependenciesForIds([action.arrow.id]); return;
    case 'INSERT_ELEMENT_AT':
      markDirty([action.element.id]); orderDirty = true; refreshDependenciesForIds([action.element.id]); return;
    case 'DELETE_ELEMENTS':
      markDirty(action.ids); orderDirty = true;
      if (!dependencyGraphDirty) for (const id of action.ids) removeArrowDependencies(id);
      return;
    case 'APPEND_FREEHAND_POINT':
      markDirty([action.id]); return;
    case 'MOVE_ELEMENTS':
      markDirty(action.ids);
      if (action.detachBindings) refreshDependenciesForIds(action.ids);
      return;
    case 'SET_ELEMENTS_HIDDEN':
      // The grid can keep hidden entries, but Auto routes/label obstacles depend
      // on visibility, so geometry-derived caches still get a new generation.
      geometryGeneration++;
      return;
    case 'UPDATE_STYLE':
      if (geometryStylePatch(action)) markDirty(action.ids);
      return;
    case 'UPDATE_ELEMENT':
      markDirty([action.id]); refreshDependenciesForIds([action.id]); return;
    case 'UPDATE_ELEMENTS':
      markDirty(action.ids); refreshDependenciesForIds(action.ids); return;
    case 'APPLY_ELEMENT_PATCH':
      markDirty([action.id]); refreshDependenciesForIds([action.id]); return;
    case 'REORDER_ELEMENTS':
    case 'REORDER_BY_IDS':
      orderDirty = true; return;
    case 'GROUP_LAYER_SELECTION':
    case 'UNGROUP_LAYER_SELECTION':
      // Grouping clones element records but does not alter geometry or z-order.
      return;
    case 'SET_EDITOR': {
      const touchesLiveBounds = Object.prototype.hasOwnProperty.call(action.patch, 'liveTextEditorBounds') || Object.prototype.hasOwnProperty.call(action.patch, 'editingTextId');
      if (!touchesLiveBounds) return;
      const ids = new Set<string>();
      if (lastEditingTextId) ids.add(lastEditingTextId);
      if (appState.editingTextId) ids.add(appState.editingTextId);
      lastEditingTextId = appState.editingTextId;
      if (ids.size) markDirty(ids);
      return;
    }
    default:
      return;
  }
}

store.subscribe((_state, action) => onStoreAction(action));

function refreshOrder(): void {
  zIndexById.clear();
  appState.elements.forEach((element, indexInScene) => zIndexById.set(element.id, indexInScene));
  orderDirty = false;
}

function elementForId(id: string): CanvasElement | undefined {
  const position = zIndexById.get(id);
  if (position === undefined) return undefined;
  const element = appState.elements[position];
  return element?.id === id ? element : undefined;
}

function rebuild(resolveBounds: BoundsResolver): void {
  index.clear();
  volatileArrowIds.clear();
  bindingDependents.clear();
  arrowBindings.clear();
  refreshOrder();
  for (const element of appState.elements) {
    updateArrowDependencies(element);
    if (isVolatileAutoArrow(element)) volatileArrowIds.add(element.id);
    else index.upsert(element.id, resolveBounds(element));
  }
  dirtyIds.clear();
  dependencyGraphDirty = false;
  fullRebuildNeeded = false;
}

function flushDirty(resolveBounds: BoundsResolver): void {
  if (fullRebuildNeeded) {
    rebuild(resolveBounds);
    return;
  }
  if (orderDirty) refreshOrder();
  if (!dirtyIds.size) return;

  // A changed bound target changes the spatial envelope of every manually-bound
  // connector that points at it. Expand once before processing.
  for (const id of [...dirtyIds]) for (const dependent of bindingDependents.get(id) || []) dirtyIds.add(dependent);

  for (const id of [...dirtyIds]) {
    const element = elementForId(id);
    if (!element) {
      index.remove(id);
      volatileArrowIds.delete(id);
      removeArrowDependencies(id);
      continue;
    }
    updateArrowDependencies(element);
    if (isVolatileAutoArrow(element)) {
      index.remove(id);
      volatileArrowIds.add(id);
    } else {
      volatileArrowIds.delete(id);
      index.upsert(id, resolveBounds(element));
    }
  }
  dirtyIds.clear();
}

/**
 * Returns scene candidates in the exact same bottom-to-top z-order as
 * appState.elements. Small boards intentionally keep the old linear path.
 */
export function querySceneElements(bounds: Bounds, resolveBounds: BoundsResolver, options: { includeVolatileAutoArrows?: boolean } = {}): CanvasElement[] {
  return measurePerformance('spatialQuery', () => {
    if (appState.elements.length < SCENE_SPATIAL_INDEX_THRESHOLD) {
      lastQueryUsedIndex = false;
      lastCandidateCount = appState.elements.length;
      return appState.elements as CanvasElement[];
    }
    flushDirty(resolveBounds);
    const ids = index.query(bounds);
    if (options.includeVolatileAutoArrows !== false) for (const id of volatileArrowIds) ids.add(id);
    const ordered = [...ids]
      .map(id => ({ id, z: zIndexById.get(id) ?? -1 }))
      .filter(item => item.z >= 0)
      .sort((a, b) => a.z - b.z)
      .map(item => appState.elements[item.z])
      .filter((element): element is CanvasElement => !!element);
    lastQueryUsedIndex = true;
    lastCandidateCount = ordered.length;
    return ordered;
  });
}

/** O(1) lookup after a single lazy z-order projection refresh. */
export function getSceneElementById(id: string): CanvasElement | undefined {
  if (orderDirty || zIndexById.size !== appState.elements.length) refreshOrder();
  return elementForId(id);
}

/** Connector IDs whose bindings depend on any of the supplied element IDs. */
export function getConnectedArrowIdsForElementIds(ids: Iterable<string>): Set<string> {
  ensureDependencyGraph();
  const out = new Set<string>();
  for (const id of ids) for (const arrowId of bindingDependents.get(id) || []) out.add(arrowId);
  return out;
}

export function getSceneGeometryGeneration(): number { return geometryGeneration; }

export function invalidateSceneSpatialIndexGeometry(): void {
  geometryGeneration++;
  fullRebuildNeeded = true;
  dirtyIds.clear();
}

export function getSceneSpatialIndexStats() {
  return {
    enabled: appState.elements.length >= SCENE_SPATIAL_INDEX_THRESHOLD,
    threshold: SCENE_SPATIAL_INDEX_THRESHOLD,
    geometryGeneration,
    lastQueryUsedIndex,
    lastCandidateCount,
    volatileArrowCount: volatileArrowIds.size,
    ...index.stats(),
  };
}

export function resetSceneSpatialIndexForTests(): void {
  fullRebuildNeeded = true;
  orderDirty = true;
  dirtyIds.clear();
  volatileArrowIds.clear();
  zIndexById.clear();
  bindingDependents.clear();
  arrowBindings.clear();
  dependencyGraphDirty = true;
  lastCandidateCount = 0;
  lastQueryUsedIndex = false;
}
