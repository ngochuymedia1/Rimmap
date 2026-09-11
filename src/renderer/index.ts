// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { getMediaImage } from '../media/assets';
import { ARROW_LABEL_BG, ARROW_LABEL_RADIUS, ARROW_LABEL_TEXT_COLOR, getArrowLabelLayout, getBranchLabelLayout, getEndpointLabelLayout, normalizeArrowStyle } from '../arrows/index';
import { arrowMode, getArrowBranchPathPoints, getArrowBranchRenderPoints, getArrowBranches, getArrowLabelCollisionBounds, getArrowPathPoints, getArrowRenderPoints, getBoundingBox, getConnectionPoints, getFreehandPath, getGroupBoundingBox, getSpatialIndexBounds, getResizeHandles, isArrowAffectedByLiveMove, isArrowAutoRouted, isConnectableShape, normalizedBounds, rectsIntersect } from '../model/geometry';
import { DEFAULT_TEXT_FONT_SIZE, TEXT_PAD_X, TEXT_PAD_Y, fontStack, getTextScale, normalizeFontSize } from '../model/text';
import { ArrowElement, ArrowLabelLayout, ArrowTextTarget, Bounds, CanvasElement, ConnectableElement, ConnectionPoint, NoteElement, Point, RectangleElement, RichLayout, RichLine, RichRun, TextAlign, TextElement } from '../model/types';
import { drawNoteSurface, drawRectangleSurface } from './shapes';
import { appState, dispatch } from '../state/store';
import { LIST_BULLET_SCALE, LIST_MARKER_GAP, LIST_NUMBER_SCALE, RICH_TEXT_LINE_HEIGHT, canonicalLines, cloneRichLines, richLineContentIndent, richLineListMarker, scaleRichLines, textDocumentFromHtml } from '../model/text-document';
import { selectionContainsLocked } from '../ui/context-menu';
import { canvas, ctx } from '../ui/dom';
import { clampArrowOpacity } from '../ui/inspector';
import { getCanvasCssSize, resetContextToCssPixels } from './dpi';
import { getConnectedArrowIdsForElementIds, getSceneElementById, invalidateSceneSpatialIndexGeometry, querySceneElements } from '../performance/scene-index';
import { LruCache } from '../performance/lru-cache';
import { isPerformanceInstrumentationEnabled, measurePerformance, recordPerformanceDuration } from '../performance/instrumentation';
import { getSelectedIdSet } from '../performance/selection-cache';

// --- 9. DRAWING ENGINE ---
export function roundedRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { const nx = Math.min(x, x + w), ny = Math.min(y, y + h), nw = Math.abs(w), nh = Math.abs(h); if (c.roundRect)
    c.roundRect(nx, ny, nw, nh, r);
else
    c.rect(nx, ny, nw, nh); }

export function drawArrowHead(c: CanvasRenderingContext2D, tip: Point, tail: Point, size: number) { const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x); c.beginPath(); c.moveTo(tip.x, tip.y); c.lineTo(tip.x - size * Math.cos(ang - Math.PI / 6), tip.y - size * Math.sin(ang - Math.PI / 6)); c.lineTo(tip.x - size * Math.cos(ang + Math.PI / 6), tip.y - size * Math.sin(ang + Math.PI / 6)); c.closePath(); c.fill(); }

export function drawFloatingConnectorLabel(c: CanvasRenderingContext2D, layout: ArrowLabelLayout | null, richText: string | undefined, text: string | undefined) {
    if (!layout || !text)
        return;
    c.save();
    c.globalAlpha = 1;
    c.fillStyle = ARROW_LABEL_BG;
    c.beginPath();
    roundedRectPath(c, layout.box.x, layout.box.y, layout.box.width, layout.box.height, ARROW_LABEL_RADIUS);
    c.fill();
    drawRichText(c, richText, text, layout.textX, layout.textBaselineY, DEFAULT_TEXT_FONT_SIZE, ARROW_LABEL_TEXT_COLOR, layout.textWidth, 'center', layout.renderScale, layout.lines, layout.family);
    c.restore();
}

export function isEditingArrowText(el: ArrowElement, kind: ArrowTextTarget, branchId?: string) { return appState.editingTextId === el.id && !!appState.textEditorContent && appState.editingArrowTextTarget?.kind === kind && (!branchId || appState.editingArrowTextTarget.branchId === branchId); }

export function drawArrowLabel(c: CanvasRenderingContext2D, el: ArrowElement, pts: Point[]) { if (!el.label || isEditingArrowText(el, 'label'))
    return; drawFloatingConnectorLabel(c, getArrowLabelLayout(el, pts, getArrowLabelCollisionBounds(el.id)), undefined, el.label); }

export function strokeSmoothConnector(c: CanvasRenderingContext2D, pts: Point[]) { if (!pts.length)
    return; c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++)
    c.lineTo(pts[i].x, pts[i].y); c.stroke(); }

export function drawStyledConnectorPath(c: CanvasRenderingContext2D, pts: Point[], el: ArrowElement, renderZoom: number, heads = true) {
    const style = normalizeArrowStyle(el.style), color = el.color || '#111827';
    c.save();
    c.globalAlpha *= clampArrowOpacity(el.opacity);
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = el.thickness;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.setLineDash(style === 'dotted' ? [Math.max(1, el.thickness * .55), Math.max(5, el.thickness * 2.8)] : style === 'dashed' ? [Math.max(7, el.thickness * 3), Math.max(5, el.thickness * 2.2)] : []);
    strokeSmoothConnector(c, pts);
    c.setLineDash([]);
    const size = 9 / Math.max(.1, renderZoom);
    if (heads && (style === 'arrow' || style === 'double'))
        drawArrowHead(c, pts[pts.length - 1], pts[Math.max(0, pts.length - 4)], size);
    if (heads && style === 'double')
        drawArrowHead(c, pts[0], pts[Math.min(3, pts.length - 1)], size);
    if (heads && style === 'dots') {
        const r = Math.max(3.4 / Math.max(.1, renderZoom), el.thickness * 1.15 / Math.max(.1, renderZoom));
        for (const point of [pts[0], pts[pts.length - 1]]) {
            c.beginPath();
            c.arc(point.x, point.y, r, 0, Math.PI * 2);
            c.fill();
        }
    }
    c.restore();
}

export function drawArrow(c: CanvasRenderingContext2D, el: ArrowElement, renderZoom = appState.camera.zoom) {
    const pts = getArrowRenderPoints(el);
    drawStyledConnectorPath(c, pts, el, renderZoom, true);
    if (arrowMode(el) === 'branches') {
        for (const branch of getArrowBranches(el)) {
            const bpts = getArrowBranchRenderPoints(el, branch);
            drawStyledConnectorPath(c, bpts, el, renderZoom, true);
            if (branch.label && !isEditingArrowText(el, 'branch', branch.id))
                drawFloatingConnectorLabel(c, getBranchLabelLayout(branch, bpts, getArrowLabelCollisionBounds(el.id)), undefined, branch.label);
        }
        if (el.startLabel && !isEditingArrowText(el, 'start'))
            drawFloatingConnectorLabel(c, getEndpointLabelLayout(el, 'start'), undefined, el.startLabel);
        if (el.endLabel && !isEditingArrowText(el, 'end'))
            drawFloatingConnectorLabel(c, getEndpointLabelLayout(el, 'end'), undefined, el.endLabel);
    }
    // Connector opacity does not dim its informational label.
    drawArrowLabel(c, el, pts);
}

export function drawConnectionPoints(el: ConnectableElement, emphasizeId?: string, emphasizePoint?: ConnectionPoint) {
    for (const cp of getConnectionPoints(el)) {
        const active = el.id === emphasizeId && cp.point === emphasizePoint;
        ctx.beginPath();
        ctx.arc(cp.position.x, cp.position.y, (active ? 6 : 4.5) / appState.camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = active ? '#4dabf7' : '#fff';
        ctx.fill();
        ctx.strokeStyle = active ? '#2563eb' : '#4dabf7';
        ctx.lineWidth = (active ? 2 : 1.25) / appState.camera.zoom;
        ctx.stroke();
    }
    if (el.id === emphasizeId && appState.hoveredConnection && !appState.hoveredConnection.point) {
        ctx.beginPath();
        ctx.arc(appState.hoveredConnection.position.x, appState.hoveredConnection.position.y, 6 / appState.camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#4dabf7';
        ctx.fill();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2 / appState.camera.zoom;
        ctx.stroke();
    }
}

const richTextLayoutCache = new LruCache<string, RichLayout>(1200);
const elementRichTextLayoutCache = new WeakMap<CanvasElement, Map<string, RichLayout>>();

function richTextLayoutCacheKey(lines: RichLine[], baseFontSize: number, maxWidth: number | undefined, renderScale: number, family: string | undefined): string {
    return JSON.stringify([baseFontSize, maxWidth ?? null, renderScale, family ?? '', lines]);
}

export function getRichTextLayoutCacheStats() {
    return { size: richTextLayoutCache.size, hits: richTextLayoutCache.hits, misses: richTextLayoutCache.misses, capacity: richTextLayoutCache.capacity };
}

let richTextLayoutEpoch = 0;
export function clearRichTextLayoutCache() { richTextLayoutCache.clear(); richTextLayoutEpoch++; }
export function getRichTextLayoutEpoch() { return richTextLayoutEpoch; }

let fontCacheInvalidationInstalled = false;
function installFontMetricInvalidation() {
    if (fontCacheInvalidationInstalled || typeof document === 'undefined' || !document.fonts) return;
    fontCacheInvalidationInstalled = true;
    document.fonts.addEventListener('loadingdone', () => {
        clearRichTextLayoutCache();
        invalidateSceneSpatialIndexGeometry();
        redraw();
    });
}
installFontMetricInvalidation();

export function measureRichTextLayoutFromLines(lines: RichLine[], baseFontSize: number, baseColor: string, maxWidth?: number, renderScale = 1, family?: string): RichLayout {
    baseFontSize = normalizeFontSize(baseFontSize);
    const cacheKey = richTextLayoutCacheKey(lines, baseFontSize, maxWidth, renderScale, family);
    const cached = richTextLayoutCache.get(cacheKey);
    if (cached) return cached;
    const instrumentLayout = isPerformanceInstrumentationEnabled() && typeof performance !== 'undefined';
    const layoutStart = instrumentLayout ? performance.now() : 0;
    const rawLines = renderScale === 1 ? cloneRichLines(lines) : scaleRichLines(lines, renderScale);
    const lineHeightBase = Math.max(16, baseFontSize * RICH_TEXT_LINE_HEIGHT * renderScale);
    const widthLimit = maxWidth && maxWidth > 20 ? maxWidth : Infinity;
    const wrapped: RichLine[] = [];
    let maxTokenWidth = 0;
    rawLines.forEach(source => {
        const markerIndent = richLineContentIndent(source);
        const available = widthLimit === Infinity ? Infinity : Math.max(40, widthLimit - markerIndent);
        let line: RichLine = { runs: [], listType: source.listType, listIndex: source.listIndex, numberPath: source.numberPath ? [...source.numberPath] : undefined, indent: source.indent, checked: source.checked, listContinuation: source.listContinuation };
        let pushedVisualLine = false;
        const pushLine = () => { wrapped.push(line); pushedVisualLine = true; line = { runs: [], listType: source.listType, listIndex: source.listIndex, numberPath: source.numberPath ? [...source.numberPath] : undefined, indent: source.indent, checked: source.checked, listContinuation: source.listType ? true : source.listContinuation }; };
        const appendChunk = (run: RichRun, text: string) => {
            if (!text)
                return;
            const last = line.runs[line.runs.length - 1];
            const same = !!last && JSON.stringify({ ...last, text: undefined }) === JSON.stringify({ ...run, text: undefined });
            if (same)
                last!.text += text;
            else
                line.runs.push({ ...run, text });
        };
        source.runs.forEach(run => {
            const pieces = run.text.split(/(\s+)/);
            pieces.forEach(piece => {
                if (!piece)
                    return;
                const fs = baseFontSize * renderScale;
                ctx.font = `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : ''}${fs}px ${fontStack(family)}`;
                const currentText = line.runs.map(r => r.text).join('');
                const pieceWidth = ctx.measureText(piece).width;
                if (piece.trim())
                    maxTokenWidth = Math.max(maxTokenWidth, pieceWidth);
                if (available !== Infinity && piece.trim() && pieceWidth > available) {
                    // If a very long token follows existing text, wrap before splitting
                    // the token. Otherwise the first chunk is appended to an already
                    // occupied line and can overflow the note/rectangle boundary.
                    if (currentText)
                        pushLine();
                    let chunk = '';
                    for (const ch of piece) {
                        const next = chunk + ch;
                        if (chunk && ctx.measureText(next).width > available) {
                            appendChunk(run, chunk);
                            pushLine();
                            chunk = ch;
                        }
                        else
                            chunk = next;
                    }
                    appendChunk(run, chunk);
                    return;
                }
                const nextText = currentText + piece;
                if (available !== Infinity && currentText && ctx.measureText(nextText).width > available)
                    pushLine();
                appendChunk(run, piece);
            });
        });
        pushLine();
    });
    let width = 0, height = 0, firstLineFontSize = baseFontSize * renderScale;
    const lineWidths: number[] = [];
    const runWidths: number[][] = [];
    wrapped.forEach((line, index) => {
        const lineMaxFs = baseFontSize * renderScale;
        if (index === 0) firstLineFontSize = lineMaxFs;
        const widths = line.runs.map(run => {
            const fs = baseFontSize * renderScale;
            ctx.font = `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : ''}${fs}px ${fontStack(family)}`;
            return ctx.measureText(run.text).width;
        });
        const lineWidth = widths.reduce((sum, value) => sum + value, 0);
        lineWidths.push(lineWidth);
        runWidths.push(widths);
        const markerIndent = richLineContentIndent(line);
        width = Math.max(width, lineWidth + markerIndent);
        height += Math.max(lineHeightBase, lineMaxFs * RICH_TEXT_LINE_HEIGHT);
    });
    const layout = { lines: wrapped, width, height, maxTokenWidth, firstLineFontSize, lineWidths, runWidths };
    richTextLayoutCache.set(cacheKey, layout);
    if (instrumentLayout) recordPerformanceDuration('textLayoutMiss', performance.now() - layoutStart);
    return layout;
}

export function measureRichTextLayout(html: string | undefined, plain: string, baseFontSize: number, baseColor: string, maxWidth?: number, renderScale = 1, family?: string): RichLayout {
    const lines = textDocumentFromHtml(html, baseColor).lines;
    return measureRichTextLayoutFromLines(lines, baseFontSize, baseColor, maxWidth, renderScale, family);
}

function getElementRichTextLayout(el: TextElement | NoteElement | RectangleElement, maxWidth?: number): RichLayout {
    const renderScale = getTextScale(el);
    const fontSize = el.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const key = `${richTextLayoutEpoch}|${maxWidth ?? 'natural'}|${renderScale}`;
    let byGeometry = elementRichTextLayoutCache.get(el);
    if (!byGeometry) {
        byGeometry = new Map<string, RichLayout>();
        elementRichTextLayoutCache.set(el, byGeometry);
    }
    const cached = byGeometry.get(key);
    if (cached) return cached;
    const layout = measureRichTextLayoutFromLines(canonicalLines(el, el.type === 'text' ? 1 : undefined), fontSize, el.color, maxWidth, renderScale, el.fontFamily);
    byGeometry.set(key, layout);
    return layout;
}

export function getRichTextMetrics(el: TextElement): {
    width: number;
    height: number;
    firstLineFontSize: number;
} {
    const layout = getElementRichTextLayout(el);
    return { width: layout.width, height: layout.height, firstLineFontSize: layout.firstLineFontSize };
}

export function drawRichText(ctx2: CanvasRenderingContext2D, html: string | undefined, plain: string, x: number, y: number, baseFontSize: number, baseColor: string, maxWidth?: number, align: TextAlign = 'left', renderScale = 1, storedLines?: RichLine[], family?: string, precomputedLayout?: RichLayout) {
    const layout = precomputedLayout ?? (storedLines ? measureRichTextLayoutFromLines(storedLines, baseFontSize, baseColor, maxWidth, renderScale, family) : measureRichTextLayout(html, plain, baseFontSize, baseColor, maxWidth, renderScale, family));
    const wrapped = layout.lines;
    const lineHeight = Math.max(16, normalizeFontSize(baseFontSize) * RICH_TEXT_LINE_HEIGHT * renderScale);
    wrapped.forEach((line, li) => {
        const fs = normalizeFontSize(baseFontSize) * renderScale;
        const indent = richLineContentIndent(line);
        const available = maxWidth && maxWidth > 20 ? Math.max(40, maxWidth - indent) : Infinity;
        const total = layout.lineWidths?.[li] ?? line.runs.reduce((sum, run) => { ctx2.font = `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : ''}${fs}px ${fontStack(family)}`; return sum + ctx2.measureText(run.text).width; }, 0);
        let contentX = x + indent;
        if (align === 'center' && available !== Infinity)
            contentX = x + indent + (available - total) / 2;
        else if (align === 'right' && available !== Infinity)
            contentX = x + indent + available - total;
        const yy = y + li * Math.max(lineHeight, fs * 1.3);
        if (line.listType && !line.listContinuation) {
            const marker = richLineListMarker(line);
            const markerScale = line.listType === 'bullet' ? LIST_BULLET_SCALE : (line.listType === 'number' ? LIST_NUMBER_SCALE : 1);
            const markerFs = fs * markerScale;
            // Match the HTML editor: the marker occupies a fixed column immediately
            // before the list text, uses the same font family, and is right-aligned.
            ctx2.save();
            ctx2.font = `${line.listType === 'bullet' ? '700 ' : line.listType === 'number' ? '600 ' : ''}${markerFs}px ${fontStack(family)}`;
            ctx2.fillStyle = (line.runs[0]?.color || baseColor);
            ctx2.textAlign = 'right';
            ctx2.textBaseline = 'alphabetic';
            ctx2.fillText(marker, x + indent - LIST_MARKER_GAP, yy);
            ctx2.restore();
        }
        line.runs.forEach((run, runIndex) => {
            ctx2.font = `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : ''}${fs}px ${fontStack(family)}`;
            const w = layout.runWidths?.[li]?.[runIndex] ?? ctx2.measureText(run.text).width;
            if (run.highlight && run.highlight !== 'transparent') {
                ctx2.fillStyle = run.highlight;
                ctx2.fillRect(contentX, yy - fs * .86, w, fs * 1.08);
            }
            ctx2.fillStyle = run.color || baseColor;
            ctx2.fillText(run.text, contentX, yy);
            if (run.underline || run.strike) {
                ctx2.strokeStyle = run.color || baseColor;
                ctx2.lineWidth = Math.max(1, fs / 14);
                ctx2.beginPath();
                if (run.underline) {
                    ctx2.moveTo(contentX, yy + 2);
                    ctx2.lineTo(contentX + w, yy + 2);
                }
                if (run.strike) {
                    ctx2.moveTo(contentX, yy - fs * .34);
                    ctx2.lineTo(contentX + w, yy - fs * .34);
                }
                ctx2.stroke();
            }
            contentX += w;
        });
    });
}

export function drawShapeText(ctx2: CanvasRenderingContext2D, el: NoteElement | RectangleElement, b: Bounds) {
    const plain = el.type === 'rectangle' ? (el.text || '') : el.text;
    if (!plain) return;
    const fontSize = el.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const renderScale = getTextScale(el);
    const maxWidth = Math.max(20, b.width - TEXT_PAD_X * 2);
    const lines = canonicalLines(el);
    const layout = getElementRichTextLayout(el, maxWidth);
    const innerHeight = Math.max(0, b.height - TEXT_PAD_Y * 2);
    const verticalOffset = el.textVerticalAlign === 'middle'
        ? Math.max(0, (innerHeight - layout.height) / 2)
        : 0;
    const baselineY = b.y + TEXT_PAD_Y + verticalOffset + fontSize * renderScale;
    drawRichText(ctx2, undefined, plain, b.x + TEXT_PAD_X, baselineY, fontSize, el.color, maxWidth, el.textAlign || 'left', renderScale, lines, el.fontFamily, layout);
}

export function drawElement(el: CanvasElement) {
    if (el.hidden)
        return;
    const isEraserTarget = appState.activeTool === 'eraser' && appState.eraserPreviewIds.has(el.id);
    // While a text/note/rectangle is being edited, the HTML editor is the single
    // source of truth for its text. Do not paint the same text underneath it,
    // otherwise every redraw produces a ghost/duplicate copy behind the editor.
    const activeEditingId = appState.editingTextId ?? appState.textEditorContent?.dataset.editingId ?? appState.textEditor?.dataset.editingId ?? null;
    const isEditingThisText = !!appState.textEditorContent && appState.editingTextId === el.id;
    if (isEraserTarget)
        ctx.globalAlpha = 0.42;
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    if (el.type === 'freehand') {
        ctx.lineWidth = el.thickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (el.points.length)
            ctx.stroke(getFreehandPath(el));
    }
    else if (el.type === 'rectangle') {
        const b = normalizedBounds(el.x, el.y, el.width, el.height);
        drawRectangleSurface(ctx, el, b);
        if (el.text && !isEditingThisText) drawShapeText(ctx, el, b);
    }
    else if (el.type === 'note') {
        const b = normalizedBounds(el.x, el.y, el.width, el.height);
        drawNoteSurface(ctx, el, b);
        if (!isEditingThisText) {
            ctx.fillStyle = el.color;
            drawShapeText(ctx, el, b);
        }
    }
    else if (el.type === 'text') {
        if (!isEditingThisText) {
            const layout = getElementRichTextLayout(el);
            drawRichText(ctx, undefined, el.text, el.x, el.y, el.fontSize, el.color, undefined, el.textAlign || 'left', getTextScale(el), layout.lines, el.fontFamily, layout);
        }
    }
    else if (el.type === 'media') {
        ctx.strokeStyle = '#a1a1aa';
        ctx.lineWidth = 1;
        ctx.strokeRect(el.x, el.y, el.width, el.height);
        const img = getMediaImage(el.assetId) as HTMLImageElement | undefined;
        if (img)
            ctx.drawImage(img, el.x, el.y, el.width, el.height);
        else {
            ctx.fillStyle = el.mime.startsWith('image/') ? '#eee' : '#f4f4f5';
            ctx.fillRect(el.x, el.y, el.width, el.height);
            ctx.fillStyle = '#555';
            ctx.font = '14px sans-serif';
            ctx.fillText(el.mime.startsWith('image/') ? el.name : `Unsupported · ${el.name}`, el.x + 10, el.y + 24);
        }
    }
    else
        drawArrow(ctx, el as ArrowElement);
    if (isEraserTarget)
        ctx.globalAlpha = 1;
}

export function drawScene() {
    const { width: cssWidth, height: cssHeight } = getCanvasCssSize(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    resetContextToCssPixels(ctx, canvas);
    if (appState.mode === 'moving' && appState.moveBackgroundCanvas) {
        ctx.drawImage(appState.moveBackgroundCanvas, 0, 0, cssWidth, cssHeight);
        if (appState.moveSelectionCanvas) {
            // The selected objects are rendered only once at drag start. Moving the
            // cached layer is much cheaper than re-layout/re-rendering rich text,
            // notes and media on every mousemove frame.
            ctx.drawImage(appState.moveSelectionCanvas, appState.activeMoveDelta.x * appState.camera.zoom, appState.activeMoveDelta.y * appState.camera.zoom, cssWidth, cssHeight);
        }
        ctx.save();
        ctx.translate(appState.camera.x, appState.camera.y);
        ctx.scale(appState.camera.zoom, appState.camera.zoom);
        const affectedArrowIds = getConnectedArrowIdsForElementIds(appState.movingSelectionIds);
        for (const id of affectedArrowIds) {
            if (appState.movingSelectionIds.has(id)) continue;
            const el = getSceneElementById(id);
            if (el && !el.hidden) drawElement(el);
        }
    }
    else {
        ctx.save();
        ctx.translate(appState.camera.x, appState.camera.y);
        ctx.scale(appState.camera.zoom, appState.camera.zoom);
        const view = { x: -appState.camera.x / appState.camera.zoom, y: -appState.camera.y / appState.camera.zoom, width: cssWidth / appState.camera.zoom, height: cssHeight / appState.camera.zoom };
        const margin = 80 / appState.camera.zoom;
        const renderBounds = { x: view.x - margin, y: view.y - margin, width: view.width + margin * 2, height: view.height + margin * 2 };
        const candidates = querySceneElements(renderBounds, getSpatialIndexBounds);
        for (const el of candidates) {
            if (el.hidden)
                continue;
            if (rectsIntersect(getBoundingBox(el), renderBounds)) drawElement(el);
        }
    }
    // Connection anchors are only an Arrow-tool affordance. In normal Select mode
    // they were being drawn on every selected Note/Rectangle, which made the four
    // side-midpoint circles look like extra resize handles. Keep selection UI clean:
    // only the four corner resize handles are visible unless an arrow is being drawn.
    const showConnections = appState.activeTool === 'arrow';
    if (showConnections) {
        const anchorView = { x: -appState.camera.x / appState.camera.zoom, y: -appState.camera.y / appState.camera.zoom, width: cssWidth / appState.camera.zoom, height: cssHeight / appState.camera.zoom };
        querySceneElements(anchorView, getSpatialIndexBounds, { includeVolatileAutoArrows: false }).filter(el => !el.locked && !el.hidden && isConnectableShape(el)).forEach(el => {
            const moving = appState.mode === 'moving' && appState.movingSelectionIds.has(el.id) && (appState.activeMoveDelta.x !== 0 || appState.activeMoveDelta.y !== 0);
            if (moving) {
                ctx.save();
                ctx.translate(appState.activeMoveDelta.x, appState.activeMoveDelta.y);
                drawConnectionPoints(el as ConnectableElement, appState.hoveredConnection?.id, appState.hoveredConnection?.point);
                ctx.restore();
            }
            else
                drawConnectionPoints(el as NoteElement | RectangleElement, appState.hoveredConnection?.id, appState.hoveredConnection?.point);
        });
    }
    const groupBox = (appState.mode === 'moving' && appState.initialGroupBounds) ? appState.initialGroupBounds : getGroupBoundingBox(appState.selectedIds);
    if (groupBox && appState.mode !== 'drawing') {
        if (appState.mode === 'moving' && (appState.activeMoveDelta.x !== 0 || appState.activeMoveDelta.y !== 0)) {
            ctx.save();
            ctx.translate(appState.activeMoveDelta.x, appState.activeMoveDelta.y);
        }
        ctx.strokeStyle = '#4dabf7';
        ctx.lineWidth = 1.5 / appState.camera.zoom;
        ctx.setLineDash([5 / appState.camera.zoom, 5 / appState.camera.zoom]);
        ctx.strokeRect(groupBox.x - 2 / appState.camera.zoom, groupBox.y - 2 / appState.camera.zoom, groupBox.width + 4 / appState.camera.zoom, groupBox.height + 4 / appState.camera.zoom);
        ctx.setLineDash([]);
        const sel = appState.selectedIds.length === 1 ? getSceneElementById(appState.selectedIds[0]) : undefined;
        const selIsArrow = !!sel && (sel.type === 'arrow' || sel.type === 'connector');
        const selectionLocked = selectionContainsLocked();
        if (!selIsArrow && !selectionLocked) {
            ctx.fillStyle = '#fff';
            Object.values(getResizeHandles(groupBox)).forEach(h => { ctx.fillRect(h.x, h.y, h.size, h.size); ctx.strokeRect(h.x, h.y, h.size, h.size); });
        }
        if (selIsArrow && !selectionLocked) {
            const a = sel as ArrowElement, pts = getArrowPathPoints(a);
            const visibleControlPoints = isArrowAutoRouted(a) && pts.length > 1 ? [pts[0], pts[pts.length - 1]] : pts;
            for (const pt of visibleControlPoints) {
                ctx.beginPath();
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = '#4dabf7';
                ctx.lineWidth = 1.5 / appState.camera.zoom;
                ctx.arc(pt.x, pt.y, 5 / appState.camera.zoom, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            if (arrowMode(a) === 'branches') {
                for (const branch of getArrowBranches(a)) {
                    const bpts = getArrowBranchPathPoints(a, branch);
                    for (let bi = 1; bi < bpts.length; bi++) {
                        const pt = bpts[bi];
                        ctx.beginPath();
                        ctx.fillStyle = bi === bpts.length - 1 ? '#eef6ff' : '#fff';
                        ctx.strokeStyle = '#4dabf7';
                        ctx.lineWidth = 1.25 / appState.camera.zoom;
                        ctx.arc(pt.x, pt.y, 4.3 / appState.camera.zoom, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    }
                }
            }
        }
    }
    if (groupBox && appState.mode === 'moving' && (appState.activeMoveDelta.x !== 0 || appState.activeMoveDelta.y !== 0))
        ctx.restore();
    if (appState.mode === 'marquee') {
        const x = Math.min(appState.dragStartWorld.x, appState.currentMouseWorld.x), y = Math.min(appState.dragStartWorld.y, appState.currentMouseWorld.y), w = Math.abs(appState.dragStartWorld.x - appState.currentMouseWorld.x), h = Math.abs(appState.dragStartWorld.y - appState.currentMouseWorld.y);
        ctx.fillStyle = 'rgba(77,171,247,.1)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#4dabf7';
        ctx.lineWidth = 1 / appState.camera.zoom;
        ctx.strokeRect(x, y, w, h);
    }
    if (appState.mode === 'eraser-marquee') {
        const x = Math.min(appState.dragStartWorld.x, appState.currentMouseWorld.x), y = Math.min(appState.dragStartWorld.y, appState.currentMouseWorld.y), w = Math.abs(appState.dragStartWorld.x - appState.currentMouseWorld.x), h = Math.abs(appState.dragStartWorld.y - appState.currentMouseWorld.y);
        ctx.fillStyle = 'rgba(24,24,27,.07)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(24,24,27,.55)';
        ctx.lineWidth = 1 / appState.camera.zoom;
        ctx.setLineDash([6 / appState.camera.zoom, 4 / appState.camera.zoom]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }
    ctx.restore();
}

let visualFrameHandle: number | null = null;
let redrawRequested = false;
const visualFrameTasks = new Set<() => void>();

function ensureVisualFrame(): void {
    if (visualFrameHandle !== null) return;
    visualFrameHandle = requestAnimationFrame(runVisualFrame);
}

function runVisualFrame(timestamp: number): void {
    const instrumentFrame = isPerformanceInstrumentationEnabled() && typeof performance !== 'undefined';
    const frameStart = instrumentFrame ? performance.now() : timestamp;
    visualFrameHandle = null;
    const tasks = [...visualFrameTasks];
    visualFrameTasks.clear();
    for (const task of tasks) task();
    if (redrawRequested) {
        redrawRequested = false;
        measurePerformance('drawScene', drawScene);
    }
    if (instrumentFrame) recordPerformanceDuration('frame', performance.now() - frameStart);
    if (visualFrameTasks.size || redrawRequested) ensureVisualFrame();
}

/** Queue work onto the same visual frame used by canvas redraws. */
export function requestVisualFrame(task: () => void): void {
    visualFrameTasks.add(task);
    redrawRequested = true;
    ensureVisualFrame();
}

/** Centralized canvas invalidation: any number of callers produce at most one paint per frame. */
export function redraw() {
    redrawRequested = true;
    ensureVisualFrame();
}
