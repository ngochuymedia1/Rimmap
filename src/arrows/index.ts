// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { getArrowRenderPoints, lerpPoint } from '../model/geometry';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE, TEXT_SIZE_PRESETS, normalizeFontFamily } from '../model/text';
import { ArrowBranch, ArrowCurveMode, ArrowElement, ArrowLabelLayout, ArrowPathLocation, ArrowRoutingMode, ArrowStyle, Bounds, Point, RichLine, TextDocument } from '../model/types';
import { measureRichTextLayoutFromLines } from '../renderer/index';
import { RICH_TEXT_LINE_HEIGHT, canonicalLines, cloneRichLines } from '../model/text-document';
import { chooseCollisionAvoidedPathLabel } from './label-collision';
import { ARROW_LABEL_MAX_WIDTH, arrowLabelWidthLimit } from './label-layout';
export { ARROW_LABEL_MAX_WIDTH, arrowLabelWidthLimit } from './label-layout';

export const ARROW_COLOR_PALETTE = [
    { name: 'Black', value: '#111827' },
    { name: 'Slate', value: '#64748b' },
    { name: 'Rose', value: '#b97878' },
    { name: 'Terracotta', value: '#b98567' },
    { name: 'Ochre', value: '#9b8d54' },
    { name: 'Sage', value: '#6f978b' },
    { name: 'Blue', value: '#748aa8' },
    { name: 'Lilac', value: '#8c7fa5' },
] as const;

export function normalizeArrowStyle(value: any): ArrowStyle {
    if (value === 'line' || value === 'dots' || value === 'arrow' || value === 'double' || value === 'dotted' || value === 'dashed')
        return value;
    // Migrate legacy arrow styles without changing the user's visual intent.
    if (value === 'solid')
        return 'arrow';
    if (value === 'plain')
        return 'line';
    return 'line';
}

export function normalizeArrowCurveMode(value: any): ArrowCurveMode { return value === 'sharp' ? 'sharp' : 'smooth'; }

export function normalizeArrowRoutingMode(value: any): ArrowRoutingMode { return value === 'auto' ? 'auto' : 'manual'; }

// --- Professional connector-label geometry ---
// Labels are anchored by normalized path distance instead of by a control point.
// This keeps them stable when a 3/5-point connector moves or changes shape.
export const ARROW_LABEL_FONT_SIZE = 14;

const arrowLabelLayoutCache = new WeakMap<ArrowElement, { points: Point[]; collisionBounds: Bounds[]; layout: ArrowLabelLayout | null }>();
const branchLabelLayoutCache = new WeakMap<ArrowBranch, { points: Point[]; collisionBounds: Bounds[]; layout: ArrowLabelLayout | null }>();
const endpointLabelLayoutCache = new WeakMap<ArrowElement, { start?: { points: Point[]; layout: ArrowLabelLayout | null }; end?: { points: Point[]; layout: ArrowLabelLayout | null } }>();


/** Preserve the legacy 14px default while allowing the same authored S–XXL presets as other board text. */
export function normalizeArrowLabelFontSize(value: unknown): number {
    const n = Number(value);
    if (Number.isFinite(n)) {
        if (Math.abs(n - ARROW_LABEL_FONT_SIZE) < .01) return ARROW_LABEL_FONT_SIZE;
        for (const size of Object.values(TEXT_SIZE_PRESETS)) if (Math.abs(n - size) < .01) return size;
    }
    return ARROW_LABEL_FONT_SIZE;
}

export const ARROW_LABEL_TEXT_COLOR = '#27272a';

export const ARROW_LABEL_BG = '#fbfaf6';

export const ARROW_ENDPOINT_LABEL_MAX_WIDTH = 220;

export const ARROW_LABEL_PAD_X = 5;

export const ARROW_LABEL_PAD_Y = 3;

export const ARROW_LABEL_GAP = 6;

export const ARROW_LABEL_RADIUS = 4;

export const ARROW_LABEL_CORNER_CLEARANCE = 20;

export function clampArrowLabelPosition(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(.05, Math.min(.95, n)) : .5;
}

export function arrowLabelSide(el: ArrowElement): -1 | 1 { return el.labelSide === 1 ? 1 : -1; }

export function unitTangent(a: Point, b: Point): Point { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1; return { x: dx / len, y: dy / len }; }

export function canonicalTangent(a: Point, b: Point): Point {
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Canonicalize the geometric direction so reversing start/end does not
    // unexpectedly flip a label from one visual side of the line to the other.
    if (dx < 0 || (Math.abs(dx) < 1e-6 && dy < 0)) {
        dx = -dx;
        dy = -dy;
    }
    return { x: dx, y: dy };
}

export function arrowPathMetrics(pts: Point[]) {
    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        lengths.push(len);
        total += len;
    }
    return { lengths, total };
}

export function arrowPathLocationAtPoints(pts: Point[], position: number, avoidCorners = true): ArrowPathLocation {
    const { lengths, total } = arrowPathMetrics(pts);
    if (total < .0001) {
        return { point: { ...pts[0] }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, segmentIndex: 0, pathPosition: .5, distance: 0, totalLength: 0 };
    }
    const wanted = clampArrowLabelPosition(position) * total;
    let cumulative = 0, segmentIndex = Math.max(0, lengths.length - 1), local = 0;
    for (let i = 0; i < lengths.length; i++) {
        if (wanted <= cumulative + lengths[i] || i === lengths.length - 1) {
            segmentIndex = i;
            local = wanted - cumulative;
            break;
        }
        cumulative += lengths[i];
    }
    if (avoidCorners) {
        const len = lengths[segmentIndex] || 0;
        if (len >= ARROW_LABEL_CORNER_CLEARANCE * 2 + 8)
            local = Math.max(ARROW_LABEL_CORNER_CLEARANCE, Math.min(len - ARROW_LABEL_CORNER_CLEARANCE, local));
        else {
            // If the exact midpoint lands on a tiny bend, prefer the nearest usable
            // straight segment. This is much cleaner than placing text on a corner.
            let best = -1, bestScore = Infinity, bestCum = 0, cum = 0;
            for (let i = 0; i < lengths.length; i++) {
                const segLen = lengths[i];
                const center = cum + segLen / 2;
                if (segLen >= ARROW_LABEL_CORNER_CLEARANCE * 2 + 8) {
                    const score = Math.abs(center - wanted);
                    if (score < bestScore) {
                        best = i;
                        bestScore = score;
                        bestCum = cum;
                    }
                }
                cum += segLen;
            }
            if (best >= 0) {
                segmentIndex = best;
                cumulative = bestCum;
                const segLen = lengths[best];
                local = Math.max(ARROW_LABEL_CORNER_CLEARANCE, Math.min(segLen - ARROW_LABEL_CORNER_CLEARANCE, wanted - bestCum));
            }
        }
    }
    // Recompute cumulative if the chosen segment changed.
    cumulative = 0;
    for (let i = 0; i < segmentIndex; i++)
        cumulative += lengths[i];
    const a = pts[segmentIndex], b = pts[Math.min(segmentIndex + 1, pts.length - 1)], len = lengths[segmentIndex] || 1;
    const t = Math.max(0, Math.min(1, local / len));
    const point = lerpPoint(a, b, t);
    const tangent = canonicalTangent(a, b);
    const normal = { x: -tangent.y, y: tangent.x };
    const distance = cumulative + Math.max(0, Math.min(len, local));
    return { point, tangent, normal, segmentIndex, pathPosition: distance / total, distance, totalLength: total };
}

export function nearestArrowPathLocation(p: Point, el: ArrowElement): ArrowPathLocation & {
    hitDistance: number;
} {
    const pts = getArrowRenderPoints(el), { lengths, total } = arrowPathMetrics(pts);
    let bestDistance = Infinity, bestSeg = 0, bestT = 0, bestCum = 0, cum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
        const q = { x: a.x + dx * t, y: a.y + dy * t };
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < bestDistance) {
            bestDistance = d;
            bestSeg = i;
            bestT = t;
            bestCum = cum;
        }
        cum += lengths[i] || 0;
    }
    const a = pts[bestSeg], b = pts[bestSeg + 1], point = lerpPoint(a, b, bestT), tangent = canonicalTangent(a, b), normal = { x: -tangent.y, y: tangent.x };
    const distance = bestCum + (lengths[bestSeg] || 0) * bestT;
    return { point, tangent, normal, segmentIndex: bestSeg, pathPosition: total ? distance / total : .5, distance, totalLength: total, hitDistance: bestDistance };
}

export function normalizedArrowLabelLines(el: ArrowElement): RichLine[] {
    const source = canonicalLines({ textDoc: el.labelDoc, text: el.label || '', color: ARROW_LABEL_TEXT_COLOR });
    const arrowColor = (el.color || '').toLowerCase();
    source.forEach(line => line.runs.forEach(run => {
        const c = (run.color || '').toLowerCase();
        // Migrate legacy labels whose implicit text color was the connector color.
        if (!c || c === arrowColor)
            run.color = ARROW_LABEL_TEXT_COLOR;
    }));
    return source;
}

export function getPathLabelLayoutFromLines(lines: RichLine[], pts: Point[], position: number, side: -1 | 1, fontSize: number, family: string, collisionBounds: Bounds[] = []): ArrowLabelLayout {
    const renderScale = fontSize / DEFAULT_TEXT_FONT_SIZE;
    // Choose one deterministic wrapping width from the connector length.
    // That chosen width is preserved in the
    // layout instead of shrinking to the longest wrapped line (which used to
    // trigger a second, narrower wrap during rendering).
    const textWidth = arrowLabelWidthLimit(arrowPathMetrics(pts).total, fontSize);
    const measured = measureRichTextLayoutFromLines(lines, DEFAULT_TEXT_FONT_SIZE, ARROW_LABEL_TEXT_COLOR, textWidth, renderScale, family);
    const textHeight = Math.max(fontSize * RICH_TEXT_LINE_HEIGHT, measured.height || fontSize * RICH_TEXT_LINE_HEIGHT);
    // The invisible wrapping/editing area stays path-sized, while the subtle
    // label background/hit box still hugs the actual rendered glyph block.
    const visualTextWidth = Math.max(24, Math.min(textWidth, Math.ceil(measured.width || 24)));
    const boxW = visualTextWidth + ARROW_LABEL_PAD_X * 2, boxH = textHeight + ARROW_LABEL_PAD_Y * 2;
    const build = (candidatePosition: number, candidateSide: -1 | 1): ArrowLabelLayout => {
        const loc = arrowPathLocationAtPoints(pts, candidatePosition, false);
        const offset = ARROW_LABEL_GAP + boxH / 2;
        const center = { x: loc.point.x + loc.normal.x * candidateSide * offset, y: loc.point.y + loc.normal.y * candidateSide * offset };
        const box = { x: center.x - boxW / 2, y: center.y - boxH / 2, width: boxW, height: boxH };
        return { anchor: loc.point, tangent: loc.tangent, normal: loc.normal, side: candidateSide, textX: center.x - textWidth / 2, textBaselineY: box.y + ARROW_LABEL_PAD_Y + fontSize, textWidth, textHeight, box, fontSize, renderScale, family, lines: measured.lines };
    };
    return chooseCollisionAvoidedPathLabel(build, clampArrowLabelPosition(position), side, collisionBounds);
}

export function getArrowLabelLayout(el: ArrowElement, pts = getArrowRenderPoints(el), collisionBounds: Bounds[] = []): ArrowLabelLayout | null {
    if (!el.label) return null;
    const cached = arrowLabelLayoutCache.get(el);
    if (cached?.points === pts && cached.collisionBounds === collisionBounds) return cached.layout;
    const fontSize = normalizeArrowLabelFontSize(el.labelFontSize);
    const family = normalizeFontFamily(el.labelFontFamily || DEFAULT_FONT_FAMILY);
    const layout = getPathLabelLayoutFromLines(normalizedArrowLabelLines(el), pts, clampArrowLabelPosition(el.labelPosition), arrowLabelSide(el), fontSize, family, collisionBounds);
    arrowLabelLayoutCache.set(el, { points: pts, collisionBounds, layout });
    return layout;
}

export function normalizedConnectorTextLines(text: string | undefined, textDoc: TextDocument | undefined): RichLine[] {
    if (!text)
        return [];
    const source = canonicalLines({ textDoc, text, color: ARROW_LABEL_TEXT_COLOR });
    source.forEach(line => line.runs.forEach(run => { run.color = ARROW_LABEL_TEXT_COLOR; }));
    return source;
}

export function getBranchLabelLayout(branch: ArrowBranch, pts: Point[], collisionBounds: Bounds[] = []): ArrowLabelLayout | null {
    if (!branch.label) return null;
    const cached = branchLabelLayoutCache.get(branch);
    if (cached?.points === pts && cached.collisionBounds === collisionBounds) return cached.layout;
    const family = normalizeFontFamily(branch.labelFontFamily || DEFAULT_FONT_FAMILY);
    const layout = getPathLabelLayoutFromLines(normalizedConnectorTextLines(branch.label, branch.labelDoc), pts, clampArrowLabelPosition(branch.labelPosition), branch.labelSide === 1 ? 1 : -1, ARROW_LABEL_FONT_SIZE, family, collisionBounds);
    branchLabelLayoutCache.set(branch, { points: pts, collisionBounds, layout });
    return layout;
}

export function getEndpointLabelData(el: ArrowElement, kind: 'start' | 'end') {
    return kind === 'start' ? { text: el.startLabel, textDoc: el.startLabelDoc } : { text: el.endLabel, textDoc: el.endLabelDoc };
}

export function getEndpointLabelLayoutFromLines(el: ArrowElement, kind: 'start' | 'end', lines: RichLine[], family: string): ArrowLabelLayout {
    const pts = getArrowRenderPoints(el), point = kind === 'start' ? pts[0] : pts[pts.length - 1], near = kind === 'start' ? pts[Math.min(3, pts.length - 1)] : pts[Math.max(0, pts.length - 4)];
    const tangent = kind === 'start' ? unitTangent(point, near) : unitTangent(near, point), normal = { x: -tangent.y, y: tangent.x };
    const renderScale = ARROW_LABEL_FONT_SIZE / DEFAULT_TEXT_FONT_SIZE;
    const natural = measureRichTextLayoutFromLines(lines, DEFAULT_TEXT_FONT_SIZE, ARROW_LABEL_TEXT_COLOR, undefined, renderScale, family);
    const textWidth = Math.max(24, Math.min(ARROW_ENDPOINT_LABEL_MAX_WIDTH, Math.ceil(natural.width || 24)));
    const measured = measureRichTextLayoutFromLines(lines, DEFAULT_TEXT_FONT_SIZE, ARROW_LABEL_TEXT_COLOR, textWidth, renderScale, family);
    const textHeight = Math.max(ARROW_LABEL_FONT_SIZE * RICH_TEXT_LINE_HEIGHT, measured.height || ARROW_LABEL_FONT_SIZE * RICH_TEXT_LINE_HEIGHT), boxW = textWidth + ARROW_LABEL_PAD_X * 2, boxH = textHeight + ARROW_LABEL_PAD_Y * 2;
    // Endpoint labels sit outside the trunk, slightly above it, so they never mask the magnetic endpoint itself.
    const outward = kind === 'start' ? { x: -tangent.x, y: -tangent.y } : tangent, center = { x: point.x + outward.x * (boxW / 2 + 8) + normal.x * (-1) * (boxH / 2 + 3), y: point.y + outward.y * (boxW / 2 + 8) + normal.y * (-1) * (boxH / 2 + 3) }, box = { x: center.x - boxW / 2, y: center.y - boxH / 2, width: boxW, height: boxH };
    return { anchor: point, tangent, normal, side: -1, textX: box.x + ARROW_LABEL_PAD_X, textBaselineY: box.y + ARROW_LABEL_PAD_Y + ARROW_LABEL_FONT_SIZE, textWidth, textHeight, box, fontSize: ARROW_LABEL_FONT_SIZE, renderScale, family, lines: measured.lines };
}

export function getEndpointLabelLayout(el: ArrowElement, kind: 'start' | 'end'): ArrowLabelLayout | null {
    const data = getEndpointLabelData(el, kind);
    if (!data.text) return null;
    const points = getArrowRenderPoints(el);
    const cachedByKind = endpointLabelLayoutCache.get(el)?.[kind];
    if (cachedByKind?.points === points) return cachedByKind.layout;
    const family = normalizeFontFamily(kind === 'start' ? el.startLabelFontFamily || DEFAULT_FONT_FAMILY : el.endLabelFontFamily || DEFAULT_FONT_FAMILY);
    const layout = getEndpointLabelLayoutFromLines(el, kind, normalizedConnectorTextLines(data.text, data.textDoc), family);
    const entry = endpointLabelLayoutCache.get(el) || {};
    entry[kind] = { points, layout };
    endpointLabelLayoutCache.set(el, entry);
    return layout;
}

export function pointInBounds(p: Point, b: Bounds, pad = 0) { return p.x >= b.x - pad && p.x <= b.x + b.width + pad && p.y >= b.y - pad && p.y <= b.y + b.height + pad; }
