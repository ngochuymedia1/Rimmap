import { appState, dispatch } from '../state/store';
import { generateId } from '../model/ids';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE } from '../model/text';
import { ArrowElement, Bounds, LayerGroupNode, NoteElement, RectangleElement, RichLine, TextElement } from '../model/types';
import { NOTE_DEFAULT_FILL } from '../renderer/shapes';
import { clearRichTextLayoutCache, getRichTextLayoutCacheStats, measureRichTextLayoutFromLines, redraw } from '../renderer/index';
import { requestLayersPanelRefresh } from '../layers/index';
import { getExportElements } from '../exports/index';
import { startTextEditing, closeTextEditor } from '../text-editor/index';
import { copySelectionToClipboard, pasteFromClipboard } from '../ui/context-menu';
import { getArrowLabelLayout } from '../arrows/index';
import { findConnectionAtPoint, getArrowLabelCollisionBounds, getArrowRenderPoints, getSpatialIndexBounds } from '../model/geometry';
import { getSceneSpatialIndexStats, querySceneElements, resetSceneSpatialIndexForTests } from '../performance/scene-index';
import { getPerformanceInstrumentationStats, resetPerformanceInstrumentation, setPerformanceInstrumentationEnabled } from '../performance/instrumentation';

export type MyBoardTestHooks = ReturnType<typeof createTestHooks>;

function createTestHooks() {
  return {
    ready: () => appState.appReady,
    snapshot: () => structuredClone({
      elements: appState.elements,
      layerGroups: appState.layerGroups,
      selectedIds: appState.selectedIds,
      selectedLayerGroupId: appState.selectedLayerGroupId,
      camera: appState.camera,
      activeTool: appState.activeTool,
      editingTextId: appState.editingTextId,
      projectName: appState.projectName,
      activeMoveDelta: appState.activeMoveDelta,
    }),
    exportElementIds: () => getExportElements().map(element => element.id),
    addNote: (overrides: Partial<NoteElement> = {}) => {
      const note: NoteElement = {
        id: overrides.id || generateId(),
        type: 'note',
        x: overrides.x ?? 180,
        y: overrides.y ?? 140,
        width: overrides.width ?? 180,
        height: overrides.height ?? 110,
        color: overrides.color ?? '#262626',
        thickness: overrides.thickness ?? 1.15,
        fillColor: overrides.fillColor ?? NOTE_DEFAULT_FILL,
        text: overrides.text ?? '',
        textDoc: overrides.textDoc,
        fontSize: overrides.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
        textScale: overrides.textScale ?? 1,
        borderRadius: overrides.borderRadius ?? 1,
        textAlign: overrides.textAlign ?? 'left',
        textVerticalAlign: overrides.textVerticalAlign ?? 'top',
        fontFamily: overrides.fontFamily ?? DEFAULT_FONT_FAMILY,
        name: overrides.name ?? 'Test Note',
        locked: overrides.locked,
        hidden: overrides.hidden,
        parentGroupId: overrides.parentGroupId,
      };
      dispatch({ type: 'ADD_ELEMENT', element: note });
      dispatch({ type: 'SET_SELECTION', ids: [note.id] });
      requestLayersPanelRefresh();
      redraw();
      return note.id;
    },
    addArrow: (overrides: Partial<ArrowElement> = {}) => {
      const start = overrides.start ?? { x: 120, y: 200 };
      const end = overrides.end ?? { x: 620, y: 200 };
      const middle = overrides.control ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const arrow: ArrowElement = {
        id: overrides.id || generateId(), type: 'arrow', start: { ...start }, control: { ...middle },
        controls: overrides.controls ? overrides.controls.map(point => ({ ...point })) : [{ ...middle }],
        pointCount: overrides.pointCount ?? 3, end: { ...end }, style: overrides.style ?? 'line',
        curveMode: overrides.curveMode ?? 'sharp', arrowMode: overrides.arrowMode ?? 'connection', routingMode: overrides.routingMode ?? 'manual',
        branches: overrides.branches, color: overrides.color ?? '#111827', thickness: overrides.thickness ?? 2, opacity: overrides.opacity ?? 1,
        name: overrides.name ?? 'Test Arrow', label: overrides.label, labelFontSize: overrides.labelFontSize, labelPosition: overrides.labelPosition, labelSide: overrides.labelSide,
        startBinding: overrides.startBinding, endBinding: overrides.endBinding, startBindingPoint: overrides.startBindingPoint, endBindingPoint: overrides.endBindingPoint,
        startBindingAnchor: overrides.startBindingAnchor, endBindingAnchor: overrides.endBindingAnchor, parentGroupId: overrides.parentGroupId, hidden: overrides.hidden, locked: overrides.locked,
      };
      dispatch({ type: 'ADD_ELEMENT', element: arrow });
      dispatch({ type: 'SET_SELECTION', ids: [arrow.id] });
      requestLayersPanelRefresh();
      redraw();
      return arrow.id;
    },
    arrowRenderPoints: (id: string) => {
      const arrow = appState.elements.find(item => item.id === id);
      if (!arrow || (arrow.type !== 'arrow' && arrow.type !== 'connector')) throw new Error(`Missing arrow ${id}`);
      return structuredClone(getArrowRenderPoints(arrow));
    },
    arrowLabelBox: (id: string) => {
      const arrow = appState.elements.find(item => item.id === id);
      if (!arrow || (arrow.type !== 'arrow' && arrow.type !== 'connector')) throw new Error(`Missing arrow ${id}`);
      return structuredClone(getArrowLabelLayout(arrow, getArrowRenderPoints(arrow), getArrowLabelCollisionBounds(arrow.id))?.box ?? null);
    },
    arrowLabelLayout: (id: string) => {
      const arrow = appState.elements.find(item => item.id === id);
      if (!arrow || (arrow.type !== 'arrow' && arrow.type !== 'connector')) throw new Error(`Missing arrow ${id}`);
      return structuredClone(getArrowLabelLayout(arrow, getArrowRenderPoints(arrow), getArrowLabelCollisionBounds(arrow.id)) ?? null);
    },
    editArrowLabel: (id: string) => {
      const arrow = appState.elements.find(item => item.id === id);
      if (!arrow || (arrow.type !== 'arrow' && arrow.type !== 'connector')) throw new Error(`Missing arrow ${id}`);
      const layout = getArrowLabelLayout(arrow, getArrowRenderPoints(arrow), getArrowLabelCollisionBounds(arrow.id));
      startTextEditing(layout?.anchor ?? arrow.start, arrow.id, undefined, { kind: 'label' });
    },
    addRectangleGrid: (count: number, columns = 24, spacingX = 180, spacingY = 140) => {
      const rectangles: RectangleElement[] = [];
      for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
        rectangles.push({
          id: `perf-rect-${i}`,
          type: 'rectangle',
          x: (i % columns) * spacingX,
          y: Math.floor(i / columns) * spacingY,
          width: 100,
          height: 80,
          color: '#111827',
          thickness: 1,
          borderRadius: 8,
          strokeEnabled: true,
          strokeStyle: 'solid',
          strokePatternSpacing: 1,
          strokeColor: '#111111',
          text: `Card ${i}`,
          fontSize: DEFAULT_TEXT_FONT_SIZE,
          textScale: 1,
          textAlign: 'left',
          textVerticalAlign: 'top',
          fontFamily: DEFAULT_FONT_FAMILY,
          name: `Performance Card ${i}`,
        });
      }
      dispatch({ type: 'ADD_ELEMENTS', elements: rectangles });
      dispatch({ type: 'SET_SELECTION', ids: [] });
      requestLayersPanelRefresh();
      redraw();
      return rectangles.map(item => item.id);
    },
    addStressBoard: (count = 600, columns = 30) => {
      const total = Math.max(1, Math.floor(count));
      const elements: Array<RectangleElement | NoteElement | TextElement | ArrowElement> = [];
      const shapeIds: string[] = [];
      for (let i = 0; i < total; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = col * 170;
        const y = row * 125;
        if (i % 15 === 14 && shapeIds.length >= 2) {
          const startId = shapeIds[shapeIds.length - 2];
          const endId = shapeIds[shapeIds.length - 1];
          elements.push({
            id: `stress-arrow-${i}`, type: 'arrow', start: { x: x - 260, y: y - 30 }, control: { x: x - 170, y: y - 30 }, controls: [{ x: x - 170, y: y - 30 }], end: { x: x - 80, y: y - 30 },
            startBinding: startId, endBinding: endId, arrowMode: 'connection', routingMode: i % 30 === 14 ? 'auto' : 'manual', style: 'arrow', curveMode: 'smooth', color: '#111827', thickness: 2, opacity: 1, label: i % 30 === 14 ? `Flow ${i}` : undefined, name: `Stress Arrow ${i}`,
          });
          continue;
        }
        if (i % 10 === 9) {
          elements.push({ id: `stress-text-${i}`, type: 'text', x, y: y + 30, text: `Stress text ${i} with repeated layout`, color: '#111827', thickness: 1, fontSize: DEFAULT_TEXT_FONT_SIZE, textScale: 1, textAlign: 'left', fontFamily: DEFAULT_FONT_FAMILY, name: `Stress Text ${i}` });
          continue;
        }
        if (i % 6 === 5) {
          const id = `stress-note-${i}`;
          shapeIds.push(id);
          elements.push({ id, type: 'note', x, y, width: 130, height: 88, color: '#262626', thickness: 1.15, fillColor: NOTE_DEFAULT_FILL, text: `Stress note ${i}\nSecond line`, fontSize: DEFAULT_TEXT_FONT_SIZE, textScale: .8, borderRadius: 1, textAlign: 'left', textVerticalAlign: 'top', fontFamily: DEFAULT_FONT_FAMILY, name: `Stress Note ${i}` });
          continue;
        }
        const id = `stress-rect-${i}`;
        shapeIds.push(id);
        elements.push({ id, type: 'rectangle', x, y, width: 130, height: 88, color: '#111827', thickness: 1, borderRadius: 8, strokeEnabled: true, strokeStyle: 'solid', strokePatternSpacing: 1, strokeColor: '#111111', text: `Card ${i}`, fontSize: DEFAULT_TEXT_FONT_SIZE, textScale: .8, textAlign: 'left', textVerticalAlign: 'top', fontFamily: DEFAULT_FONT_FAMILY, name: `Stress Rectangle ${i}` });
      }
      dispatch({ type: 'ADD_ELEMENTS', elements });
      dispatch({ type: 'SET_SELECTION', ids: [] });
      requestLayersPanelRefresh();
      redraw();
      return elements.map(item => item.id);
    },
    sceneCandidateIds: (bounds: Bounds) => querySceneElements(bounds, getSpatialIndexBounds).map(element => element.id),
    connectionAt: (point: { x: number; y: number }) => structuredClone(findConnectionAtPoint(point) || null),
    performanceStats: () => ({ scene: getSceneSpatialIndexStats(), textLayout: getRichTextLayoutCacheStats(), runtime: getPerformanceInstrumentationStats() }),
    enablePerformanceInstrumentation: (enabled = true) => setPerformanceInstrumentationEnabled(enabled),
    resetPerformanceCaches: () => {
      clearRichTextLayoutCache();
      resetSceneSpatialIndexForTests();
      resetPerformanceInstrumentation();
    },
    addRectangle: (overrides: Partial<RectangleElement> = {}) => {
      const rectangle: RectangleElement = {
        id: overrides.id || generateId(),
        type: 'rectangle',
        x: overrides.x ?? 180,
        y: overrides.y ?? 140,
        width: overrides.width ?? 220,
        height: overrides.height ?? 140,
        color: overrides.color ?? '#111827',
        thickness: overrides.thickness ?? 2,
        borderRadius: overrides.borderRadius ?? 10,
        fillColor: overrides.fillColor,
        strokeEnabled: overrides.strokeEnabled ?? true,
        strokeStyle: overrides.strokeStyle ?? 'solid',
        strokePatternSpacing: overrides.strokePatternSpacing ?? 1,
        strokeColor: overrides.strokeColor ?? '#111111',
        text: overrides.text ?? '',
        textDoc: overrides.textDoc,
        fontSize: overrides.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
        textScale: overrides.textScale ?? 1,
        textAlign: overrides.textAlign ?? 'left',
        textVerticalAlign: overrides.textVerticalAlign ?? 'top',
        fontFamily: overrides.fontFamily ?? DEFAULT_FONT_FAMILY,
        name: overrides.name ?? 'Test Rectangle',
        locked: overrides.locked,
        hidden: overrides.hidden,
        parentGroupId: overrides.parentGroupId,
      };
      dispatch({ type: 'ADD_ELEMENT', element: rectangle });
      dispatch({ type: 'SET_SELECTION', ids: [rectangle.id] });
      requestLayersPanelRefresh();
      redraw();
      return rectangle.id;
    },
    addText: (overrides: Partial<TextElement> = {}) => {
      const text: TextElement = {
        id: overrides.id || generateId(),
        type: 'text',
        x: overrides.x ?? 180,
        y: overrides.y ?? 160,
        text: overrides.text ?? '',
        textDoc: overrides.textDoc,
        color: overrides.color ?? '#111827',
        thickness: overrides.thickness ?? 1,
        fontSize: overrides.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
        textScale: overrides.textScale ?? 1,
        textAlign: overrides.textAlign ?? 'left',
        textWidth: overrides.textWidth,
        fontFamily: overrides.fontFamily ?? DEFAULT_FONT_FAMILY,
        name: overrides.name ?? 'Test Text',
        locked: overrides.locked,
        hidden: overrides.hidden,
        parentGroupId: overrides.parentGroupId,
      };
      dispatch({ type: 'ADD_ELEMENT', element: text });
      dispatch({ type: 'SET_SELECTION', ids: [text.id] });
      requestLayersPanelRefresh();
      redraw();
      return text.id;
    },
    select: (ids: string[], layerGroupId?: string | null) => {
      dispatch({ type: 'SET_SELECTION', ids, layerGroupId });
      requestLayersPanelRefresh();
      redraw();
    },
    setLayerGroups: (groups: LayerGroupNode[]) => {
      dispatch({ type: 'REPLACE_LAYER_GROUPS', groups });
      requestLayersPanelRefresh();
      redraw();
    },
    groupSelection: (group: LayerGroupNode) => {
      dispatch({ type: 'GROUP_LAYER_SELECTION', ids: [...appState.selectedIds], group });
      requestLayersPanelRefresh();
      redraw();
    },
    ungroupSelection: (preferredGroupId?: string | null) => {
      dispatch({ type: 'UNGROUP_LAYER_SELECTION', ids: [...appState.selectedIds], preferredGroupId });
      requestLayersPanelRefresh();
      redraw();
    },
    copySelection: () => copySelectionToClipboard(),
    pasteSelection: () => pasteFromClipboard(),
    editElement: (id: string) => {
      const element = appState.elements.find(item => item.id === id);
      if (!element || !('x' in element) || !('y' in element)) throw new Error(`Cannot edit element ${id}`);
      startTextEditing({ x: Number(element.x), y: Number(element.y) }, id);
    },
    closeEditor: (commit = true) => closeTextEditor(commit, true),
    measureLines: (lines: RichLine[], maxWidth: number, fontSize = DEFAULT_TEXT_FONT_SIZE) => {
      const layout = measureRichTextLayoutFromLines(lines, fontSize, '#111827', maxWidth, 1, DEFAULT_FONT_FAMILY);
      return structuredClone(layout);
    },
  };
}

export function installTestHooks(): void {
  (window as Window & { __MY_BOARD_TEST__?: MyBoardTestHooks }).__MY_BOARD_TEST__ = createTestHooks();
}

declare global {
  interface Window {
    __MY_BOARD_TEST__?: MyBoardTestHooks;
  }
}
