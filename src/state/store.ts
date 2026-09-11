import type {
  ArrowCurveMode,
  ArrowRoutingMode,
  ArrowElement,
  ArrowStyle,
  ArrowTextTarget,
  Bounds,
  CanvasElement,
  ConnectionPoint,
  HistoryEntry,
  HistoryTransactionToken,
  LayerClipboardPayload,
  LayerGroupNode,
  InteractionMode,
  Point,
  ShortcutId,
  TextAlign,
  TextVerticalAlign,
  Tool,
} from '../model/types';
import { SHORTCUT_DEFINITIONS } from '../shortcuts/definitions';
import { cleanupEmptyLayerGroups, groupLayerSelection, normalizeLayerHierarchy, ungroupLayerSelection } from '../layers/model';

const initialShortcutBindings = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map(d => [d.id, d.defaultBinding]),
) as Record<ShortcutId, string>;

export interface AppState {
  elements: CanvasElement[];
  /** First-class Layers group nodes; element z-order remains in elements[]. */
  layerGroups: LayerGroupNode[];
  selectedIds: string[];
  /** Exact group selected from Layers UI, when selection represents a group node. */
  selectedLayerGroupId: string | null;

  activeTool: Tool;
  previousToolBeforeSpace: Tool;
  isSpacePanning: boolean;
  brushColor: string;
  currentThickness: number;
  arrowStyle: ArrowStyle;
  arrowColor: string;

  arrowPopover: HTMLDivElement | null;
  hoveredConnection: { id: string; point?: ConnectionPoint; position: Point } | null;
  camera: { x: number; y: number; zoom: number };

  mode: InteractionMode;
  dragStartWorld: Point;
  currentMouseWorld: Point;
  initialElementsState: CanvasElement[];
  initialElementsById: Map<string, CanvasElement>;
  initialGroupBounds: Bounds | null;
  activeResizeHandle: string | null;
  activeArrowPointIndex: number | null;
  activeArrowBranchId: string | null;
  activeArrowBranchPointIndex: number | null;
  editingArrowTextTarget: { kind: ArrowTextTarget; branchId?: string } | null;
  activeArrowLabelMoveTarget: { kind: 'label' | 'branch'; branchId?: string } | null;
  contextArrowEndpoint: 'start' | 'end' | null;
  contextArrowBranchId: string | null;
  lastMousePos: Point;
  marqueeStartSelection: string[];
  editingTextId: string | null;
  textEditor: HTMLDivElement | null;
  textEditorContent: HTMLDivElement | null;
  liveTextEditorBounds: Bounds | null;
  eraserTargetId: string | null;
  eraserPreviewIds: Set<string>;
  contextMenuX: number;
  contextMenuY: number;
  internalClipboard: LayerClipboardPayload;

  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  pendingHistoryBefore: HistoryTransactionToken | null;
  textEditBefore: HistoryTransactionToken | null;

  mediaInput: HTMLInputElement | null;
  inspectorPopover: HTMLDivElement | null;
  historyBar: HTMLDivElement | null;
  layerPicker: HTMLDivElement | null;

  projectName: string;
  exportPngScale: number;
  projectDirty: boolean;
  localSaveTimer: number | null;
  pendingLocalSaveResolvers: Array<() => void>;

  activeMoveDelta: Point;
  movingSelectionIds: Set<string>;
  moveBackgroundCanvas: HTMLCanvasElement | null;
  moveSelectionCanvas: HTMLCanvasElement | null;
  altDragDuplicated: boolean;
  appReady: boolean;

  shortcutBindings: Record<ShortcutId, string>;
  shortcutDraft: Record<ShortcutId, string>;
  capturingShortcutId: ShortcutId | null;

  savedEditorRange: Range | null;
  editorSelectionPointerActive: boolean;
  editorSelectionPointerId: number | null;
  richToolbarPositionRaf: number | null;
  richToolbarRefreshRaf: number | null;
  layersRefreshFrame: number | null;
  collapsedLayerGroupIds: Set<string>;
}

export type ElementStylePatch = {
  color?: string;
  thickness?: number;
  name?: string;
  fillColor?: string;
  strokeEnabled?: boolean;
  strokeStyle?: 'solid' | 'dotted' | 'dashed';
  strokePatternSpacing?: number;
  strokeColor?: string;
  fontSize?: number;
  textScale?: number;
  textAlign?: TextAlign;
  textVerticalAlign?: TextVerticalAlign;
  fontFamily?: string;
  style?: ArrowStyle;
  curveMode?: ArrowCurveMode;
  routingMode?: ArrowRoutingMode;
  opacity?: number;
};

type InteractionKeys =
  | 'mode'
  | 'dragStartWorld'
  | 'currentMouseWorld'
  | 'initialElementsState'
  | 'initialElementsById'
  | 'initialGroupBounds'
  | 'activeResizeHandle'
  | 'activeArrowPointIndex'
  | 'activeArrowBranchId'
  | 'activeArrowBranchPointIndex'
  | 'activeArrowLabelMoveTarget'
  | 'contextArrowEndpoint'
  | 'contextArrowBranchId'
  | 'lastMousePos'
  | 'marqueeStartSelection'
  | 'eraserTargetId'
  | 'eraserPreviewIds'
  | 'hoveredConnection'
  | 'activeMoveDelta'
  | 'movingSelectionIds'
  | 'moveBackgroundCanvas'
  | 'moveSelectionCanvas'
  | 'altDragDuplicated';

export type InteractionPatch = Partial<Pick<AppState, InteractionKeys>>;

type EditorKeys =
  | 'editingTextId'
  | 'textEditor'
  | 'textEditorContent'
  | 'liveTextEditorBounds'
  | 'editingArrowTextTarget'
  | 'textEditBefore'
  | 'savedEditorRange'
  | 'editorSelectionPointerActive'
  | 'editorSelectionPointerId'
  | 'richToolbarPositionRaf'
  | 'richToolbarRefreshRaf';

export type EditorPatch = Partial<Pick<AppState, EditorKeys>>;

type UiKeys =
  | 'arrowPopover'
  | 'contextMenuX'
  | 'contextMenuY'
  | 'internalClipboard'
  | 'mediaInput'
  | 'inspectorPopover'
  | 'historyBar'
  | 'layerPicker'
  | 'layersRefreshFrame'
  | 'collapsedLayerGroupIds';

export type UiPatch = Partial<Pick<AppState, UiKeys>>;

type ProjectKeys =
  | 'projectName'
  | 'exportPngScale'
  | 'projectDirty'
  | 'localSaveTimer'
  | 'pendingLocalSaveResolvers'
  | 'appReady';

export type ProjectPatch = Partial<Pick<AppState, ProjectKeys>>;

type PreferenceKeys =
  | 'brushColor'
  | 'currentThickness'
  | 'arrowStyle'
  | 'arrowColor';

export type PreferencePatch = Partial<Pick<AppState, PreferenceKeys>>;

type ToolKeys = 'activeTool' | 'previousToolBeforeSpace' | 'isSpacePanning';
export type ToolPatch = Partial<Pick<AppState, ToolKeys>>;

type HistoryKeys = 'historyPast' | 'historyFuture' | 'pendingHistoryBefore';
export type HistoryPatch = Partial<Pick<AppState, HistoryKeys>>;

type ShortcutKeys = 'shortcutBindings' | 'shortcutDraft' | 'capturingShortcutId';
export type ShortcutPatch = Partial<Pick<AppState, ShortcutKeys>>;

export type AppAction =
  | { type: 'ADD_ELEMENT'; element: CanvasElement }
  | { type: 'ADD_ELEMENTS'; elements: CanvasElement[] }
  | { type: 'CREATE_ARROW'; arrow: ArrowElement }
  | { type: 'APPEND_FREEHAND_POINT'; id: string; point: Point }
  | { type: 'REPLACE_ELEMENTS'; elements: CanvasElement[] }
  | { type: 'REPLACE_DOCUMENT'; elements: CanvasElement[]; layerGroups: LayerGroupNode[] }
  | { type: 'ADD_LAYER_GROUPS'; groups: LayerGroupNode[] }
  | { type: 'REPLACE_LAYER_GROUPS'; groups: LayerGroupNode[] }
  | { type: 'GROUP_LAYER_SELECTION'; ids: string[]; group: LayerGroupNode }
  | { type: 'UNGROUP_LAYER_SELECTION'; ids: string[]; preferredGroupId?: string | null }
  | { type: 'RENAME_LAYER_GROUP'; id: string; name: string }
  | { type: 'DELETE_ELEMENTS'; ids: string[]; preserveSelection?: boolean }
  | { type: 'MOVE_ELEMENTS'; ids: string[]; delta: Point; detachBindings?: boolean }
  | { type: 'LOCK_ELEMENTS'; ids: string[]; locked: boolean; preserveSelection?: boolean }
  | { type: 'SET_ELEMENTS_HIDDEN'; ids: string[]; hidden: boolean; preserveSelection?: boolean }
  | { type: 'UPDATE_STYLE'; ids: string[]; patch: ElementStylePatch }
  | { type: 'UPDATE_ELEMENT'; id: string; update: (element: CanvasElement) => void }
  | { type: 'UPDATE_ELEMENTS'; ids: string[]; update: (element: CanvasElement, index: number) => void }
  | { type: 'REORDER_ELEMENTS'; elements: CanvasElement[] }
  | { type: 'RENAME_ELEMENT'; id: string; name?: string }
  | { type: 'INSERT_ELEMENT_AT'; index: number; element: CanvasElement }
  | { type: 'APPLY_ELEMENT_PATCH'; id: string; patch: Record<string, unknown> }
  | { type: 'REORDER_BY_IDS'; order: string[] }
  | { type: 'SET_SELECTION'; ids: string[]; layerGroupId?: string | null }
  | { type: 'SET_CAMERA'; camera: { x: number; y: number; zoom: number } }
  | { type: 'PAN_CAMERA'; dx: number; dy: number }
  | { type: 'SET_TOOL_STATE'; patch: ToolPatch }
  | { type: 'SET_PREFERENCES'; patch: PreferencePatch }
  | { type: 'SET_INTERACTION'; patch: InteractionPatch }
  | { type: 'SET_EDITOR'; patch: EditorPatch }
  | { type: 'SET_UI'; patch: UiPatch }
  | { type: 'SET_PROJECT'; patch: ProjectPatch }
  | { type: 'SET_HISTORY'; patch: HistoryPatch }
  | { type: 'SET_SHORTCUTS'; patch: ShortcutPatch };

const state: AppState = {
  elements: [],
  layerGroups: [],
  selectedIds: [],
  selectedLayerGroupId: null,
  activeTool: 'select',
  previousToolBeforeSpace: 'select',
  isSpacePanning: false,
  brushColor: '#111827',
  currentThickness: 3,
  arrowStyle: 'line',
  arrowColor: '#111827',
  arrowPopover: null,
  hoveredConnection: null,
  camera: { x: 0, y: 0, zoom: 1 },
  mode: 'none',
  dragStartWorld: { x: 0, y: 0 },
  currentMouseWorld: { x: 0, y: 0 },
  initialElementsState: [],
  initialElementsById: new Map<string, CanvasElement>(),
  initialGroupBounds: null,
  activeResizeHandle: null,
  activeArrowPointIndex: null,
  activeArrowBranchId: null,
  activeArrowBranchPointIndex: null,
  editingArrowTextTarget: null,
  activeArrowLabelMoveTarget: null,
  contextArrowEndpoint: null,
  contextArrowBranchId: null,
  lastMousePos: { x: 0, y: 0 },
  marqueeStartSelection: [],
  editingTextId: null,
  textEditor: null,
  textEditorContent: null,
  liveTextEditorBounds: null,
  eraserTargetId: null,
  eraserPreviewIds: new Set<string>(),
  contextMenuX: 0,
  contextMenuY: 0,
  internalClipboard: { elements: [], layerGroups: [] },
  historyPast: [],
  historyFuture: [],
  pendingHistoryBefore: null,
  textEditBefore: null,
  mediaInput: null,
  inspectorPopover: null,
  historyBar: null,
  layerPicker: null,
  projectName: 'Untitled Board',
  exportPngScale: 4,
  projectDirty: false,
  localSaveTimer: null,
  pendingLocalSaveResolvers: [],
  activeMoveDelta: { x: 0, y: 0 },
  movingSelectionIds: new Set<string>(),
  moveBackgroundCanvas: null,
  moveSelectionCanvas: null,
  altDragDuplicated: false,
  appReady: false,
  shortcutBindings: initialShortcutBindings,
  shortcutDraft: { ...initialShortcutBindings },
  capturingShortcutId: null,
  savedEditorRange: null,
  editorSelectionPointerActive: false,
  editorSelectionPointerId: null,
  richToolbarPositionRaf: null,
  richToolbarRefreshRaf: null,
  layersRefreshFrame: null,
  collapsedLayerGroupIds: new Set<string>(),
};


function ownElement(element: CanvasElement): CanvasElement {
  // The store owns document objects. Clone incoming payloads so a caller cannot
  // retain a reference and mutate the live document behind the reducer.
  return structuredClone(element) as CanvasElement;
}

function ownLayerGroup(group: LayerGroupNode): LayerGroupNode {
  return structuredClone(group) as LayerGroupNode;
}

function replaceLayerGroups(groups: LayerGroupNode[], clone = true) {
  state.layerGroups = clone ? groups.map(ownLayerGroup) : [...groups];
}

function replaceDocumentElements(elements: CanvasElement[], clone = true) {
  state.elements = clone ? elements.map(ownElement) : [...elements];
}

function normalizeDocumentHierarchy() {
  const normalized = normalizeLayerHierarchy(state.elements, state.layerGroups);
  state.elements = normalized.elements;
  state.layerGroups = normalized.groups;
  const groupIds = new Set(state.layerGroups.map(group => group.id));
  if (state.selectedLayerGroupId && !groupIds.has(state.selectedLayerGroupId)) state.selectedLayerGroupId = null;
  state.collapsedLayerGroupIds = new Set([...state.collapsedLayerGroupIds].filter(id => groupIds.has(id)));
}

function cloneForUpdate(element: CanvasElement): CanvasElement {
  return structuredClone(element) as CanvasElement;
}

function translateElement(element: CanvasElement, dx: number, dy: number, detachBindings = false): CanvasElement {
  const next = cloneForUpdate(element);
  if (next.type === 'rectangle' || next.type === 'note' || next.type === 'media' || next.type === 'text') {
    next.x += dx;
    next.y += dy;
    return next;
  }
  if (next.type === 'freehand') {
    next.points = next.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
    return next;
  }

  next.start = { x: next.start.x + dx, y: next.start.y + dy };
  next.control = { x: next.control.x + dx, y: next.control.y + dy };
  if (next.controls) next.controls = next.controls.map(point => ({ x: point.x + dx, y: point.y + dy }));
  next.end = { x: next.end.x + dx, y: next.end.y + dy };
  if (next.branches) {
    next.branches = next.branches.map(branch => ({
      ...branch,
      end: { x: branch.end.x + dx, y: branch.end.y + dy },
      controls: branch.controls?.map(point => ({ x: point.x + dx, y: point.y + dy })),
      ...(detachBindings ? { endBinding: undefined, endBindingPoint: undefined, endBindingAnchor: undefined } : {}),
    }));
  }
  if (detachBindings) {
    next.startBinding = undefined;
    next.endBinding = undefined;
    next.startBindingPoint = undefined;
    next.endBindingPoint = undefined;
    next.startBindingAnchor = undefined;
    next.endBindingAnchor = undefined;
  }
  return next;
}

function reduce(action: AppAction) {
  switch (action.type) {
    case 'ADD_ELEMENT':
      replaceDocumentElements([...state.elements, ownElement(action.element)], false);
      break;
    case 'ADD_ELEMENTS':
      replaceDocumentElements([...state.elements, ...action.elements.map(ownElement)], false);
      break;
    case 'CREATE_ARROW':
      replaceDocumentElements([...state.elements, ownElement(action.arrow)], false);
      break;
    case 'APPEND_FREEHAND_POINT': {
      replaceDocumentElements(state.elements.map(element => element.id === action.id && element.type === 'freehand'
        ? { ...element, points: [...element.points, { ...action.point }] }
        : element), false);
      break;
    }
    case 'REPLACE_ELEMENTS':
      replaceDocumentElements(action.elements);
      normalizeDocumentHierarchy();
      break;
    case 'REPLACE_DOCUMENT':
      replaceDocumentElements(action.elements);
      replaceLayerGroups(action.layerGroups);
      normalizeDocumentHierarchy();
      state.selectedIds = [];
      state.selectedLayerGroupId = null;
      break;
    case 'ADD_LAYER_GROUPS':
      replaceLayerGroups([...state.layerGroups, ...action.groups.map(ownLayerGroup)], false);
      normalizeDocumentHierarchy();
      break;
    case 'REPLACE_LAYER_GROUPS':
      replaceLayerGroups(action.groups);
      normalizeDocumentHierarchy();
      break;
    case 'GROUP_LAYER_SELECTION': {
      const next = groupLayerSelection(state.elements, state.layerGroups, action.ids, action.group);
      if (next.changed) {
        replaceDocumentElements(next.elements, false);
        replaceLayerGroups(next.groups, false);
        state.selectedLayerGroupId = action.group.id;
      }
      break;
    }
    case 'UNGROUP_LAYER_SELECTION': {
      const next = ungroupLayerSelection(state.elements, state.layerGroups, action.ids, action.preferredGroupId);
      if (next.changed) {
        replaceDocumentElements(next.elements, false);
        replaceLayerGroups(next.groups, false);
        state.selectedLayerGroupId = null;
        normalizeDocumentHierarchy();
      }
      break;
    }
    case 'RENAME_LAYER_GROUP':
      replaceLayerGroups(state.layerGroups.map(group => group.id === action.id
        ? { ...ownLayerGroup(group), name: action.name }
        : group), false);
      break;
    case 'DELETE_ELEMENTS': {
      const ids = new Set(action.ids);
      replaceDocumentElements(state.elements.filter(element => !ids.has(element.id)), false);
      replaceLayerGroups(cleanupEmptyLayerGroups(state.elements, state.layerGroups), false);
      if (!action.preserveSelection) state.selectedIds = state.selectedIds.filter(id => !ids.has(id));
      if (!state.selectedIds.length) state.selectedLayerGroupId = null;
      normalizeDocumentHierarchy();
      break;
    }
    case 'MOVE_ELEMENTS': {
      const ids = new Set(action.ids);
      replaceDocumentElements(state.elements.map(element => ids.has(element.id)
        ? translateElement(element, action.delta.x, action.delta.y, action.detachBindings)
        : element), false);
      break;
    }
    case 'LOCK_ELEMENTS': {
      const ids = new Set(action.ids);
      replaceDocumentElements(state.elements.map(element => ids.has(element.id)
        ? { ...structuredClone(element), locked: action.locked } as CanvasElement
        : element), false);
      if (action.locked && !action.preserveSelection) {
        state.selectedIds = state.selectedIds.filter(id => !ids.has(id));
        if (!state.selectedIds.length) state.selectedLayerGroupId = null;
      }
      break;
    }
    case 'SET_ELEMENTS_HIDDEN': {
      const ids = new Set(action.ids);
      replaceDocumentElements(state.elements.map(element => ids.has(element.id)
        ? { ...structuredClone(element), hidden: action.hidden } as CanvasElement
        : element), false);
      if (action.hidden && !action.preserveSelection) {
        state.selectedIds = state.selectedIds.filter(id => !ids.has(id));
        if (!state.selectedIds.length) state.selectedLayerGroupId = null;
      }
      break;
    }
    case 'UPDATE_STYLE': {
      const ids = new Set(action.ids);
      replaceDocumentElements(state.elements.map(element => ids.has(element.id)
        ? Object.assign(cloneForUpdate(element), action.patch) as CanvasElement
        : element), false);
      break;
    }
    case 'UPDATE_ELEMENT':
      replaceDocumentElements(state.elements.map(element => {
        if (element.id !== action.id) return element;
        const next = cloneForUpdate(element);
        action.update(next);
        return next;
      }), false);
      break;
    case 'UPDATE_ELEMENTS': {
      const ids = new Set(action.ids);
      let index = 0;
      replaceDocumentElements(state.elements.map(element => {
        if (!ids.has(element.id)) return element;
        const next = cloneForUpdate(element);
        action.update(next, index++);
        return next;
      }), false);
      break;
    }
    case 'REORDER_ELEMENTS':
      replaceDocumentElements(action.elements, false);
      break;
    case 'RENAME_ELEMENT':
      replaceDocumentElements(state.elements.map(element => element.id === action.id
        ? { ...structuredClone(element), name: action.name } as CanvasElement
        : element), false);
      break;
    case 'INSERT_ELEMENT_AT': {
      const next = [...state.elements];
      const index = Math.max(0, Math.min(action.index, next.length));
      next.splice(index, 0, ownElement(action.element));
      replaceDocumentElements(next, false);
      break;
    }
    case 'APPLY_ELEMENT_PATCH':
      replaceDocumentElements(state.elements.map(element => {
        if (element.id !== action.id) return element;
        const next = cloneForUpdate(element) as CanvasElement & Record<string, unknown>;
        for (const [key, value] of Object.entries(action.patch)) {
          (next as Record<string, unknown>)[key] = structuredClone(value);
        }
        return next as CanvasElement;
      }), false);
      break;
    case 'REORDER_BY_IDS': {
      const byId = new Map(state.elements.map(element => [element.id, element]));
      const next: CanvasElement[] = [];
      for (const id of action.order) {
        const element = byId.get(id);
        if (element) { next.push(element); byId.delete(id); }
      }
      for (const element of state.elements) if (byId.has(element.id)) next.push(element);
      replaceDocumentElements(next, false);
      break;
    }
    case 'SET_SELECTION':
      state.selectedIds = [...action.ids];
      state.selectedLayerGroupId = action.layerGroupId ?? null;
      break;
    case 'SET_CAMERA':
      state.camera = { ...action.camera };
      break;
    case 'PAN_CAMERA':
      state.camera = { ...state.camera, x: state.camera.x + action.dx, y: state.camera.y + action.dy };
      break;
    case 'SET_TOOL_STATE':
      Object.assign(state, action.patch);
      break;
    case 'SET_PREFERENCES': {
      Object.assign(state, action.patch);
      break;
    }
    case 'SET_INTERACTION': {
      const patch = { ...action.patch };
      if (patch.dragStartWorld) patch.dragStartWorld = { ...patch.dragStartWorld };
      if (patch.currentMouseWorld) patch.currentMouseWorld = { ...patch.currentMouseWorld };
      if (patch.lastMousePos) patch.lastMousePos = { ...patch.lastMousePos };
      if (patch.activeMoveDelta) patch.activeMoveDelta = { ...patch.activeMoveDelta };
      if (patch.initialGroupBounds) patch.initialGroupBounds = { ...patch.initialGroupBounds };
      if (patch.initialElementsState) patch.initialElementsState = structuredClone(patch.initialElementsState);
      if (patch.initialElementsById) patch.initialElementsById = new Map([...patch.initialElementsById].map(([id, element]) => [id, ownElement(element)]));
      if (patch.marqueeStartSelection) patch.marqueeStartSelection = [...patch.marqueeStartSelection];
      if (patch.eraserPreviewIds) patch.eraserPreviewIds = new Set(patch.eraserPreviewIds);
      if (patch.movingSelectionIds) patch.movingSelectionIds = new Set(patch.movingSelectionIds);
      if (patch.hoveredConnection) patch.hoveredConnection = { ...patch.hoveredConnection, position: { ...patch.hoveredConnection.position } };
      Object.assign(state, patch);
      break;
    }
    case 'SET_EDITOR': {
      const patch = { ...action.patch };
      if (patch.liveTextEditorBounds) patch.liveTextEditorBounds = { ...patch.liveTextEditorBounds };
      Object.assign(state, patch);
      break;
    }
    case 'SET_UI': {
      const patch = { ...action.patch };
      if (patch.internalClipboard) patch.internalClipboard = {
        elements: patch.internalClipboard.elements.map(ownElement),
        layerGroups: patch.internalClipboard.layerGroups.map(ownLayerGroup),
      };
      if (patch.collapsedLayerGroupIds) patch.collapsedLayerGroupIds = new Set(patch.collapsedLayerGroupIds);
      Object.assign(state, patch);
      break;
    }
    case 'SET_PROJECT': {
      const patch = { ...action.patch };
      if (patch.pendingLocalSaveResolvers) patch.pendingLocalSaveResolvers = [...patch.pendingLocalSaveResolvers];
      Object.assign(state, patch);
      break;
    }
    case 'SET_HISTORY': {
      const patch = { ...action.patch };
      if (patch.historyPast) patch.historyPast = [...patch.historyPast];
      if (patch.historyFuture) patch.historyFuture = [...patch.historyFuture];
      Object.assign(state, patch);
      break;
    }
    case 'SET_SHORTCUTS': {
      const patch = { ...action.patch };
      if (patch.shortcutBindings) patch.shortcutBindings = { ...patch.shortcutBindings };
      if (patch.shortcutDraft) patch.shortcutDraft = { ...patch.shortcutDraft };
      Object.assign(state, patch);
      break;
    }
  }
}

export type StoreListener = (state: Readonly<AppState>, action: AppAction) => void;
const beforeListeners = new Set<StoreListener>();
const listeners = new Set<StoreListener>();

export const store = {
  getState(): Readonly<AppState> {
    return state;
  },
  dispatch(action: AppAction) {
    beforeListeners.forEach(listener => listener(state, action));
    reduce(action);
    listeners.forEach(listener => listener(state, action));
  },
  subscribeBefore(listener: StoreListener) {
    beforeListeners.add(listener);
    return () => beforeListeners.delete(listener);
  },
  subscribe(listener: StoreListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const dispatch = store.dispatch.bind(store);

// Read-only state facade for rendering/selectors. Feature modules must dispatch
// actions instead of assigning state directly; the mutation guard enforces this.
export const appState: Readonly<AppState> = state;
