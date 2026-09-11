// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { ARROW_COLOR_PALETTE, normalizeArrowCurveMode, normalizeArrowLabelFontSize, normalizeArrowRoutingMode, normalizeArrowStyle } from '../arrows/index';
import { setTool } from '../interactions/tools';
import { DEFAULT_TEXT_FONT_SIZE, FONT_OPTIONS, MIN_TEXT_SCALE, TEXT_COLOR_PALETTE, TEXT_SIZE_PRESETS, fontStack, getTextScale, normalizeFontFamily } from '../model/text';
import { ArrowCurveMode, ArrowElement, ArrowRoutingMode, ArrowStyle, FreehandElement, NoteElement, RectangleElement, ShapeStrokeStyle, TextElement } from '../model/types';
import { saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { resizeCanvasForHighDpi } from '../renderer/dpi';
import { NOTE_DEFAULT_FILL, NOTE_FILL_COLORS, RECTANGLE_FILL_COLORS, SOFT_STROKE_COLORS, getNoteFill, getRectangleFill, getRectanglePatternSpacing, getRectangleStrokeColor, getRectangleStrokeStyle, rectangleStrokeEnabled } from '../renderer/shapes';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { appState, dispatch } from '../state/store';
import { closeTextEditor, positionTextEditor, syncArrowLabelEditorPosition } from '../text-editor/index';
import { selectionContainsLocked } from './context-menu';
import { appDiv, canvas } from './dom';

export { TEXT_SIZE_PRESETS };

export function getSelectedTextElements(): Array<TextElement | NoteElement | RectangleElement> {
    return appState.elements.filter(el => appState.selectedIds.includes(el.id) && (el.type === 'text' || el.type === 'note' || el.type === 'rectangle')) as Array<TextElement | NoteElement | RectangleElement>;
}

export function getSelectedShapeElements(): Array<NoteElement | RectangleElement> {
    return appState.elements.filter(el => appState.selectedIds.includes(el.id) && (el.type === 'note' || el.type === 'rectangle')) as Array<NoteElement | RectangleElement>;
}

export function getSelectedRectangles(): RectangleElement[] {
    return appState.elements.filter(el => appState.selectedIds.includes(el.id) && el.type === 'rectangle') as RectangleElement[];
}

export function getSelectedArrowElements(): ArrowElement[] {
    return appState.elements.filter(el => appState.selectedIds.includes(el.id) && (el.type === 'arrow' || el.type === 'connector')) as ArrowElement[];
}

export function clampArrowOpacity(value: number | undefined) {
    const n = Number(value ?? 1);
    return Number.isFinite(n) ? Math.max(0.15, Math.min(1, n)) : 1;
}

export function updateBrushStylePanel() {
    const brushPanel = document.getElementById('brush-style-panel') as HTMLDivElement | null;
    if (!brushPanel)
        return;
    const slider = brushPanel.querySelector('#brush-stroke-slider') as HTMLInputElement | null;
    const value = brushPanel.querySelector('#brush-stroke-value') as HTMLSpanElement | null;
    const preview = brushPanel.querySelector('#brush-stroke-preview') as HTMLSpanElement | null;
    if (slider)
        slider.value = String(appState.currentThickness);
    if (value)
        value.textContent = `${appState.currentThickness}px`;
    if (preview) {
        preview.style.height = `${Math.max(2, appState.currentThickness * 2.2)}px`;
        preview.style.background = appState.brushColor;
    }
    brushPanel.querySelectorAll<HTMLButtonElement>('[data-brush-thickness]').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.brushThickness) === appState.currentThickness);
    });
    brushPanel.querySelectorAll<HTMLButtonElement>('[data-brush-color]').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.brushColor || '').toLowerCase() === appState.brushColor.toLowerCase());
    });
}

export function updateArrowStylePanel() { updateTextStylePanel(); }

export function updateTextStylePanel() {
    const panel = document.getElementById('inspector-panel') as HTMLDivElement | null;
    const textPanel = document.getElementById('text-style-panel') as HTMLDivElement | null;
    const shapePanel = document.getElementById('shape-style-panel') as HTMLDivElement | null;
    const rectangleStrokePanel = document.getElementById('rectangle-stroke-panel') as HTMLDivElement | null;
    const arrowPanel = document.getElementById('arrow-style-panel') as HTMLDivElement | null;
    const brushPanel = document.getElementById('brush-style-panel') as HTMLDivElement | null;
    const targets = getSelectedTextElements();
    const shapeTargets = getSelectedShapeElements();
    const rectangleTargets = getSelectedRectangles();
    const arrowTargets = getSelectedArrowElements();
    if (!panel || !textPanel || !shapePanel || !rectangleStrokePanel || !arrowPanel || !brushPanel)
        return;
    panel.classList.toggle('locked-selection', selectionContainsLocked());
    const selectedFreehand = appState.elements.filter(el => appState.selectedIds.includes(el.id) && el.type === 'freehand') as FreehandElement[];
    const showText = targets.length > 0 && !arrowTargets.length && !selectedFreehand.length;
    const showShape = shapeTargets.length > 0 && !arrowTargets.length && !selectedFreehand.length;
    const showRectangleStroke = rectangleTargets.length > 0 && shapeTargets.length === rectangleTargets.length;
    const showArrow = arrowTargets.length > 0;
    const showBrush = appState.activeTool === 'pencil' || (!showText && !showArrow && selectedFreehand.length > 0);
    textPanel.hidden = !showText;
    shapePanel.hidden = !showShape;
    rectangleStrokePanel.hidden = !showRectangleStroke;
    arrowPanel.hidden = !showArrow;
    brushPanel.hidden = !showBrush;
    panel.classList.toggle('has-content', showText || showShape || showArrow || showBrush);
    const empty = panel.querySelector<HTMLElement>('#inspector-empty');
    if (empty) {
        empty.hidden = showText || showShape || showArrow || showBrush;
        if (!showText && !showShape && !showArrow && !showBrush)
            empty.textContent = 'Select an object or choose a tool to edit its properties';
    }
    if (showBrush) {
        const source = selectedFreehand[0];
        if (source) {
            dispatch({ type: 'SET_PREFERENCES', patch: { currentThickness: source.thickness, brushColor: source.color } });
        }
        updateBrushStylePanel();
    }
    if (showShape) {
        const first = shapeTargets[0];
        const fill = first.type === 'note' ? getNoteFill(first) : (getRectangleFill(first) || 'none');
        const allowedFills = new Set((first.type === 'note' ? NOTE_FILL_COLORS : RECTANGLE_FILL_COLORS).map(c => c.value.toLowerCase()));
        shapePanel.querySelectorAll<HTMLButtonElement>('[data-shape-fill]').forEach(btn => {
            const value = btn.dataset.shapeFill || '';
            const isNone = value === 'none';
            btn.hidden = isNone ? first.type === 'note' : !allowedFills.has(value.toLowerCase());
            btn.classList.toggle('active', value.toLowerCase() === fill.toLowerCase());
        });
        const centered = first.textAlign === 'center' && first.textVerticalAlign === 'middle';
        shapePanel.querySelectorAll<HTMLButtonElement>('[data-shape-text-position]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.shapeTextPosition === (centered ? 'center' : 'top-left'));
        });
    }
    if (showRectangleStroke) {
        const first = rectangleTargets[0];
        const enabled = rectangleStrokeEnabled(first);
        rectangleStrokePanel.classList.toggle('stroke-off', !enabled);
        rectangleStrokePanel.querySelectorAll<HTMLButtonElement>('[data-rectangle-stroke-enabled]').forEach(btn => btn.classList.toggle('active', (btn.dataset.rectangleStrokeEnabled === 'true') === enabled));
        const strokeStyle = getRectangleStrokeStyle(first);
        rectangleStrokePanel.querySelectorAll<HTMLButtonElement>('[data-rectangle-stroke-style]').forEach(btn => btn.classList.toggle('active', btn.dataset.rectangleStrokeStyle === strokeStyle));
        const patternSlider = rectangleStrokePanel.querySelector<HTMLInputElement>('#rectangle-pattern-spacing');
        const patternSpacing = getRectanglePatternSpacing(first);
        if (patternSlider)
            patternSlider.value = String(patternSpacing);
        updateRectanglePatternSpacingLabel(patternSpacing);
        rectangleStrokePanel.classList.toggle('pattern-solid', strokeStyle === 'solid');
        const strokeValue = getRectangleStrokeColor(first);
        rectangleStrokePanel.querySelectorAll<HTMLButtonElement>('[data-rectangle-stroke-color]').forEach(btn => btn.classList.toggle('active', (btn.dataset.rectangleStrokeColor || '').toLowerCase() === strokeValue.toLowerCase()));
    }
    if (showText) {
        const first = targets[0];
        const px = DEFAULT_TEXT_FONT_SIZE * getTextScale(first);
        let sizeLabel = '';
        for (const [label, size] of Object.entries(TEXT_SIZE_PRESETS)) {
            if (Math.abs(px - size) < 0.5) {
                sizeLabel = label;
                break;
            }
        }
        textPanel.querySelectorAll<HTMLButtonElement>('[data-text-size]').forEach(b => b.classList.toggle('active', b.dataset.textSize === sizeLabel));
        const family = normalizeFontFamily(first.fontFamily);
        textPanel.querySelectorAll<HTMLButtonElement>('[data-font-family]').forEach(b => b.classList.toggle('active', b.dataset.fontFamily === family));
    }
    if (showArrow) {
        const first = arrowTargets[0];
        dispatch({ type: 'SET_PREFERENCES', patch: { arrowColor: first.color || '#111827' } });
        arrowPanel.querySelectorAll<HTMLButtonElement>('[data-selected-arrow-style]').forEach(b => b.classList.toggle('active', b.dataset.selectedArrowStyle === normalizeArrowStyle(first.style)));
        arrowPanel.querySelectorAll<HTMLButtonElement>('[data-arrow-curve-mode]').forEach(b => b.classList.toggle('active', b.dataset.arrowCurveMode === normalizeArrowCurveMode(first.curveMode)));
        arrowPanel.querySelectorAll<HTMLButtonElement>('[data-arrow-routing-mode]').forEach(b => {
            b.classList.toggle('active', b.dataset.arrowRoutingMode === normalizeArrowRoutingMode(first.routingMode));
            b.disabled = b.dataset.arrowRoutingMode === 'auto' && first.arrowMode === 'branches';
        });
        const labelFontSize = normalizeArrowLabelFontSize(first.labelFontSize);
        let labelSizePreset = '';
        for (const [label, size] of Object.entries(TEXT_SIZE_PRESETS)) {
            if (Math.abs(labelFontSize - size) < 0.5) { labelSizePreset = label; break; }
        }
        arrowPanel.querySelectorAll<HTMLButtonElement>('[data-arrow-label-size]').forEach(b => b.classList.toggle('active', b.dataset.arrowLabelSize === labelSizePreset));
        arrowPanel.querySelectorAll<HTMLButtonElement>('[data-arrow-thickness]').forEach(b => b.classList.toggle('active', Math.abs(Number(b.dataset.arrowThickness) - first.thickness) < 0.01));
        arrowPanel.querySelectorAll<HTMLButtonElement>('[data-arrow-color]').forEach(b => b.classList.toggle('active', (b.dataset.arrowColor || '').toLowerCase() === (first.color || '#111827').toLowerCase()));
    }
    positionInspectorPanel();
}

export function applyShapeFill(value: string) {
    const targets = getSelectedShapeElements();
    if (!targets.length)
        return;
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_ELEMENTS', ids: targets.map(el => el.id), update: el => {
        if (el.type === 'note') el.fillColor = value === 'none' ? NOTE_DEFAULT_FILL : value;
        else if (el.type === 'rectangle') el.fillColor = value === 'none' ? undefined : value;
    } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applyRectangleStrokeEnabled(enabled: boolean) {
    const targets = getSelectedRectangles();
    if (!targets.length)
        return;
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { strokeEnabled: enabled } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applyRectangleStrokeStyle(style: ShapeStrokeStyle) {
    const targets = getSelectedRectangles();
    if (!targets.length)
        return;
    const next: ShapeStrokeStyle = style === 'dotted' || style === 'dashed' ? style : 'solid';
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_ELEMENTS', ids: targets.map(el => el.id), update: el => { if (el.type === 'rectangle') { el.strokeStyle = next; if (el.strokePatternSpacing === undefined) el.strokePatternSpacing = 1; } } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function rectanglePatternSpacingLabel(value: number): string {
    const n = Math.max(.55, Math.min(2, Number(value) || 1));
    if (n < .75)
        return 'Very dense';
    if (n < .92)
        return 'Dense';
    if (n <= 1.12)
        return 'Normal';
    if (n < 1.5)
        return 'Loose';
    return 'Sparse';
}

export function updateRectanglePatternSpacingLabel(value: number) {
    const label = document.getElementById('rectangle-pattern-spacing-value');
    if (label)
        label.textContent = rectanglePatternSpacingLabel(value);
}

export function applyRectanglePatternSpacing(value: number) {
    const targets = getSelectedRectangles();
    if (!targets.length)
        return;
    const next = Math.max(.55, Math.min(2, Number(value) || 1));
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { strokePatternSpacing: next } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applyRectangleStrokeColor(value: string) {
    const targets = getSelectedRectangles();
    if (!targets.length)
        return;
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { strokeColor: value } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applyShapeTextPosition(position: 'top-left' | 'center') {
    const targets = getSelectedShapeElements();
    if (!targets.length) return;
    const before = beginHistoryTransaction();
    dispatch({
        type: 'UPDATE_STYLE',
        ids: targets.map(el => el.id),
        patch: position === 'center'
            ? { textAlign: 'center', textVerticalAlign: 'middle' }
            : { textAlign: 'left', textVerticalAlign: 'top' },
    });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applyTextSizePreset(label: string) {
    const targets = getSelectedTextElements();
    if (!targets.length)
        return;
    const next = TEXT_SIZE_PRESETS[label as keyof typeof TEXT_SIZE_PRESETS] ?? DEFAULT_TEXT_FONT_SIZE;
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { fontSize: DEFAULT_TEXT_FONT_SIZE, textScale: Math.max(MIN_TEXT_SCALE, next / DEFAULT_TEXT_FONT_SIZE) } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applySelectedArrowLabelSizePreset(label: string) {
    const targets = getSelectedArrowElements();
    if (!targets.length)
        return;
    const next = TEXT_SIZE_PRESETS[label as keyof typeof TEXT_SIZE_PRESETS] ?? TEXT_SIZE_PRESETS.S;
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_ELEMENTS', ids: targets.map(el => el.id), update: el => {
        if (el.type === 'arrow' || el.type === 'connector') el.labelFontSize = next;
    } });
    const editingMainLabel = !!appState.textEditorContent
        && !!appState.editingTextId
        && targets.some(el => el.id === appState.editingTextId)
        && (appState.editingArrowTextTarget?.kind ?? 'label') === 'label';
    if (editingMainLabel && appState.textEditorContent) {
        appState.textEditorContent.dataset.baseFontSize = String(next);
        appState.textEditorContent.dataset.renderScale = String(next / DEFAULT_TEXT_FONT_SIZE);
        appState.textEditorContent.style.fontSize = `${next}px`;
        syncArrowLabelEditorPosition();
        positionTextEditor();
    }
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applySelectedFontFamily(family: string) {
    const targets = getSelectedTextElements();
    if (!targets.length)
        return;
    const before = beginHistoryTransaction();
    const next = normalizeFontFamily(family);
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { fontFamily: next } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applySelectedArrowStyle(style: ArrowStyle) {
    const targets = getSelectedArrowElements();
    if (!targets.length)
        return;
    const next = normalizeArrowStyle(style);
    dispatch({ type: 'SET_PREFERENCES', patch: { arrowStyle: next } });
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { style: next } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applySelectedArrowCurveMode(mode: ArrowCurveMode) {
    const targets = getSelectedArrowElements();
    if (!targets.length)
        return;
    const next = normalizeArrowCurveMode(mode);
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { curveMode: next } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applySelectedArrowRoutingMode(mode: ArrowRoutingMode) {
    const targets = getSelectedArrowElements().filter(el => el.arrowMode !== 'branches');
    if (!targets.length)
        return;
    const next = normalizeArrowRoutingMode(mode);
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { routingMode: next } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applySelectedArrowThickness(thickness: number) {
    const targets = getSelectedArrowElements();
    if (!targets.length)
        return;
    const next = Math.max(1, Math.min(12, thickness));
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { thickness: next } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function applySelectedArrowColor(color: string) {
    const allowed = new Set(ARROW_COLOR_PALETTE.map(c => c.value.toLowerCase()));
    const next = allowed.has(String(color).toLowerCase()) ? color : '#111827';
    const targets = getSelectedArrowElements();
    dispatch({ type: 'SET_PREFERENCES', patch: { arrowColor: next } });
    if (!targets.length) {
        updateTextStylePanel();
        return;
    }
    const before = beginHistoryTransaction();
    dispatch({ type: 'UPDATE_STYLE', ids: targets.map(el => el.id), patch: { color: next } });
    saveToLocal();
    commitHistory(before);
    redraw();
    updateTextStylePanel();
}

export function enablePanelDrag(panel: HTMLElement, handle: HTMLElement | null) {
    if (!handle)
        return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    const onMove = (e: PointerEvent) => {
        if (!dragging)
            return;
        e.preventDefault();
        const rect = panel.getBoundingClientRect();
        const width = rect.width, height = rect.height;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, originLeft + (e.clientX - startX)));
        const top = Math.max(8, Math.min(window.innerHeight - height - 8, originTop + (e.clientY - startY)));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.dataset.userPositioned = '1';
    };
    const stop = () => { if (!dragging)
        return; dragging = false; handle.classList.remove('dragging'); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', stop); document.body.classList.remove('panel-dragging'); };
    handle.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        originLeft = rect.left;
        originTop = rect.top;
        dragging = true;
        handle.classList.add('dragging');
        document.body.classList.add('panel-dragging');
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', stop, { once: false });
    });
}

export function clampFloatingPanelToViewport(panel: HTMLElement, margin = 8) {
    const rect = panel.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(Math.max(margin, rect.left), maxLeft);
    const top = Math.min(Math.max(margin, rect.top), maxTop);
    const outside = rect.left < margin || rect.top < margin || rect.right > window.innerWidth - margin || rect.bottom > window.innerHeight - margin;
    if (!outside) return;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
}

export function positionInspectorPanel() {
    if (!appState.inspectorPopover)
        return;
    if (!appState.inspectorPopover.dataset.userPositioned) {
        appState.inspectorPopover.style.top = '228px';
        appState.inspectorPopover.style.right = '18px';
        appState.inspectorPopover.style.left = 'auto';
        appState.inspectorPopover.style.bottom = 'auto';
    }
    // A panel manually positioned while the window is maximized can otherwise
    // remain outside the smaller restored viewport. Clamp on every resize while
    // preserving the user's location whenever it is still visible.
    clampFloatingPanelToViewport(appState.inspectorPopover);
}

export function closeInspectorPopover() {
    appState.inspectorPopover?.remove();
    dispatch({ type: 'SET_UI', patch: { inspectorPopover: null } });
}

export function showInspectorPopover() {
    if (appState.inspectorPopover)
        return;
    const inspectorPopover = document.createElement('div');
    dispatch({ type: 'SET_UI', patch: { inspectorPopover } });
    inspectorPopover.className = 'inspector-popover';
    inspectorPopover.id = 'inspector-panel';
    inspectorPopover.innerHTML = `
      <div class="inspector-header">
      <div class="inspector-title">Properties</div>
      <div class="inspector-actions">
        <button class="panel-drag-handle" id="inspector-drag" type="button" aria-label="Move properties panel" title="Hold to move panel">
          <svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1.1"/><circle cx="9" cy="3" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="9" cy="8" r="1.1"/><circle cx="3" cy="13" r="1.1"/><circle cx="9" cy="13" r="1.1"/></svg>
        </button>
        <button class="inspector-collapse-btn" id="btn-inspector-collapse" type="button" aria-expanded="true" aria-label="Collapse properties panel" title="Collapse properties panel">
          <span class="panel-toggle-chevron" aria-hidden="true">−</span>
          <span class="panel-collapsed-icon panel-icon-properties" aria-hidden="true"></span>
        </button>
      </div>
    </div>    <div class="inspector-content">
      <div class="shape-style-panel" id="shape-style-panel" hidden>
        <div class="text-style-section">
          <div class="text-style-section-title">Fill</div>
          <div class="shape-fill-grid">
            <button type="button" class="shape-color-chip no-fill" data-shape-fill="none" title="No fill" aria-label="No fill"><span></span></button>
            ${NOTE_FILL_COLORS.map(c => `<button type="button" class="shape-color-chip" data-shape-fill="${c.value}" title="${c.name}" aria-label="${c.name}" style="--shape-chip:${c.value}"><span></span></button>`).join('')}
          </div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Text position</div>
          <div class="shape-segmented">
            <button type="button" data-shape-text-position="top-left" title="Align text to the padded top-left">Top left</button>
            <button type="button" data-shape-text-position="center" title="Center text horizontally and vertically">Center</button>
          </div>
        </div>
        <div class="rectangle-stroke-panel" id="rectangle-stroke-panel" hidden>
          <div class="text-style-section">
            <div class="text-style-section-title">Stroke</div>
            <div class="shape-segmented">
              <button type="button" data-rectangle-stroke-enabled="true">On</button>
              <button type="button" data-rectangle-stroke-enabled="false">Off</button>
            </div>
          </div>
          <div class="text-style-section rectangle-stroke-options">
            <div class="text-style-section-title">Line style</div>
            <div class="shape-segmented shape-segmented-3">
              <button type="button" data-rectangle-stroke-style="solid"><span class="shape-line-preview solid"></span>Solid</button>
              <button type="button" data-rectangle-stroke-style="dotted"><span class="shape-line-preview dotted"></span>Dotted</button>
              <button type="button" data-rectangle-stroke-style="dashed"><span class="shape-line-preview dashed"></span>Dashed</button>
            </div>
          </div>
          <div class="text-style-section rectangle-stroke-options rectangle-pattern-options">
            <div class="text-style-section-title">Pattern spacing <span id="rectangle-pattern-spacing-value">Normal</span></div>
            <input id="rectangle-pattern-spacing" class="shape-pattern-slider" type="range" min="0.55" max="2" step="0.05" value="1" aria-label="Rectangle dot or dash spacing">
            <div class="shape-pattern-scale" aria-hidden="true"><span>Dense</span><span>Normal</span><span>Sparse</span></div>
          </div>
          <div class="text-style-section rectangle-stroke-options">
            <div class="text-style-section-title">Stroke color</div>
            <div class="shape-stroke-color-grid">
              ${SOFT_STROKE_COLORS.map(c => `<button type="button" class="shape-stroke-chip" data-rectangle-stroke-color="${c.value}" title="${c.name}" aria-label="${c.name}" style="--stroke-chip:${c.value}"><span></span></button>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="text-style-panel" id="text-style-panel" hidden>
        <div class="text-style-section">
          <div class="text-style-section-title">Text size</div>
          <div class="text-size-row">${Object.keys(TEXT_SIZE_PRESETS).map(label => `<button type="button" class="text-size-btn" data-text-size="${label}">${label}</button>`).join('')}</div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Font</div>
          <div class="text-font-grid">${FONT_OPTIONS.map(f => `<button type="button" class="text-font-btn" data-font-family="${f.value}" style="font-family:${fontStack(f.value)}">${f.name}</button>`).join('')}</div>
        </div>
      </div>
      <div class="brush-style-panel" id="brush-style-panel" hidden>
        <div class="text-style-section">
          <div class="text-style-section-title">Stroke</div>
          <div class="brush-stroke-preview-row">
            <span class="brush-stroke-preview-track"><span id="brush-stroke-preview"></span></span>
            <span id="brush-stroke-value" class="brush-stroke-value"></span>
          </div>
          <input id="brush-stroke-slider" class="brush-stroke-slider" type="range" min="1" max="12" step="1" value="${appState.currentThickness}" aria-label="Brush stroke size">
          <div class="brush-stroke-presets">
            ${[1, 2, 3, 5, 8].map(v => `<button type="button" class="brush-stroke-preset" data-brush-thickness="${v}" title="${v}px"><span style="height:${Math.max(2, v)}px"></span></button>`).join('')}
          </div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Color</div>
          <div class="brush-color-grid">
            ${TEXT_COLOR_PALETTE.map(c => `<button type="button" class="brush-color-chip" data-brush-color="${c.value}" title="${c.name}" aria-label="Brush color: ${c.name}" style="--brush-chip:${c.value}"><span></span></button>`).join('')}
          </div>
        </div>
      </div>
      <div class="arrow-style-panel" id="arrow-style-panel" hidden>
        <div class="text-style-section">
          <div class="text-style-section-title">Label size</div>
          <div class="text-size-row">${Object.keys(TEXT_SIZE_PRESETS).map(label => `<button type="button" class="text-size-btn" data-arrow-label-size="${label}">${label}</button>`).join('')}</div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Routing</div>
          <div class="shape-segmented arrow-routing-toggle">
            <button type="button" data-arrow-routing-mode="manual" title="Use authored connector waypoints">Manual</button>
            <button type="button" data-arrow-routing-mode="auto" title="Automatically route around board objects">Auto</button>
          </div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Curve</div>
          <div class="shape-segmented arrow-curve-toggle">
            <button type="button" data-arrow-curve-mode="smooth" title="Smooth curved connection">Smooth</button>
            <button type="button" data-arrow-curve-mode="sharp" title="Sharp rigid corners">Sharp</button>
          </div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Arrow style</div>
          <div class="arrow-type-grid">
            <button type="button" class="arrow-type-btn" data-selected-arrow-style="line">${arrowStyleIconSvg('line')}<span>Line</span></button>
            <button type="button" class="arrow-type-btn" data-selected-arrow-style="dots">${arrowStyleIconSvg('dots')}<span>Dots</span></button>
            <button type="button" class="arrow-type-btn" data-selected-arrow-style="arrow">${arrowStyleIconSvg('arrow')}<span>Arrow</span></button>
            <button type="button" class="arrow-type-btn" data-selected-arrow-style="double">${arrowStyleIconSvg('double')}<span>Double</span></button>
            <button type="button" class="arrow-type-btn" data-selected-arrow-style="dotted">${arrowStyleIconSvg('dotted')}<span>Dotted</span></button>
            <button type="button" class="arrow-type-btn" data-selected-arrow-style="dashed">${arrowStyleIconSvg('dashed')}<span>Dashed</span></button>
          </div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Color</div>
          <div class="arrow-color-grid">
            ${ARROW_COLOR_PALETTE.map(c => `<button type="button" class="arrow-color-chip" data-arrow-color="${c.value}" title="${c.name}" aria-label="Arrow color: ${c.name}" style="--arrow-chip:${c.value}"><span></span></button>`).join('')}
          </div>
        </div>
        <div class="text-style-section">
          <div class="text-style-section-title">Weight</div>
          <div class="arrow-weight-row">${[1, 2, 3, 5, 8].map(v => `<button type="button" class="arrow-weight-btn" data-arrow-thickness="${v}" title="${v}px"><span style="height:${Math.max(2, v)}px"></span></button>`).join('')}</div>
        </div>
        <div class="arrow-gesture-hint">Double-click path: add waypoint · Alt-click waypoint: remove · Shift-double-click path: label</div>
      </div>
      <div class="inspector-empty" id="inspector-empty">Select a text, note, shape, or arrow</div>
    </div>`;
    appDiv.appendChild(inspectorPopover);
    inspectorPopover.style.right = '18px';
    enablePanelDrag(inspectorPopover, inspectorPopover.querySelector('#inspector-drag') as HTMLElement);
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-text-size]').forEach(btn => btn.addEventListener('click', () => applyTextSizePreset(btn.dataset.textSize!)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-font-family]').forEach(btn => btn.addEventListener('click', () => applySelectedFontFamily(btn.dataset.fontFamily!)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-shape-fill]').forEach(btn => btn.addEventListener('click', () => applyShapeFill(btn.dataset.shapeFill!)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-shape-text-position]').forEach(btn => btn.addEventListener('click', () => applyShapeTextPosition(btn.dataset.shapeTextPosition as 'top-left' | 'center')));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-rectangle-stroke-enabled]').forEach(btn => btn.addEventListener('click', () => applyRectangleStrokeEnabled(btn.dataset.rectangleStrokeEnabled === 'true')));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-rectangle-stroke-style]').forEach(btn => btn.addEventListener('click', () => applyRectangleStrokeStyle(btn.dataset.rectangleStrokeStyle as ShapeStrokeStyle)));
    inspectorPopover.querySelector<HTMLInputElement>('#rectangle-pattern-spacing')?.addEventListener('input', e => {
        updateRectanglePatternSpacingLabel(Number((e.target as HTMLInputElement).value));
    });
    inspectorPopover.querySelector<HTMLInputElement>('#rectangle-pattern-spacing')?.addEventListener('change', e => {
        applyRectanglePatternSpacing(Number((e.target as HTMLInputElement).value));
    });
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-rectangle-stroke-color]').forEach(btn => btn.addEventListener('click', () => applyRectangleStrokeColor(btn.dataset.rectangleStrokeColor!)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-selected-arrow-style]').forEach(btn => btn.addEventListener('click', () => applySelectedArrowStyle(btn.dataset.selectedArrowStyle as ArrowStyle)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-arrow-curve-mode]').forEach(btn => btn.addEventListener('click', () => applySelectedArrowCurveMode(btn.dataset.arrowCurveMode as ArrowCurveMode)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-arrow-routing-mode]').forEach(btn => btn.addEventListener('click', () => applySelectedArrowRoutingMode(btn.dataset.arrowRoutingMode as ArrowRoutingMode)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-arrow-label-size]').forEach(btn => btn.addEventListener('click', () => applySelectedArrowLabelSizePreset(btn.dataset.arrowLabelSize!)));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-arrow-thickness]').forEach(btn => btn.addEventListener('click', () => applySelectedArrowThickness(Number(btn.dataset.arrowThickness))));
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-arrow-color]').forEach(btn => btn.addEventListener('click', () => applySelectedArrowColor(btn.dataset.arrowColor!)));
    inspectorPopover.querySelector('#brush-stroke-slider')?.addEventListener('input', e => {
        dispatch({ type: 'SET_PREFERENCES', patch: { currentThickness: Number((e.target as HTMLInputElement).value) } });
        updateBrushStylePanel();
    });
    inspectorPopover.querySelector('#brush-stroke-slider')?.addEventListener('change', e => {
        applyStrokeSize(Number((e.target as HTMLInputElement).value));
    });
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-brush-thickness]').forEach(btn => {
        btn.addEventListener('click', () => applyStrokeSize(Number(btn.dataset.brushThickness)));
    });
    inspectorPopover.querySelectorAll<HTMLButtonElement>('[data-brush-color]').forEach(btn => {
        btn.addEventListener('click', () => applyBrushColor(btn.dataset.brushColor!));
    });
    inspectorPopover.querySelector('#btn-inspector-collapse')?.addEventListener('click', e => {
        e.stopPropagation();
        const collapsed = inspectorPopover!.classList.toggle('collapsed');
        const btn = inspectorPopover!.querySelector('#btn-inspector-collapse') as HTMLButtonElement | null;
        btn?.setAttribute('aria-expanded', String(!collapsed));
        btn?.setAttribute('aria-label', collapsed ? 'Expand properties panel' : 'Collapse properties panel');
        btn?.setAttribute('title', collapsed ? 'Expand properties panel' : 'Collapse properties panel');
        btn?.querySelector('.panel-toggle-chevron')?.classList.toggle('visible-when-expanded', !collapsed);
        btn?.querySelector('.panel-collapsed-icon')?.classList.toggle('visible-when-collapsed', collapsed);
        positionInspectorPanel();
    });
    updateTextStylePanel();
}

export function closeArrowPopover() {
    appState.arrowPopover?.remove();
    dispatch({ type: 'SET_UI', patch: { arrowPopover: null } });
}

export function arrowStyleIconSvg(style: ArrowStyle): string {
    const common = 'viewBox="0 0 48 16" aria-hidden="true" class="arrow-style-svg"';
    if (style === 'dots') return `<svg ${common}><line x1="7" y1="8" x2="41" y2="8"/><circle cx="7" cy="8" r="2.4"/><circle cx="41" cy="8" r="2.4"/></svg>`;
    if (style === 'double') return `<svg ${common}><line x1="7" y1="8" x2="41" y2="8"/><path d="M12 3 7 8l5 5M36 3l5 5-5 5"/></svg>`;
    if (style === 'arrow') return `<svg ${common}><line x1="5" y1="8" x2="41" y2="8"/><path d="m35 3 6 5-6 5"/></svg>`;
    if (style === 'dotted') return `<svg ${common}><line class="dotted" x1="5" y1="8" x2="43" y2="8"/></svg>`;
    if (style === 'dashed') return `<svg ${common}><line class="dashed" x1="5" y1="8" x2="43" y2="8"/></svg>`;
    return `<svg ${common}><line x1="5" y1="8" x2="43" y2="8"/></svg>`;
}

export function arrowStyleLabel(style: ArrowStyle) {
    const normalized = normalizeArrowStyle(style);
    return normalized === 'line' ? 'Line' : normalized === 'dots' ? 'Dots' : normalized === 'arrow' ? 'Arrow' : normalized === 'double' ? 'Double' : normalized === 'dotted' ? 'Dotted' : 'Dashed';
}

export function updateArrowToolUI() {
    const btn = document.getElementById('tool-arrow');
    if (btn)
        btn.setAttribute('aria-label', `Arrow (A) · ${arrowStyleLabel(appState.arrowStyle)}`);
    appState.arrowPopover?.querySelectorAll<HTMLButtonElement>('[data-arrow-style]').forEach(b => b.classList.toggle('selected', b.dataset.arrowStyle === appState.arrowStyle));
}

export function showArrowPopover() {
    if (appState.arrowPopover) {
        updateArrowToolUI();
        return;
    }
    const arrowPopover = document.createElement('div');
    dispatch({ type: 'SET_UI', patch: { arrowPopover } });
    arrowPopover.className = 'arrow-popover';
    arrowPopover.innerHTML = `
    <div class="arrow-popover-title">Arrow style</div>
    <div class="arrow-style-grid arrow-style-grid-3">
      <button type="button" data-arrow-style="line" class="arrow-style-option">${arrowStyleIconSvg('line')}<span>Line</span></button>
      <button type="button" data-arrow-style="dots" class="arrow-style-option">${arrowStyleIconSvg('dots')}<span>Dots</span></button>
      <button type="button" data-arrow-style="arrow" class="arrow-style-option">${arrowStyleIconSvg('arrow')}<span>Arrow</span></button>
      <button type="button" data-arrow-style="double" class="arrow-style-option">${arrowStyleIconSvg('double')}<span>Double</span></button>
      <button type="button" data-arrow-style="dotted" class="arrow-style-option">${arrowStyleIconSvg('dotted')}<span>Dotted</span></button>
      <button type="button" data-arrow-style="dashed" class="arrow-style-option">${arrowStyleIconSvg('dashed')}<span>Dashed</span></button>
    </div>`;
    appDiv.appendChild(arrowPopover);
    const anchor = (document.getElementById('tool-arrow') as HTMLElement).getBoundingClientRect();
    arrowPopover.style.left = `${Math.max(8, anchor.left - 8)}px`;
    arrowPopover.style.bottom = `${Math.max(70, window.innerHeight - anchor.top + 10)}px`;
    arrowPopover.querySelectorAll<HTMLButtonElement>('[data-arrow-style]').forEach(btn => btn.addEventListener('click', () => {
        dispatch({ type: 'SET_PREFERENCES', patch: { arrowStyle: normalizeArrowStyle(btn.dataset.arrowStyle) } });
        setTool('arrow');
        updateArrowToolUI();
    }));
    updateArrowToolUI();
}

export function applyStrokeSize(size: number) {
    const next = Math.max(1, Math.min(12, Math.round(size * 10) / 10));
    const before = beginHistoryTransaction();
    dispatch({ type: 'SET_PREFERENCES', patch: { currentThickness: next } });
    const ids = appState.elements.filter(el => appState.selectedIds.includes(el.id) && el.type === 'freehand' && el.thickness !== next).map(el => el.id);
    if (ids.length) {
        dispatch({ type: 'UPDATE_STYLE', ids, patch: { thickness: next } });
        saveToLocal();
        commitHistory(before);
    }
    redraw();
    updateBrushStylePanel();
}

export function applyBrushColor(color: string) {
    const next = TEXT_COLOR_PALETTE.some(c => c.value.toLowerCase() === color.toLowerCase()) ? color : '#111827';
    const before = beginHistoryTransaction();
    dispatch({ type: 'SET_PREFERENCES', patch: { brushColor: next } });
    const ids = appState.elements.filter(el => appState.selectedIds.includes(el.id) && el.type === 'freehand' && el.color !== next).map(el => el.id);
    if (ids.length) {
        dispatch({ type: 'UPDATE_STYLE', ids, patch: { color: next } });
        saveToLocal();
        commitHistory(before);
    }
    redraw();
    updateBrushStylePanel();
}

export function syncHistoryBarPosition() {
    if (!appState.historyBar)
        return;
    const selectBtn = document.getElementById('tool-select') as HTMLElement | null;
    if (!selectBtn)
        return;
    appState.historyBar.style.left = `${Math.round(selectBtn.getBoundingClientRect().left)}px`;
    appState.historyBar.style.transform = 'none';
}

export function resetView() {
    if (appState.textEditor)
        closeTextEditor(true);
    dispatch({ type: 'SET_CAMERA', camera: { x: 0, y: 0, zoom: 1 } });
    syncHistoryBarPosition();
    redraw();
}

export function resize() {
    dispatch({ type: 'SET_INTERACTION', patch: { moveBackgroundCanvas: null, moveSelectionCanvas: null } });
    resizeCanvasForHighDpi(canvas);
    syncHistoryBarPosition();
    positionInspectorPanel();
    // Native maximize/restore can deliver a resize before the webview has
    // completed its final layout. Re-clamp once on the next visual frame too.
    requestAnimationFrame(positionInspectorPanel);
    redraw();
}

window.addEventListener('resize', resize);
