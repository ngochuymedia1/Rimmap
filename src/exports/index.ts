// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { ARROW_LABEL_BG, ARROW_LABEL_RADIUS, ARROW_LABEL_TEXT_COLOR, getArrowLabelLayout, getBranchLabelLayout, getEndpointLabelLayout, normalizeArrowStyle } from '../arrows/index';
import { arrowMode, getArrowBranchRenderPoints, getArrowBranches, getArrowLabelCollisionBounds, getArrowRenderPoints, getBoundingBox, normalizedBounds } from '../model/geometry';
import { DEFAULT_TEXT_FONT_SIZE, TEXT_PAD_X, TEXT_PAD_Y, fontStack, getTextScale, normalizeFontFamily, normalizeFontSize } from '../model/text';
import { ArrowElement, ArrowLabelLayout, Bounds, CanvasElement, Point, RichLine, TextAlign } from '../model/types';
import { getAssetDataUrl, getMediaImage } from '../media/assets';
import { setProjectStatus } from '../persistence/index';
import { BOARD_BACKGROUND_COLOR, BOARD_DOT_COLOR, BOARD_DOT_SPACING } from '../renderer/constants';
import { drawArrow, drawRichText, drawShapeText, getRichTextMetrics, measureRichTextLayoutFromLines } from '../renderer/index';
import { canonicalLines, textDocumentFromHtml } from '../model/text-document';
import { drawNoteSurface, drawRectangleSurface, getNoteFill, getRectangleFill, getRectanglePatternSpacing, getRectangleStrokeColor, getRectangleStrokeStyle, noteCornerRadius, rectangleStrokeEnabled } from '../renderer/shapes';
import { appState } from '../state/store';
import { LIST_BULLET_SCALE, LIST_MARKER_GAP, LIST_NUMBER_SCALE, RICH_TEXT_LINE_HEIGHT, richLineContentIndent, richLineListMarker, scaleRichLines } from '../model/text-document';
import { ctx } from '../ui/dom';
import { clampArrowOpacity } from '../ui/inspector';

export function getExportElements(): CanvasElement[] {
    const visible = appState.elements.filter(el => !el.hidden);
    const selected = visible.filter(el => appState.selectedIds.includes(el.id));
    return selected.length ? selected : visible;
}

export function getExportBounds(items: CanvasElement[]): Bounds | null {
    if (!items.length)
        return null;
    let bounds = getBoundingBox(items[0]);
    for (const item of items.slice(1)) {
        const b = getBoundingBox(item);
        bounds = {
            x: Math.min(bounds.x, b.x),
            y: Math.min(bounds.y, b.y),
            width: Math.max(bounds.x + bounds.width, b.x + b.width) - Math.min(bounds.x, b.x),
            height: Math.max(bounds.y + bounds.height, b.y + b.height) - Math.min(bounds.y, b.y),
        };
    }
    const padding = 16;
    return { x: bounds.x - padding, y: bounds.y - padding, width: Math.max(1, bounds.width + padding * 2), height: Math.max(1, bounds.height + padding * 2) };
}

export function escapeXml(value: string): string {
    return value.replace(/[<>&'\"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]!));
}

export function pointsToSvg(points: Point[], ox: number, oy: number): string {
    return points.map(p => `${p.x - ox},${p.y - oy}`).join(' ');
}

export function richTextToSvg(html: string | undefined, plain: string, x: number, y: number, baseFontSize: number, baseColor: string, maxWidth?: number, align: TextAlign = 'left', renderScale = 1, storedLines?: RichLine[], family?: string) {
    const lines = storedLines ? scaleRichLines(storedLines, renderScale) : scaleRichLines(textDocumentFromHtml(html, baseColor).lines, renderScale);
    const out: string[] = [];
    const lineHeight = Math.max(16, normalizeFontSize(baseFontSize) * RICH_TEXT_LINE_HEIGHT * renderScale);
    const fs = DEFAULT_TEXT_FONT_SIZE * renderScale;
    lines.forEach((line, i) => {
        const indent = richLineContentIndent(line);
        const available = maxWidth && maxWidth > 20 ? Math.max(40, maxWidth - indent) : Infinity;
        let total = 0;
        line.runs.forEach(run => { ctx.font = `${run.italic ? 'italic ' : ''}${run.bold ? '700 ' : ''}${fs}px ${fontStack(family)}`; total += ctx.measureText(run.text).width; });
        let dx = x + indent;
        if (align === 'center' && available !== Infinity)
            dx = x + indent + (available - total) / 2;
        else if (align === 'right' && available !== Infinity)
            dx = x + indent + available - total;
        const anchor = align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end';
        const baseline = y + i * lineHeight;
        if (line.listType && !line.listContinuation) {
            const marker = richLineListMarker(line);
            const markerScale = line.listType === 'bullet' ? LIST_BULLET_SCALE : (line.listType === 'number' ? LIST_NUMBER_SCALE : 1);
            const markerWeight = line.listType === 'bullet' ? '700' : line.listType === 'number' ? '600' : '400';
            out.push(`<text x="${x + indent - LIST_MARKER_GAP}" y="${baseline}" text-anchor="end" fill="${escapeXml(line.runs[0]?.color || baseColor)}" font-size="${fs * markerScale}" font-family="${escapeXml(normalizeFontFamily(family))}, sans-serif" font-weight="${markerWeight}">${escapeXml(marker)}</text>`);
        }
        const tspans = line.runs.map(run => { const attrs = [`font-size="${fs}"`, `fill="${escapeXml(run.color || baseColor)}"`]; if (run.bold)
            attrs.push('font-weight="700"'); if (run.italic)
            attrs.push('font-style="italic"'); if (run.underline && run.strike)
            attrs.push('text-decoration="underline line-through"');
        else if (run.underline)
            attrs.push('text-decoration="underline"');
        else if (run.strike)
            attrs.push('text-decoration="line-through"'); const t = `<tspan ${attrs.join(' ')}>${escapeXml(run.text)}</tspan>`; return t; }).join('');
        out.push(`<text x="${dx}" y="${baseline}" text-anchor="${anchor}" font-family="${escapeXml(normalizeFontFamily(family))}, sans-serif">${tspans}</text>`);
    });
    return out.join('');
}

function shapeSvgTextBaseline(el: Extract<CanvasElement, { type: 'note' | 'rectangle' }>, b: Bounds): number {
    const fontSize = el.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const scale = getTextScale(el);
    const maxWidth = Math.max(20, b.width - TEXT_PAD_X * 2);
    const layout = measureRichTextLayoutFromLines(canonicalLines(el), fontSize, el.color, maxWidth, scale, el.fontFamily);
    const innerHeight = Math.max(0, b.height - TEXT_PAD_Y * 2);
    const offset = el.textVerticalAlign === 'middle' ? Math.max(0, (innerHeight - layout.height) / 2) : 0;
    return b.y + TEXT_PAD_Y + offset + fontSize * scale;
}

export async function buildSvg(transparent: boolean): Promise<string | null> {
    const items = getExportElements();
    const bounds = getExportBounds(items);
    if (!bounds)
        return null;
    const bg = transparent ? '' : `<defs><pattern id="board-dot-grid" width="${BOARD_DOT_SPACING}" height="${BOARD_DOT_SPACING}" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#94a3b8" opacity=".34"/></pattern></defs><rect x="0" y="0" width="${bounds.width}" height="${bounds.height}" fill="${BOARD_BACKGROUND_COLOR}"/><rect x="0" y="0" width="${bounds.width}" height="${bounds.height}" fill="url(#board-dot-grid)"/>`;
    const parts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">`,
        `<g font-family="Montserrat, sans-serif">`,
        bg,
    ];
    for (const el of items) {
        if (el.type === 'freehand') {
            parts.push(`<polyline points="${pointsToSvg(el.points, bounds.x, bounds.y)}" fill="none" stroke="${escapeXml(el.color)}" stroke-width="${el.thickness}" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
        else if (el.type === 'rectangle') {
            const b = normalizedBounds(el.x, el.y, el.width, el.height);
            const fill = getRectangleFill(el) || 'none';
            const stroke = rectangleStrokeEnabled(el) ? getRectangleStrokeColor(el) : 'none';
            const strokeStyle = getRectangleStrokeStyle(el);
            const spacing = getRectanglePatternSpacing(el);
            const dash = strokeStyle === 'dotted'
                ? ` stroke-dasharray="${Math.max(1, el.thickness * .7)} ${Math.max(2, el.thickness * 2.4 * spacing)}" stroke-linecap="round"`
                : strokeStyle === 'dashed'
                    ? ` stroke-dasharray="${Math.max(5, el.thickness * 3.2)} ${Math.max(2.5, el.thickness * 2.2 * spacing)}" stroke-linecap="butt"`
                    : '';
            parts.push(`<rect x="${b.x - bounds.x}" y="${b.y - bounds.y}" width="${b.width}" height="${b.height}" rx="${el.borderRadius}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${el.thickness}"${dash}/>`);
            if (el.text)
                parts.push(richTextToSvg(undefined, el.text, b.x + TEXT_PAD_X - bounds.x, shapeSvgTextBaseline(el, b) - bounds.y, el.fontSize ?? 16, el.color, Math.max(20, b.width - TEXT_PAD_X * 2), el.textAlign || 'left', getTextScale(el), el.textDoc?.lines, el.fontFamily));
        }
        else if (el.type === 'note') {
            const b = normalizedBounds(el.x, el.y, el.width, el.height);
            const radius = noteCornerRadius(el);
            parts.push(`<rect x="${b.x - bounds.x}" y="${b.y - bounds.y}" width="${b.width}" height="${b.height}" rx="${radius}" fill="${escapeXml(getNoteFill(el))}" stroke="#2d2825" stroke-opacity=".78" stroke-width="1.15"/>`);
            parts.push(richTextToSvg(undefined, el.text, b.x + TEXT_PAD_X - bounds.x, shapeSvgTextBaseline(el, b) - bounds.y, el.fontSize, el.color, Math.max(20, b.width - TEXT_PAD_X * 2), el.textAlign || 'left', getTextScale(el), el.textDoc?.lines, el.fontFamily));
        }
        else if (el.type === 'text') {
            parts.push(richTextToSvg(undefined, el.text, el.x - bounds.x, el.y - bounds.y, el.fontSize, el.color, Math.max(40, getRichTextMetrics(el).width), el.textAlign || 'left', getTextScale(el), el.textDoc?.lines, el.fontFamily));
        }
        else if (el.type === 'media') {
            parts.push(`<rect x="${el.x - bounds.x}" y="${el.y - bounds.y}" width="${el.width}" height="${el.height}" fill="#f0f0f0" stroke="#aaa"/>`);
            if (el.mime.startsWith('image/')) {
                const href = await getAssetDataUrl(el.assetId);
                if (href) parts.push(`<image href="${escapeXml(href)}" x="${el.x - bounds.x}" y="${el.y - bounds.y}" width="${el.width}" height="${el.height}" preserveAspectRatio="none"/>`);
            }
        }
        else {
            const a = el as ArrowElement, style = normalizeArrowStyle(a.style), arrowColor = escapeXml(a.color || '#111827'), dash = style === 'dotted' ? `stroke-dasharray="${Math.max(1, a.thickness * .55)} ${Math.max(5, a.thickness * 2.8)}"` : style === 'dashed' ? `stroke-dasharray="${Math.max(7, a.thickness * 3)} ${Math.max(5, a.thickness * 2.2)}"` : '';
            const sz = 9, headFill = arrowColor;
            const addHead = (tip: Point, tail: Point) => { const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x); const p1 = { x: tip.x - sz * Math.cos(ang - Math.PI / 6) - bounds.x, y: tip.y - sz * Math.sin(ang - Math.PI / 6) - bounds.y }, p2 = { x: tip.x - sz * Math.cos(ang + Math.PI / 6) - bounds.x, y: tip.y - sz * Math.sin(ang + Math.PI / 6) - bounds.y }; parts.push(`<polygon points="${tip.x - bounds.x},${tip.y - bounds.y} ${p1.x},${p1.y} ${p2.x},${p2.y}" fill="${headFill}"/>`); };
            const addPath = (pts: Point[], heads = true) => { const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x - bounds.x} ${p.y - bounds.y}`).join(' '); parts.push(`<path d="${d}" fill="none" stroke="${arrowColor}" stroke-width="${a.thickness}" stroke-linecap="round" stroke-linejoin="round" opacity="${clampArrowOpacity(a.opacity)}" ${dash}/>`); if (heads && (style === 'arrow' || style === 'double'))
                addHead(pts[pts.length - 1], pts[Math.max(0, pts.length - 4)]); if (heads && style === 'double')
                addHead(pts[0], pts[Math.min(3, pts.length - 1)]); if (heads && style === 'dots') {
                for (const point of [pts[0], pts[pts.length - 1]])
                    parts.push(`<circle cx="${point.x - bounds.x}" cy="${point.y - bounds.y}" r="${Math.max(3.4, a.thickness * 1.15)}" fill="${arrowColor}"/>`);
            } };
            const addLabel = (layout: ArrowLabelLayout | null, rich: string | undefined, text: string | undefined) => { if (!layout || !text)
                return; parts.push(`<rect x="${layout.box.x - bounds.x}" y="${layout.box.y - bounds.y}" width="${layout.box.width}" height="${layout.box.height}" rx="${ARROW_LABEL_RADIUS}" fill="${ARROW_LABEL_BG}"/>`); parts.push(richTextToSvg(rich, text, layout.textX - bounds.x, layout.textBaselineY - bounds.y, DEFAULT_TEXT_FONT_SIZE, ARROW_LABEL_TEXT_COLOR, layout.textWidth, 'center', layout.renderScale, layout.lines, layout.family)); };
            const pts = getArrowRenderPoints(a);
            addPath(pts, true);
            if (a.label)
                addLabel(getArrowLabelLayout(a, pts, getArrowLabelCollisionBounds(a.id)), undefined, a.label);
            if (arrowMode(a) === 'branches') {
                for (const branch of getArrowBranches(a)) {
                    const bpts = getArrowBranchRenderPoints(a, branch);
                    addPath(bpts, true);
                    if (branch.label)
                        addLabel(getBranchLabelLayout(branch, bpts, getArrowLabelCollisionBounds(a.id)), undefined, branch.label);
                }
                if (a.startLabel)
                    addLabel(getEndpointLabelLayout(a, 'start'), undefined, a.startLabel);
                if (a.endLabel)
                    addLabel(getEndpointLabelLayout(a, 'end'), undefined, a.endLabel);
            }
        }
    }
    parts.push('</g></svg>');
    return parts.join('');
}

export function buildRasterCanvas(transparent: boolean, requestedScaleOverride?: number, maxDimensionOverride = 16384, minScale = 1): HTMLCanvasElement | null {
    const items = getExportElements();
    const bounds = getExportBounds(items);
    if (!bounds)
        return null;
    // Export at a deliberately high raster scale. SVG remains resolution-independent.
    // Cap the final bitmap dimensions to avoid browser canvas limits / memory spikes.
    const requestedScale = Math.max(minScale, Number(requestedScaleOverride ?? appState.exportPngScale) || 4);
    const maxDimension = maxDimensionOverride;
    const maxPixels = 268000000;
    const widthLimitedScale = bounds.width > 0 ? maxDimension / bounds.width : requestedScale;
    const heightLimitedScale = bounds.height > 0 ? maxDimension / bounds.height : requestedScale;
    const pixelLimitedScale = (bounds.width > 0 && bounds.height > 0)
        ? Math.sqrt(maxPixels / (bounds.width * bounds.height))
        : requestedScale;
    const scale = Math.max(minScale, Math.min(requestedScale, widthLimitedScale, heightLimitedScale, pixelLimitedScale));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.ceil(bounds.width * scale));
    out.height = Math.max(1, Math.ceil(bounds.height * scale));
    const c = out.getContext('2d')!;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.scale(scale, scale);
    if (!transparent) {
        c.fillStyle = BOARD_BACKGROUND_COLOR;
        c.fillRect(0, 0, bounds.width, bounds.height);
        // Match the app's subtle dotted paper background in non-transparent exports.
        c.save();
        c.fillStyle = BOARD_DOT_COLOR;
        const dotRadius = 0.7;
        for (let y = 1; y < bounds.height; y += BOARD_DOT_SPACING) {
            for (let x = 1; x < bounds.width; x += BOARD_DOT_SPACING) {
                c.beginPath();
                c.arc(x, y, dotRadius, 0, Math.PI * 2);
                c.fill();
            }
        }
        c.restore();
    }
    for (const el of items) {
        c.save();
        c.translate(-bounds.x, -bounds.y);
        if (el.type === 'media' && el.mime.startsWith('image/')) {
            const img = getMediaImage(el.assetId);
            if (img)
                c.drawImage(img, el.x, el.y, el.width, el.height);
        }
        else if (el.type === 'freehand') {
            c.strokeStyle = el.color;
            c.lineWidth = el.thickness;
            c.lineCap = 'round';
            c.lineJoin = 'round';
            c.beginPath();
            el.points.forEach((pt, i) => i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y));
            c.stroke();
        }
        else if (el.type === 'rectangle') {
            const b = normalizedBounds(el.x, el.y, el.width, el.height);
            drawRectangleSurface(c, el, b);
            if (el.text)
                drawRichText(c, undefined, el.text, b.x + TEXT_PAD_X, shapeSvgTextBaseline(el, b) - bounds.y, el.fontSize ?? 16, el.color, Math.max(20, b.width - TEXT_PAD_X * 2), el.textAlign || 'left', getTextScale(el), el.textDoc?.lines, el.fontFamily);
        }
        else if (el.type === 'note') {
            const b = normalizedBounds(el.x, el.y, el.width, el.height);
            drawNoteSurface(c, el, b);
            drawShapeText(c, el, b);
        }
        else if (el.type === 'text') {
            drawRichText(c, undefined, el.text, el.x, el.y, el.fontSize, el.color, Math.max(40, getBoundingBox(el).width), el.textAlign || 'left', getTextScale(el), el.textDoc?.lines, el.fontFamily);
        }
        else if (el.type === 'arrow' || el.type === 'connector') {
            drawArrow(c, el as ArrowElement, 1);
        }
        else if (el.type === 'media') {
            c.fillStyle = '#f0f0f0';
            c.fillRect(el.x, el.y, el.width, el.height);
            c.strokeStyle = '#aaa';
            c.strokeRect(el.x, el.y, el.width, el.height);
        }
        c.restore();
    }
    return out;
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportAsSvg(transparent: boolean) {
    const svg = await buildSvg(transparent);
    if (!svg)
        return;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `rimmap-${Date.now()}.svg`);
}

export async function exportAsPng(transparent: boolean) {
    const out = buildRasterCanvas(transparent);
    if (!out)
        return;
    const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'));
    if (blob) {
        downloadBlob(blob, `rimmap-${Date.now()}-${Math.round(appState.exportPngScale)}x.png`);
        setProjectStatus(`PNG exported · ${Math.round(appState.exportPngScale)}×`);
    }
}

export function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

export function asciiBytes(text: string): Uint8Array { return new TextEncoder().encode(text); }

export async function exportAsPdf(transparent: boolean) {
    const out = buildRasterCanvas(transparent);
    if (!out)
        return;
    const jpeg = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/jpeg', 0.98));
    if (!jpeg)
        return;
    const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
    const imageWidth = out.width, imageHeight = out.height;
    // Keep the page compact while embedding the full-resolution JPEG so the exported PDF stays sharp.
    const maxPagePt = 1440;
    const ptPerPx = Math.min(maxPagePt / imageWidth, maxPagePt / imageHeight);
    const pageWidth = Math.max(1, imageWidth * ptPerPx), pageHeight = Math.max(1, imageHeight * ptPerPx);
    const content = asciiBytes(`q\n${pageWidth.toFixed(4)} 0 0 ${pageHeight.toFixed(4)} 0 0 cm\n/Im0 Do\nQ\n`);
    const objects: Array<Uint8Array> = [];
    objects.push(asciiBytes('<< /Type /Catalog /Pages 2 0 R >>'));
    objects.push(asciiBytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    objects.push(asciiBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(4)} ${pageHeight.toFixed(4)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
    objects.push(concatUint8Arrays([asciiBytes(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`), jpegBytes, asciiBytes('\nendstream')]));
    objects.push(concatUint8Arrays([asciiBytes(`<< /Length ${content.length} >>\nstream\n`), content, asciiBytes('endstream')]));
    const header = asciiBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const chunks: Uint8Array[] = [header];
    const offsets: number[] = [0];
    let byteOffset = header.length;
    objects.forEach((obj, index) => {
        const wrapped = concatUint8Arrays([asciiBytes(`${index + 1} 0 obj\n`), obj, asciiBytes('\nendobj\n')]);
        offsets.push(byteOffset);
        chunks.push(wrapped);
        byteOffset += wrapped.length;
    });
    const xrefOffset = byteOffset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++)
        xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    chunks.push(asciiBytes(xref), asciiBytes(trailer));
    const pdfBytes = concatUint8Arrays(chunks);
    const safe = appState.projectName.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'Untitled Board';
    downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), `${safe}.pdf`);
    setProjectStatus('PDF exported');
}

export async function copyAsSvg(transparent: boolean) {
    const svg = await buildSvg(transparent);
    if (!svg)
        return;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
    try {
        if ('ClipboardItem' in window && navigator.clipboard?.write) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': svgBlob })]);
        }
        else {
            await navigator.clipboard.writeText(svg);
        }
    }
    catch {
        await navigator.clipboard.writeText(svg);
    }
}

export async function copyAsPng(transparent: boolean) {
    const out = buildRasterCanvas(transparent);
    if (!out)
        return;
    const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'));
    if (!blob)
        return;
    try {
        if ('ClipboardItem' in window && navigator.clipboard?.write) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        }
    }
    catch {
        // Some browsers deny image clipboard writes; no-op rather than breaking the app.
    }
}
