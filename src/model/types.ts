// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
// --- 1. DATA TYPES ---
export type Point = {
    x: number;
    y: number;
};

export type Tool = 'select' | 'hand' | 'pencil' | 'rectangle' | 'note' | 'arrow' | 'eraser';

export type BaseElement = {
    id: string;
    /** Optional user-facing layer name. */
    name?: string;
    /** Parent Layer-group node. Undefined means the element is at the Layers root. */
    parentGroupId?: string;
    color: string;
    thickness: number;
    /** Locked objects are canvas-inert and can only be unlocked from All Layers. */
    locked?: boolean;
    /** Hidden objects stay in the document/layer order but do not render, export, or participate in canvas interaction. */
    hidden?: boolean;
};

export type FreehandElement = BaseElement & {
    type: 'freehand';
    points: Point[];
};

export type TextAlign = 'left' | 'center' | 'right';

export type TextVerticalAlign = 'top' | 'middle';

export type ShapeStrokeStyle = 'solid' | 'dotted' | 'dashed';

export type RectangleElement = BaseElement & {
    type: 'rectangle';
    x: number;
    y: number;
    width: number;
    height: number;
    borderRadius: number;
    /** Optional soft card fill. Undefined keeps the classic transparent rectangle. */
    fillColor?: string;
    /** Rectangle outline can be hidden independently from its text/fill. */
    strokeEnabled?: boolean;
    strokeStyle?: ShapeStrokeStyle;
    /** Controls the spacing between dots/dashes. 1 = normal; smaller = denser. */
    strokePatternSpacing?: number;
    /** Undefined means use the element's current color, preserving legacy behavior. */
    strokeColor?: string;
    text?: string;
    textDoc?: TextDocument;
    fontSize?: number;
    textScale?: number;
    textAlign?: TextAlign;
    textVerticalAlign?: TextVerticalAlign;
    fontFamily?: string;
};

export type NoteElement = BaseElement & {
    type: 'note';
    x: number;
    y: number;
    width: number;
    height: number;
    /** Pastel card color. Legacy notes fall back to NOTE_DEFAULT_FILL. */
    fillColor?: string;
    text: string;
    textDoc?: TextDocument;
    fontSize: number;
    textScale?: number;
    borderRadius: number;
    textAlign?: TextAlign;
    textVerticalAlign?: TextVerticalAlign;
    fontFamily?: string;
};

export type MediaElement = BaseElement & {
    type: 'media';
    x: number;
    y: number;
    width: number;
    height: number;
    /** Binary media lives in the asset store; elements only keep this stable reference. */
    assetId: string;
    mime: string;
    name: string;
};

export type ConnectionPoint = 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left' | 'top-left';

export type BindingAnchor = {
    x: number;
    y: number;
}; // normalized 0..1 position on a bound object's box


export type ArrowStyle = 'line' | 'dots' | 'arrow' | 'double' | 'dotted' | 'dashed';

export type ArrowCurveMode = 'smooth' | 'sharp';

export type ArrowRoutingMode = 'manual' | 'auto';

export type ArrowMode = 'connection' | 'branches';

export type ArrowTextTarget = 'label' | 'start' | 'end' | 'branch';

export type ArrowBranch = {
    id: string;
    root: 'start' | 'end';
    end: Point;
    controls?: Point[];
    pointCount?: 3 | 5;
    endBinding?: string;
    endBindingPoint?: ConnectionPoint;
    endBindingAnchor?: BindingAnchor;
    label?: string;
    labelDoc?: TextDocument;
    labelPosition?: number;
    labelSide?: -1 | 1;
    labelFontFamily?: string;
};

export type ArrowElement = BaseElement & {
    type: 'arrow' | 'connector';
    start: Point;
    /** Legacy middle point kept for backwards-compatible project files. */
    control: Point;
    /** Authored interior waypoints. Presets use one or three; direct editing may create arbitrary counts. */
    controls?: Point[];
    pointCount?: 3 | 5;
    end: Point;
    style: ArrowStyle;
    /** Smooth is the default professional connector geometry; sharp uses rigid segments. */
    curveMode?: ArrowCurveMode;
    /** Connection is the normal connector; branches enables mind-map leaves. */
    arrowMode?: ArrowMode;
    /** Manual preserves authored waypoints; Auto derives an obstacle-aware connection path. */
    routingMode?: ArrowRoutingMode;
    branches?: ArrowBranch[];
    opacity?: number;
    startBinding?: string;
    endBinding?: string;
    startBindingPoint?: ConnectionPoint;
    endBindingPoint?: ConnectionPoint;
    startBindingAnchor?: BindingAnchor;
    endBindingAnchor?: BindingAnchor;
    label?: string;
    labelDoc?: TextDocument;
    labelFontSize?: number;
    labelFontFamily?: string;
    /** Normalized distance along the whole connector path (0=start, 1=end). */
    labelPosition?: number;
    /** Stable visual side of the connector. -1 is the default "above" side. */
    labelSide?: -1 | 1;
    startLabel?: string;
    startLabelDoc?: TextDocument;
    startLabelFontFamily?: string;
    endLabel?: string;
    endLabelDoc?: TextDocument;
    endLabelFontFamily?: string;
};

export type TextElement = BaseElement & {
    type: 'text';
    x: number;
    y: number;
    text: string;
    textDoc?: TextDocument;
    fontSize: number;
    textScale?: number;
    textAlign?: TextAlign;
    /** Fixed wrapping width used when rendering committed text on the canvas. */
    textWidth?: number;
    fontFamily?: string;
};

export type CanvasElement = FreehandElement | RectangleElement | NoteElement | ArrowElement | TextElement | MediaElement;

/** First-class Layers tree node. Elements remain leaf objects; groups can nest via parentGroupId. */
export type LayerGroupNode = {
    id: string;
    name: string;
    parentGroupId?: string;
};

export type LayerClipboardPayload = {
    elements: CanvasElement[];
    layerGroups: LayerGroupNode[];
};

export type Bounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

// Interaction State
export type InteractionMode = 'none' | 'drawing' | 'moving' | 'resizing' | 'marquee' | 'panning' | 'arrow-start' | 'arrow-control' | 'arrow-end' | 'arrow-label-moving' | 'arrow-branch-control' | 'arrow-branch-end' | 'eraser-preview' | 'eraser-marquee';

// --- History ---
// History stores only changed document fields/insertions/removals/order. It never
// snapshots the whole board, so unchanged media payloads are not copied into
// every Undo/Redo entry.
export type ElementPropertyPatch = Record<string, unknown>;

export type HistoryElementPatch = {
    id: string;
    before: ElementPropertyPatch;
    after: ElementPropertyPatch;
};

export type HistoryIndexedElement = {
    index: number;
    element: CanvasElement;
};

export type HistoryEntry = {
    id: number;
    patches: HistoryElementPatch[];
    inserted: HistoryIndexedElement[];
    removed: HistoryIndexedElement[];
    orderBefore?: string[];
    orderAfter?: string[];
    /** Group hierarchy snapshots are stored only for transactions that change structure. */
    layerGroupsBefore?: LayerGroupNode[];
    layerGroupsAfter?: LayerGroupNode[];
};

/** Opaque token for one in-progress history transaction. */
export type HistoryTransactionToken = { readonly id: number };

// --- Project / persistence ---
export type ProjectSettings = {
    brushColor?: string;
    currentThickness?: number;
    arrowStyle?: ArrowStyle;
    arrowColor?: string;
    camera?: {
        x: number;
        y: number;
        zoom: number;
    };
    exportPngScale?: number;
};

export type ProjectAssetManifest = {
    id: string;
    path: string;
    mime: string;
    name: string;
    size: number;
};

export type ProjectFile = {
    format: 'my-board-project';
    /** Persisted document schema. v12 adds optional automatic connector routing while retaining v11 first-class Layer-group nodes. */
    schemaVersion: 12;
    /** ZIP container layout version; independent from the document schema. */
    archiveVersion: 1;
    name: string;
    savedAt: string;
    elements: CanvasElement[];
    layerGroups: LayerGroupNode[];
    assets: ProjectAssetManifest[];
    settings: ProjectSettings;
};

// --- Keyboard shortcuts ----------------------------------------------------
export type ShortcutId = 'newProject' | 'openProject' | 'saveProject' | 'saveProjectAs' | 'undo' | 'redo' | 'redoAlt' | 'selectAll' | 'group' | 'ungroup' | 'duplicate' | 'copy' | 'cut' | 'paste' | 'selectTool' | 'brushTool' | 'rectangleTool' | 'noteTool' | 'arrowTool' | 'quickConnect' | 'eraserTool' | 'handTool' | 'toggleLock' | 'bringForward' | 'sendBackward' | 'bringFront' | 'sendBack' | 'deleteSelection';

export type ShortcutDefinition = {
    id: ShortcutId;
    label: string;
    group: 'File' | 'Edit' | 'Tools' | 'Object';
    defaultBinding: string;
};

export type ConnectableElement = RectangleElement | NoteElement | MediaElement | TextElement;

export type ArrowPathLocation = {
    point: Point;
    tangent: Point;
    normal: Point;
    segmentIndex: number;
    pathPosition: number;
    distance: number;
    totalLength: number;
};

export type ArrowLabelLayout = {
    anchor: Point;
    tangent: Point;
    normal: Point;
    side: -1 | 1;
    textX: number;
    textBaselineY: number;
    textWidth: number;
    textHeight: number;
    box: Bounds;
    fontSize: number;
    renderScale: number;
    family: string;
    lines: RichLine[];
};

// --- 6. RICH TEXT EDITING ---
export type RichRun = {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    highlight?: string;
};

export type RichLine = {
    runs: RichRun[];
    listType?: 'bullet' | 'number' | 'check';
    listIndex?: number;
    numberPath?: number[];
    indent?: number;
    checked?: boolean;
    listContinuation?: boolean;
};

export type TextDocument = {
    version: 1;
    lines: RichLine[];
};

export type RichLayout = {
    lines: RichLine[];
    width: number;
    height: number;
    maxTokenWidth: number;
    firstLineFontSize: number;
    /** Runtime-only measured widths used to paint cached rich text without re-measuring each run. */
    lineWidths?: number[];
    runWidths?: number[][];
};
