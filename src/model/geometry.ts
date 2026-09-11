// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { arrowPathMetrics, canonicalTangent, getArrowLabelLayout, getBranchLabelLayout, getEndpointLabelLayout, normalizeArrowCurveMode, normalizeArrowRoutingMode, pointInBounds } from '../arrows/index';
import { generateId } from './ids';
import { DEFAULT_FONT_FAMILY, TEXT_BBOX_PAD } from './text';
import { ArrowBranch, ArrowElement, ArrowLabelLayout, ArrowMode, ArrowPathLocation, BindingAnchor, Bounds, CanvasElement, ConnectableElement, ConnectionPoint, FreehandElement, Point } from './types';
import { getRichTextLayoutEpoch, getRichTextMetrics } from '../renderer/index';
import { getSelectionClusterForElement } from '../layers/model';
import { appState } from '../state/store';
import { pathIntersectsObstacleInteriors, routeOrthogonal, type RoutingObstacle } from '../arrows/routing';
import { insertWaypointAtNearestSegment, removeWaypointAtPathIndex } from '../arrows/waypoints';
import { getSceneElementById, getSceneGeometryGeneration, querySceneElements } from '../performance/scene-index';

// Cache freehand geometry so rendering does not rescan every point on every frame.
export const freehandPathCache = new WeakMap<FreehandElement, Path2D>();

export const freehandBoundsCache = new WeakMap<FreehandElement, Bounds>();

const elementBoundsCache = new WeakMap<CanvasElement, { generation: number; bounds: Bounds }>();

// --- 5. MATH, GEOMETRY & BOUNDING BOXES ---
export function getScreenToWorld(mouseX: number, mouseY: number): Point {
    return { x: (mouseX - appState.camera.x) / appState.camera.zoom, y: (mouseY - appState.camera.y) / appState.camera.zoom };
}

export function getWorldToScreen(point: Point): Point {
    return { x: point.x * appState.camera.zoom + appState.camera.x, y: point.y * appState.camera.zoom + appState.camera.y };
}

export function normalizedBounds(x: number, y: number, width: number, height: number): Bounds {
    return { x: Math.min(x, x + width), y: Math.min(y, y + height), width: Math.abs(width), height: Math.abs(height) };
}

export function getFreehandBounds(el: FreehandElement): Bounds {
    const cached = freehandBoundsCache.get(el);
    if (cached)
        return cached;
    if (!el.points.length) {
        const empty = { x: 0, y: 0, width: 0, height: 0 };
        freehandBoundsCache.set(el, empty);
        return empty;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of el.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
    }
    const pad = Math.max(2, el.thickness * 0.5);
    const bounds = { x: minX - pad, y: minY - pad, width: Math.max(0, maxX - minX) + pad * 2, height: Math.max(0, maxY - minY) + pad * 2 };
    freehandBoundsCache.set(el, bounds);
    return bounds;
}

export function extendFreehandBounds(el: FreehandElement, pt: Point) {
    const b = freehandBoundsCache.get(el);
    if (!b) {
        getFreehandBounds(el);
        return;
    }
    const pad = Math.max(2, el.thickness * 0.5);
    const minX = Math.min(b.x, pt.x - pad), minY = Math.min(b.y, pt.y - pad);
    const maxX = Math.max(b.x + b.width, pt.x + pad), maxY = Math.max(b.y + b.height, pt.y + pad);
    freehandBoundsCache.set(el, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    freehandPathCache.delete(el);
}

export function invalidateFreehandRenderCache(el: FreehandElement) {
    freehandBoundsCache.delete(el);
    freehandPathCache.delete(el);
}

export function getFreehandPath(el: FreehandElement): Path2D {
    const cached = freehandPathCache.get(el);
    if (cached)
        return cached;
    const path = new Path2D();
    if (el.points.length) {
        path.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++)
            path.lineTo(el.points[i].x, el.points[i].y);
    }
    freehandPathCache.set(el, path);
    return path;
}

export function getBoundingBox(el: CanvasElement): Bounds {
    if (el.type === 'freehand') return getFreehandBounds(el);
    if (el.type === 'text' && appState.editingTextId === el.id && appState.liveTextEditorBounds)
        return { ...appState.liveTextEditorBounds };

    const isArrow = el.type === 'arrow' || el.type === 'connector';
    const dynamicArrow = isArrow && appState.mode === 'moving' && isArrowAffectedByLiveMove(el as ArrowElement);
    const generation = isArrow ? getSceneGeometryGeneration() : el.type === 'text' ? getRichTextLayoutEpoch() : 0;
    const cached = !dynamicArrow ? elementBoundsCache.get(el) : undefined;
    if (cached?.generation === generation) return cached.bounds;

    let bounds: Bounds;
    if (el.type === 'rectangle' || el.type === 'note' || el.type === 'media') {
        bounds = normalizedBounds(el.x, el.y, el.width, el.height);
    } else if (el.type === 'text') {
        const metrics = getRichTextMetrics(el);
        bounds = {
            x: el.x - TEXT_BBOX_PAD,
            y: el.y - metrics.firstLineFontSize - TEXT_BBOX_PAD,
            width: Math.max(1, metrics.width + TEXT_BBOX_PAD * 2),
            height: Math.max(1, metrics.height + TEXT_BBOX_PAD * 2),
        };
    } else {
        const arrow = el as ArrowElement, pts = getArrowRenderPoints(arrow), allPts = [...pts];
        if (arrowMode(arrow) === 'branches')
            for (const branch of getArrowBranches(arrow)) allPts.push(...getArrowBranchRenderPoints(arrow, branch));
        const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
        let minX = Math.min(...xs) - 8, minY = Math.min(...ys) - 8, maxX = Math.max(...xs) + 8, maxY = Math.max(...ys) + 8;
        const include = (label: ArrowLabelLayout | null) => { if (label) {
            minX = Math.min(minX, label.box.x);
            maxX = Math.max(maxX, label.box.x + label.box.width);
            minY = Math.min(minY, label.box.y);
            maxY = Math.max(maxY, label.box.y + label.box.height);
        } };
        if (arrow.label) include(getArrowLabelLayout(arrow, pts, getArrowLabelCollisionBounds(arrow.id)));
        if (arrowMode(arrow) === 'branches') {
            if (arrow.startLabel) include(getEndpointLabelLayout(arrow, 'start'));
            if (arrow.endLabel) include(getEndpointLabelLayout(arrow, 'end'));
            for (const branch of getArrowBranches(arrow))
                if (branch.label) include(getBranchLabelLayout(branch, getArrowBranchRenderPoints(arrow, branch), getArrowLabelCollisionBounds(arrow.id)));
        }
        bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    if (!dynamicArrow) elementBoundsCache.set(el, { generation, bounds });
    return bounds;
}

function boundsForPoints(points: Point[], pad = 0): Bounds {
    if (!points.length) return { x: -pad, y: -pad, width: pad * 2, height: pad * 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of points) {
        minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
    const minX = Math.min(a.x, b.x), minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.width, b.x + b.width), maxY = Math.max(a.y + a.height, b.y + b.height);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Bounds used only by the scene spatial index. Auto-routed arrows stay outside
 * the grid because their route can depend on arbitrary obstacle changes. Manual
 * arrows use exact sampled path geometry plus label extents without doing the
 * global collision scan that getBoundingBox() intentionally performs.
 */
export function getSpatialIndexBounds(el: CanvasElement): Bounds {
    if (el.type !== 'arrow' && el.type !== 'connector') return getBoundingBox(el);
    const arrow = el as ArrowElement;
    const trunk = getArrowRenderPoints(arrow);
    let bounds = boundsForPoints(trunk, 12), labelExtent = 0;
    const includeExtent = (label: ArrowLabelLayout | null) => {
        if (label) labelExtent = Math.max(labelExtent, Math.max(label.box.width, label.box.height) + 24);
    };
    if (arrow.label) includeExtent(getArrowLabelLayout(arrow, trunk, []));
    if (arrowMode(arrow) === 'branches') {
        if (arrow.startLabel) includeExtent(getEndpointLabelLayout(arrow, 'start'));
        if (arrow.endLabel) includeExtent(getEndpointLabelLayout(arrow, 'end'));
        for (const branch of getArrowBranches(arrow)) {
            const points = getArrowBranchRenderPoints(arrow, branch);
            bounds = unionBounds(bounds, boundsForPoints(points, 12));
            if (branch.label) includeExtent(getBranchLabelLayout(branch, points, []));
        }
    }
    // Collision avoidance can move a label to the opposite side or along the
    // path. Expanding the whole path envelope by the label's largest dimension
    // is intentionally conservative and prevents false-negative culling/hits.
    return labelExtent ? expandedBounds(bounds, labelExtent) : bounds;
}

export function getGroupBoundingBox(ids: string[]): Bounds | null {
    if (!ids.length)
        return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    appState.elements.filter(el => ids.includes(el.id) && !el.hidden).forEach(el => { const b = getBoundingBox(el); minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height); });
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

export function hitTestPoint(point: Point, target: Point, radius = 10 / appState.camera.zoom) { return Math.hypot(point.x - target.x, point.y - target.y) <= radius; }

export function hitTestElement(p: Point, el: CanvasElement): boolean {
    const box = getBoundingBox(el), pad = 6 / appState.camera.zoom;
    return p.x >= box.x - pad && p.x <= box.x + box.width + pad && p.y >= box.y - pad && p.y <= box.y + box.height + pad;
}

export function getResizeHandles(box: Bounds) {
    const size = 10 / appState.camera.zoom;
    return { nw: { x: box.x - size / 2, y: box.y - size / 2, size }, ne: { x: box.x + box.width - size / 2, y: box.y - size / 2, size }, se: { x: box.x + box.width - size / 2, y: box.y + box.height - size / 2, size }, sw: { x: box.x - size / 2, y: box.y + box.height - size / 2, size } };
}

export function expandSelectionToGroups(ids: string[]): string[] {
    // Canvas selection expands to the outermost real Layer group. Locked/hidden
    // descendants remain inert and are intentionally excluded, preserving the
    // existing Illustrator-style interaction rule.
    const finalIds = new Set<string>();
    for (const id of ids) {
        const cluster = getSelectionClusterForElement(appState.elements, appState.layerGroups, id);
        for (const memberId of cluster.ids) finalIds.add(memberId);
    }
    return [...finalIds];
}

export function rectsIntersect(a: Bounds, b: Bounds) { return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y; }

export function selectionFromMarquee(start: Point, end: Point): string[] {
    const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    const ids = querySceneElements(box, getSpatialIndexBounds).filter(el => !el.locked && !el.hidden && rectsIntersect(getBoundingBox(el), box)).map(el => el.id), expanded = expandSelectionToGroups(ids);
    return appState.marqueeStartSelection.length ? expandSelectionToGroups([...appState.marqueeStartSelection, ...expanded]) : expanded;
}

export function elementCenter(el: CanvasElement): Point { const b = getBoundingBox(el); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }

export function isConnectableShape(el: CanvasElement): el is ConnectableElement {
    return el.type === 'note' || el.type === 'rectangle' || el.type === 'media' || el.type === 'text';
}

export function getConnectionPointPosition(el: ConnectableElement, point: ConnectionPoint): Point {
    const b = getBoundingBox(el);
    const xMid = b.x + b.width / 2, yMid = b.y + b.height / 2, xRight = b.x + b.width, yBottom = b.y + b.height;
    switch (point) {
        case 'top': return { x: xMid, y: b.y };
        case 'top-right': return { x: xRight, y: b.y };
        case 'right': return { x: xRight, y: yMid };
        case 'bottom-right': return { x: xRight, y: yBottom };
        case 'bottom': return { x: xMid, y: yBottom };
        case 'bottom-left': return { x: b.x, y: yBottom };
        case 'left': return { x: b.x, y: yMid };
        default: return { x: b.x, y: b.y };
    }
}

export function getConnectionPoints(el: ConnectableElement): {
    point: ConnectionPoint;
    position: Point;
}[] {
    return (['top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left'] as ConnectionPoint[]).map(point => ({ point, position: getConnectionPointPosition(el, point) }));
}

export function closestPointOnBounds(p: Point, b: Bounds): Point {
    const x = Math.max(b.x, Math.min(b.x + b.width, p.x)), y = Math.max(b.y, Math.min(b.y + b.height, p.y));
    const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    if (!inside)
        return { x, y };
    const edges = [{ d: Math.abs(p.y - b.y), p: { x: p.x, y: b.y } }, { d: Math.abs(p.x - (b.x + b.width)), p: { x: b.x + b.width, y: p.y } }, { d: Math.abs(p.y - (b.y + b.height)), p: { x: p.x, y: b.y + b.height } }, { d: Math.abs(p.x - b.x), p: { x: b.x, y: p.y } }];
    edges.sort((a, b) => a.d - b.d);
    return edges[0].p;
}

export function anchorFromPoint(point: Point, b: Bounds): BindingAnchor {
    return { x: b.width ? Math.max(0, Math.min(1, (point.x - b.x) / b.width)) : 0.5, y: b.height ? Math.max(0, Math.min(1, (point.y - b.y) / b.height)) : 0.5 };
}

export function pointFromAnchor(anchor: BindingAnchor, b: Bounds): Point { return { x: b.x + b.width * Math.max(0, Math.min(1, anchor.x)), y: b.y + b.height * Math.max(0, Math.min(1, anchor.y)) }; }

export function findConnectionAtPoint(p: Point, excludeId?: string): {
    id: string;
    point?: ConnectionPoint;
    anchor: BindingAnchor;
    position: Point;
} | undefined {
    const limit = 16 / appState.camera.zoom;
    let best: {
        id: string;
        point?: ConnectionPoint;
        anchor: BindingAnchor;
        position: Point;
        distance: number;
    } | undefined;
    const nearby = querySceneElements({ x: p.x - limit, y: p.y - limit, width: limit * 2, height: limit * 2 }, getSpatialIndexBounds, { includeVolatileAutoArrows: false });
    for (let i = nearby.length - 1; i >= 0; i--) {
        const el = nearby[i];
        if (el.locked || el.hidden || el.id === excludeId || !isConnectableShape(el))
            continue;
        const b = getBoundingBox(el);
        const expanded = { x: b.x - limit, y: b.y - limit, width: b.width + limit * 2, height: b.height + limit * 2 };
        if (p.x < expanded.x || p.x > expanded.x + expanded.width || p.y < expanded.y || p.y > expanded.y + expanded.height)
            continue;
        // Prefer the named eight anchors when they are close, but allow the whole
        // perimeter to behave magnetically between those anchors.
        for (const cp of getConnectionPoints(el)) {
            const d = Math.hypot(p.x - cp.position.x, p.y - cp.position.y);
            if (d <= limit && (!best || d < best.distance))
                best = { id: el.id, point: cp.point, anchor: anchorFromPoint(cp.position, b), position: cp.position, distance: d };
        }
        const projected = closestPointOnBounds(p, b), d = Math.hypot(p.x - projected.x, p.y - projected.y), inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
        if ((inside || d <= limit) && (!best || d < best.distance))
            best = { id: el.id, anchor: anchorFromPoint(projected, b), position: projected, distance: d };
    }
    return best ? { id: best.id, point: best.point, anchor: best.anchor, position: best.position } : undefined;
}

export function findBindingAtPoint(p: Point, excludeId?: string): string | undefined { return findConnectionAtPoint(p, excludeId)?.id; }

export function getLiveMoveDeltaForElement(id: string | undefined): Point {
    if (!id || appState.mode !== 'moving' || !appState.movingSelectionIds.has(id))
        return { x: 0, y: 0 };
    return appState.activeMoveDelta;
}

export function boundPoint(bindingId: string | undefined, fallback: Point, toward: Point, bindingPoint?: ConnectionPoint, bindingAnchor?: BindingAnchor): Point {
    const el = bindingId ? getSceneElementById(bindingId) : undefined;
    if (!el)
        return fallback;
    const move = getLiveMoveDeltaForElement(el.id);
    const raw = getBoundingBox(el);
    const b = { x: raw.x + move.x, y: raw.y + move.y, width: raw.width, height: raw.height };
    if (bindingAnchor)
        return pointFromAnchor(bindingAnchor, b);
    if (bindingPoint && isConnectableShape(el)) {
        const p = getConnectionPointPosition(el, bindingPoint);
        return { x: p.x + move.x, y: p.y + move.y };
    }
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }, dx = toward.x - c.x, dy = toward.y - c.y;
    if (Math.abs(dx) < .0001 && Math.abs(dy) < .0001)
        return c;
    const tx = Math.abs(dx) > .0001 ? (b.width / 2) / Math.abs(dx) : Infinity, ty = Math.abs(dy) > .0001 ? (b.height / 2) / Math.abs(dy) : Infinity, t = Math.min(tx, ty);
    return { x: c.x + dx * t, y: c.y + dy * t };
}

export function isArrowAffectedByLiveMove(el: CanvasElement): el is ArrowElement {
    if (appState.mode !== 'moving' || (el.type !== 'arrow' && el.type !== 'connector'))
        return false;
    if (appState.movingSelectionIds.has(el.id))
        return true;
    if ((el.startBinding && appState.movingSelectionIds.has(el.startBinding)) || (el.endBinding && appState.movingSelectionIds.has(el.endBinding)))
        return true;
    return getArrowBranches(el).some(branch => !!branch.endBinding && appState.movingSelectionIds.has(branch.endBinding));
}

export function lerpPoint(a: Point, b: Point, t: number): Point { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

export function getArrowInteriorPoints(el: ArrowElement): Point[] {
    if (Array.isArray(el.controls))
        return el.controls.map(p => ({ x: p.x, y: p.y }));
    return [{ x: el.control.x, y: el.control.y }];
}

export function setArrowInteriorPoints(el: ArrowElement, points: Point[]) {
    el.controls = points.map(p => ({ x: p.x, y: p.y }));
    if (points.length === 1) el.pointCount = 3;
    else if (points.length === 3) el.pointCount = 5;
    else delete el.pointCount;
    el.control = { ...(points[Math.floor(points.length / 2)] || lerpPoint(el.start, el.end, .5)) };
}

const arrowPathCache = new WeakMap<ArrowElement, { startTarget?: CanvasElement; endTarget?: CanvasElement; points: Point[] }>();
const arrowRenderCache = new WeakMap<ArrowElement, { sourcePoints: Point[]; curveMode: string; points: Point[] }>();
const branchPathCache = new WeakMap<ArrowBranch, { trunk: Point[]; endTarget?: CanvasElement; points: Point[] }>();
const branchRenderCache = new WeakMap<ArrowBranch, { sourcePoints: Point[]; curveMode: string; points: Point[] }>();

export function getArrowPathPoints(el: ArrowElement): Point[] {
    const dynamicMove = appState.mode === 'moving' && isArrowAffectedByLiveMove(el);
    const startTarget = el.startBinding ? getSceneElementById(el.startBinding) : undefined;
    const endTarget = el.endBinding ? getSceneElementById(el.endBinding) : undefined;
    const cached = !dynamicMove ? arrowPathCache.get(el) : undefined;
    if (cached && cached.startTarget === startTarget && cached.endTarget === endTarget) return cached.points;
    const startMove = getLiveMoveDeltaForElement(el.startBinding), endMove = getLiveMoveDeltaForElement(el.endBinding);
    const interiors = getArrowInteriorPoints(el);
    const fallbackStart = el.start, fallbackEnd = el.end;
    const endForStart = boundPoint(el.endBinding, fallbackEnd, fallbackStart, el.endBindingPoint, el.endBindingAnchor);
    const startForEnd = boundPoint(el.startBinding, fallbackStart, fallbackEnd, el.startBindingPoint, el.startBindingAnchor);
    const start = boundPoint(el.startBinding, fallbackStart, endForStart, el.startBindingPoint, el.startBindingAnchor);
    const end = boundPoint(el.endBinding, fallbackEnd, startForEnd, el.endBindingPoint, el.endBindingAnchor);
    const adjusted = interiors.map((pt, i) => { const t = (i + 1) / (interiors.length + 1); return { x: pt.x + startMove.x * (1 - t) + endMove.x * t, y: pt.y + startMove.y * (1 - t) + endMove.y * t }; });
    const points = [start, ...adjusted, end];
    if (!dynamicMove) arrowPathCache.set(el, { startTarget, endTarget, points });
    return points;
}

export function getArrowCurvePoints(el: ArrowElement): {
    start: Point;
    control: Point;
    end: Point;
} { const pts = getArrowPathPoints(el); return { start: pts[0], control: pts[Math.floor(pts.length / 2)], end: pts[pts.length - 1] }; }

// Smooth Catmull-Rom sampling keeps the user's 3/5 control points intuitive
// while rendering a professional continuous connector through them.
export function sampleSmoothPath(points: Point[], samplesPerSegment = 18): Point[] {
    if (points.length <= 2)
        return points.map(p => ({ ...p }));
    const out: Point[] = [{ ...points[0] }], samples = Math.max(6, samplesPerSegment), alpha = .5;
    const extrapolate = (a: Point, b: Point): Point => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y });
    const tj = (ti: number, a: Point, b: Point) => ti + Math.pow(Math.max(1e-4, Math.hypot(b.x - a.x, b.y - a.y)), alpha);
    const mix = (a: Point, b: Point, ta: number, tb: number, u: number): Point => { const den = Math.max(1e-6, tb - ta); return { x: (tb - u) / den * a.x + (u - ta) / den * b.x, y: (tb - u) / den * a.y + (u - ta) / den * b.y }; };
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1], p0 = i > 0 ? points[i - 1] : extrapolate(p1, p2), p3 = i + 2 < points.length ? points[i + 2] : extrapolate(p2, p1);
        const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
        for (let s = 1; s <= samples; s++) {
            const u = t1 + (t2 - t1) * (s / samples), a1 = mix(p0, p1, t0, t1, u), a2 = mix(p1, p2, t1, t2, u), a3 = mix(p2, p3, t2, t3, u), b1 = mix(a1, a2, t0, t2, u), b2 = mix(a2, a3, t1, t3, u), c = mix(b1, b2, t1, t2, u);
            out.push(c);
        }
    }
    return out;
}

export const AUTO_ROUTE_CLEARANCE = 20;
export const MAX_ARROW_WAYPOINTS = 32;

function expandedBounds(b: Bounds, amount: number): Bounds {
    return { x: b.x - amount, y: b.y - amount, width: b.width + amount * 2, height: b.height + amount * 2 };
}

function movedBounds(el: CanvasElement): Bounds {
    const b = getBoundingBox(el), move = getLiveMoveDeltaForElement(el.id);
    return { x: b.x + move.x, y: b.y + move.y, width: b.width, height: b.height };
}

function outwardVector(bindingPoint: ConnectionPoint | undefined, endpoint: Point, b: Bounds): Point {
    if (bindingPoint) {
        const vectors: Record<ConnectionPoint, Point> = {
            top: { x: 0, y: -1 }, 'top-right': { x: 1, y: -1 }, right: { x: 1, y: 0 }, 'bottom-right': { x: 1, y: 1 },
            bottom: { x: 0, y: 1 }, 'bottom-left': { x: -1, y: 1 }, left: { x: -1, y: 0 }, 'top-left': { x: -1, y: -1 },
        };
        return vectors[bindingPoint];
    }
    const sides = [
        { d: Math.abs(endpoint.y - b.y), v: { x: 0, y: -1 } },
        { d: Math.abs(endpoint.x - (b.x + b.width)), v: { x: 1, y: 0 } },
        { d: Math.abs(endpoint.y - (b.y + b.height)), v: { x: 0, y: 1 } },
        { d: Math.abs(endpoint.x - b.x), v: { x: -1, y: 0 } },
    ];
    sides.sort((a, b2) => a.d - b2.d);
    return sides[0].v;
}

function routeStub(endpoint: Point, bindingId?: string, bindingPoint?: ConnectionPoint): Point {
    const candidate = bindingId ? getSceneElementById(bindingId) : undefined;
    const bound = candidate && !candidate.hidden ? candidate : undefined;
    if (!bound || !isConnectableShape(bound)) return { ...endpoint };
    const b = movedBounds(bound), v = outwardVector(bindingPoint, endpoint, b), distance = AUTO_ROUTE_CLEARANCE + 2;
    return { x: endpoint.x + v.x * distance, y: endpoint.y + v.y * distance };
}

let labelCollisionBoundsCache: { generation: number; bounds: Bounds[] } | null = null;
const autoRouteCache = new WeakMap<ArrowElement, { key: string; validationBounds: Bounds; validationSignature: string; points: Point[] }>();
const AUTO_ROUTE_SEARCH_MIN_MARGIN = 180;
const AUTO_ROUTE_SEARCH_MAX_MARGIN = 720;
const AUTO_ROUTE_VALIDATION_PAD = 56;

function isAutoRouteObstacle(item: CanvasElement): boolean {
    return !item.hidden && (item.type === 'note' || item.type === 'rectangle' || item.type === 'media' || item.type === 'text');
}

function routeSearchBounds(start: Point, end: Point, margin: number): Bounds {
    const minX = Math.min(start.x, end.x), minY = Math.min(start.y, end.y);
    return { x: minX - margin, y: minY - margin, width: Math.abs(end.x - start.x) + margin * 2, height: Math.abs(end.y - start.y) + margin * 2 };
}

function autoRouteObstacleSignature(obstacles: RoutingObstacle[]): string {
    return obstacles
        .map(obstacle => `${obstacle.id || ''}:${obstacle.bounds.x.toFixed(2)},${obstacle.bounds.y.toFixed(2)},${obstacle.bounds.width.toFixed(2)},${obstacle.bounds.height.toFixed(2)}`)
        .sort()
        .join(';');
}

function getAutoRouteObstaclesInBounds(bounds: Bounds, forceIds: string[] = []): RoutingObstacle[] {
    const byId = new Map<string, CanvasElement>();
    for (const item of querySceneElements(bounds, getSpatialIndexBounds, { includeVolatileAutoArrows: false })) {
        if (!isAutoRouteObstacle(item)) continue;
        const moved = movedBounds(item);
        if (rectsIntersect(expandedBounds(moved, AUTO_ROUTE_CLEARANCE), bounds)) byId.set(item.id, item);
    }
    // During live movement the spatial index still owns the committed position.
    // Add moving/bound targets explicitly so a target that crossed into the route
    // corridor this frame cannot be missed by the local candidate query.
    for (const id of [...appState.movingSelectionIds, ...forceIds]) {
        const item = getSceneElementById(id);
        if (item && isAutoRouteObstacle(item)) byId.set(item.id, item);
    }
    return [...byId.values()].map(item => ({ id: item.id, bounds: expandedBounds(movedBounds(item), AUTO_ROUTE_CLEARANCE) }));
}

function filterEndpointContainingObstacles(obstacles: RoutingObstacle[], start: Point, end: Point, startBinding?: string, endBinding?: string): RoutingObstacle[] {
    return obstacles.filter(obstacle => {
        if (obstacle.id === startBinding || obstacle.id === endBinding) return true;
        const b = obstacle.bounds;
        const containsStart = start.x > b.x && start.x < b.x + b.width && start.y > b.y && start.y < b.y + b.height;
        const containsEnd = end.x > b.x && end.x < b.x + b.width && end.y > b.y && end.y < b.y + b.height;
        return !containsStart && !containsEnd;
    });
}

function routeWithLocalObstacles(start: Point, end: Point, initialObstacles: RoutingObstacle[], startBinding?: string, endBinding?: string): { route: Point[]; obstacles: RoutingObstacle[]; validationBounds: Bounds; validationSignature: string } {
    let obstacles = initialObstacles;
    let route = routeOrthogonal(start, end, obstacles);
    let validationBounds = expandedBounds(boundsForPoints(route), AUTO_ROUTE_CLEARANCE + AUTO_ROUTE_VALIDATION_PAD);
    let validationCandidates = filterEndpointContainingObstacles(getAutoRouteObstaclesInBounds(validationBounds, [startBinding || '', endBinding || ''].filter(Boolean)), start, end, startBinding, endBinding);

    // A local first pass keeps dense boards fast. Validate the resulting corridor
    // and expand only when the chosen detour actually encounters an omitted shape.
    // This preserves correctness without feeding every object on the board into A*.
    for (let attempt = 0; attempt < 2; attempt++) {
        const known = new Set(obstacles.map(obstacle => obstacle.id));
        const blockingExtras = validationCandidates.filter(obstacle => !known.has(obstacle.id) && pathIntersectsObstacleInteriors(route, [obstacle]));
        if (!blockingExtras.length) break;
        obstacles = [...obstacles, ...blockingExtras];
        route = routeOrthogonal(start, end, obstacles);
        validationBounds = expandedBounds(boundsForPoints(route), AUTO_ROUTE_CLEARANCE + AUTO_ROUTE_VALIDATION_PAD);
        validationCandidates = filterEndpointContainingObstacles(getAutoRouteObstaclesInBounds(validationBounds, [startBinding || '', endBinding || ''].filter(Boolean)), start, end, startBinding, endBinding);
    }
    return { route, obstacles, validationBounds, validationSignature: autoRouteObstacleSignature(validationCandidates) };
}

export function isArrowAutoRouted(el: ArrowElement): boolean {
    return normalizeArrowRoutingMode(el.routingMode) === 'auto' && arrowMode(el) === 'connection';
}

export function getArrowAutoRoutePoints(el: ArrowElement): Point[] {
    const manual = getArrowPathPoints(el), start = manual[0], end = manual[manual.length - 1];
    const routeStart = routeStub(start, el.startBinding, el.startBindingPoint), routeEnd = routeStub(end, el.endBinding, el.endBindingPoint);
    const forceIds = [el.startBinding || '', el.endBinding || ''].filter(Boolean);
    const distance = Math.hypot(routeEnd.x - routeStart.x, routeEnd.y - routeStart.y);
    const margin = Math.max(AUTO_ROUTE_SEARCH_MIN_MARGIN, Math.min(AUTO_ROUTE_SEARCH_MAX_MARGIN, distance * .35));
    const initialObstacles = filterEndpointContainingObstacles(getAutoRouteObstaclesInBounds(routeSearchBounds(routeStart, routeEnd, margin), forceIds), routeStart, routeEnd, el.startBinding, el.endBinding);
    const baseKey = [start.x, start.y, end.x, end.y, routeStart.x, routeStart.y, routeEnd.x, routeEnd.y, autoRouteObstacleSignature(initialObstacles), appState.mode === 'moving' ? `${appState.activeMoveDelta.x},${appState.activeMoveDelta.y}` : 'static'].join('|');
    const cached = autoRouteCache.get(el);
    if (cached?.key === baseKey) {
        const validation = filterEndpointContainingObstacles(getAutoRouteObstaclesInBounds(cached.validationBounds, forceIds), routeStart, routeEnd, el.startBinding, el.endBinding);
        if (autoRouteObstacleSignature(validation) === cached.validationSignature) return cached.points;
    }

    const routed = routeWithLocalObstacles(routeStart, routeEnd, initialObstacles, el.startBinding, el.endBinding);
    const middle = routed.route;
    const combined = [start, ...(Math.hypot(start.x - routeStart.x, start.y - routeStart.y) > .001 ? [routeStart] : []), ...middle.slice(1, -1), ...(Math.hypot(end.x - routeEnd.x, end.y - routeEnd.y) > .001 ? [routeEnd] : []), end];
    const points: Point[] = [];
    for (const point of combined) {
        const previous = points[points.length - 1];
        if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > .001) points.push({ ...point });
    }
    autoRouteCache.set(el, { key: baseKey, validationBounds: routed.validationBounds, validationSignature: routed.validationSignature, points });
    return points;
}

export function getArrowRoutingPoints(el: ArrowElement): Point[] {
    return isArrowAutoRouted(el) ? getArrowAutoRoutePoints(el) : getArrowPathPoints(el);
}

export function sampleRoundedRoute(points: Point[], radius = 10, samplesPerCorner = 5): Point[] {
    if (points.length < 3) return points.map(point => ({ ...point }));
    const out: Point[] = [{ ...points[0] }];
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1], corner = points[i], next = points[i + 1];
        const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y), outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        if (r <= .001) { out.push({ ...corner }); continue; }
        const before = { x: corner.x + (prev.x - corner.x) * (r / inLen), y: corner.y + (prev.y - corner.y) * (r / inLen) };
        const after = { x: corner.x + (next.x - corner.x) * (r / outLen), y: corner.y + (next.y - corner.y) * (r / outLen) };
        out.push(before);
        for (let sample = 1; sample <= samplesPerCorner; sample++) {
            const t = sample / (samplesPerCorner + 1), u = 1 - t;
            out.push({ x: u * u * before.x + 2 * u * t * corner.x + t * t * after.x, y: u * u * before.y + 2 * u * t * corner.y + t * t * after.y });
        }
        out.push(after);
    }
    out.push({ ...points[points.length - 1] });
    return out;
}

export function getArrowRenderPoints(el: ArrowElement): Point[] {
    const dynamicMove = appState.mode === 'moving' && isArrowAffectedByLiveMove(el);
    const curveMode = normalizeArrowCurveMode(el.curveMode);
    const pts = getArrowRoutingPoints(el);
    const cached = !dynamicMove ? arrowRenderCache.get(el) : undefined;
    if (cached?.sourcePoints === pts && cached.curveMode === curveMode) return cached.points;
    const points = curveMode === 'sharp' ? pts : (isArrowAutoRouted(el) ? sampleRoundedRoute(pts) : sampleSmoothPath(pts));
    if (!dynamicMove) arrowRenderCache.set(el, { sourcePoints: pts, curveMode, points });
    return points;
}

export function getArrowLabelCollisionBounds(_excludeArrowId?: string): Bounds[] {
    const pad = 4, generation = getSceneGeometryGeneration(), dynamicMove = appState.mode === 'moving';
    if (!dynamicMove && labelCollisionBoundsCache?.generation === generation) return labelCollisionBoundsCache.bounds;
    const bounds = appState.elements.filter(item => !item.hidden && (item.type === 'note' || item.type === 'rectangle')).map(item => expandedBounds(movedBounds(item), pad));
    if (!dynamicMove) labelCollisionBoundsCache = { generation, bounds };
    return bounds;
}

export function insertArrowWaypoint(el: ArrowElement, p: Point): number {
    const interiors = getArrowInteriorPoints(el);
    if (interiors.length >= MAX_ARROW_WAYPOINTS) return -1;
    const result = insertWaypointAtNearestSegment(interiors, getArrowPathPoints(el), p);
    setArrowInteriorPoints(el, result.interiors);
    return result.pathPointIndex;
}

export function removeArrowWaypoint(el: ArrowElement, pathPointIndex: number): boolean {
    const result = removeWaypointAtPathIndex(getArrowInteriorPoints(el), pathPointIndex);
    if (result.changed) setArrowInteriorPoints(el, result.interiors);
    return result.changed;
}

export function insertBranchWaypoint(el: ArrowElement, branch: ArrowBranch, p: Point): number {
    const path = getArrowBranchPathPoints(el, branch), root = path[0];
    const interiors = getBranchInteriorPoints(branch, root);
    if (interiors.length >= MAX_ARROW_WAYPOINTS) return -1;
    const result = insertWaypointAtNearestSegment(interiors, path, p);
    setBranchInteriorPoints(branch, result.interiors);
    return result.pathPointIndex;
}

export function removeBranchWaypoint(el: ArrowElement, branch: ArrowBranch, pathPointIndex: number): boolean {
    const path = getArrowBranchPathPoints(el, branch), root = path[0];
    const result = removeWaypointAtPathIndex(getBranchInteriorPoints(branch, root), pathPointIndex);
    if (result.changed) setBranchInteriorPoints(branch, result.interiors);
    return result.changed;
}

export function arrowMode(el: ArrowElement): ArrowMode { return el.arrowMode === 'branches' ? 'branches' : 'connection'; }

export function getArrowBranches(el: ArrowElement): ArrowBranch[] { return Array.isArray(el.branches) ? el.branches : []; }

export function getBranchInteriorPoints(branch: ArrowBranch, root: Point): Point[] {
    if (Array.isArray(branch.controls))
        return branch.controls.map(pt => ({ ...pt }));
    return [lerpPoint(root, branch.end, .5)];
}

export function setBranchInteriorPoints(branch: ArrowBranch, points: Point[]) { branch.controls = points.map(pt => ({ ...pt })); if (points.length === 1) branch.pointCount = 3; else if (points.length === 3) branch.pointCount = 5; else delete branch.pointCount; }

export function getArrowBranchPathPoints(el: ArrowElement, branch: ArrowBranch): Point[] {
    const dynamicMove = appState.mode === 'moving' && isArrowAffectedByLiveMove(el);
    const trunk = getArrowPathPoints(el), root = branch.root === 'start' ? trunk[0] : trunk[trunk.length - 1];
    const bound = branch.endBinding ? getSceneElementById(branch.endBinding) : undefined;
    const cached = !dynamicMove ? branchPathCache.get(branch) : undefined;
    if (cached && cached.trunk === trunk && cached.endTarget === bound) return cached.points;
    let end = branch.end;
    const endMove = getLiveMoveDeltaForElement(branch.endBinding), rootMove = getLiveMoveDeltaForElement(branch.root === 'start' ? el.startBinding : el.endBinding);
    if (bound) {
        const move = endMove, raw = getBoundingBox(bound), b = { x: raw.x + move.x, y: raw.y + move.y, width: raw.width, height: raw.height };
        if (branch.endBindingAnchor)
            end = pointFromAnchor(branch.endBindingAnchor, b);
        else if (branch.endBindingPoint && isConnectableShape(bound)) {
            const q = getConnectionPointPosition(bound, branch.endBindingPoint);
            end = { x: q.x + move.x, y: q.y + move.y };
        }
        else
            end = closestPointOnBounds(root, b);
    }
    const interiors = getBranchInteriorPoints(branch, root).map((pt, i, arr) => { const u = (i + 1) / (arr.length + 1); return { x: pt.x + rootMove.x * (1 - u) + endMove.x * u, y: pt.y + rootMove.y * (1 - u) + endMove.y * u }; });
    const points = [root, ...interiors, end];
    if (!dynamicMove) branchPathCache.set(branch, { trunk, endTarget: bound, points });
    return points;
}

export function getArrowBranchRenderPoints(el: ArrowElement, branch: ArrowBranch): Point[] {
    const dynamicMove = appState.mode === 'moving' && isArrowAffectedByLiveMove(el);
    const curveMode = normalizeArrowCurveMode(el.curveMode);
    const pts = getArrowBranchPathPoints(el, branch);
    const cached = !dynamicMove ? branchRenderCache.get(branch) : undefined;
    if (cached?.sourcePoints === pts && cached.curveMode === curveMode) return cached.points;
    const points = curveMode === 'sharp' ? pts : sampleSmoothPath(pts);
    if (!dynamicMove) branchRenderCache.set(branch, { sourcePoints: pts, curveMode, points });
    return points;
}

export function distanceToBranchPath(p: Point, el: ArrowElement, branch: ArrowBranch): number { const pts = getArrowBranchRenderPoints(el, branch); let best = Infinity; for (let i = 0; i < pts.length - 1; i++)
    best = Math.min(best, distanceToSegment(p, pts[i], pts[i + 1])); return best; }

export function distanceToAnyArrowPath(p: Point, el: ArrowElement): number { let best = distanceToArrowPath(p, el); if (arrowMode(el) === 'branches')
    for (const branch of getArrowBranches(el))
        best = Math.min(best, distanceToBranchPath(p, el, branch)); return best; }

export function hitTestArrowVisual(p: Point, el: ArrowElement): boolean {
    if (distanceToAnyArrowPath(p, el) < 10 / appState.camera.zoom)
        return true;
    const label = getArrowLabelLayout(el, getArrowRenderPoints(el), getArrowLabelCollisionBounds(el.id));
    if (label && pointInBounds(p, label.box, 4 / appState.camera.zoom))
        return true;
    if (arrowMode(el) === 'branches') {
        const s = getEndpointLabelLayout(el, 'start'), e = getEndpointLabelLayout(el, 'end');
        if (s && pointInBounds(p, s.box, 4 / appState.camera.zoom))
            return true;
        if (e && pointInBounds(p, e.box, 4 / appState.camera.zoom))
            return true;
        for (const branch of getArrowBranches(el)) {
            const b = getBranchLabelLayout(branch, getArrowBranchRenderPoints(el, branch), getArrowLabelCollisionBounds(el.id));
            if (b && pointInBounds(p, b.box, 4 / appState.camera.zoom))
                return true;
        }
    }
    return false;
}

export function nearestBranchPathLocation(p: Point, el: ArrowElement, branch: ArrowBranch): ArrowPathLocation & {
    hitDistance: number;
} {
    const pts = getArrowBranchRenderPoints(el, branch), { lengths, total } = arrowPathMetrics(pts);
    let bestDistance = Infinity, bestSeg = 0, bestT = 0, bestCum = 0, cum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0, q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < bestDistance) {
            bestDistance = d;
            bestSeg = i;
            bestT = t;
            bestCum = cum;
        }
        cum += lengths[i] || 0;
    }
    const a = pts[bestSeg], b = pts[bestSeg + 1], point = lerpPoint(a, b, bestT), tangent = canonicalTangent(a, b), normal = { x: -tangent.y, y: tangent.x }, distance = bestCum + (lengths[bestSeg] || 0) * bestT;
    return { point, tangent, normal, segmentIndex: bestSeg, pathPosition: total ? distance / total : .5, distance, totalLength: total, hitDistance: bestDistance };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; if (!l2)
    return Math.hypot(p.x - a.x, p.y - a.y); const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)); }

export function distanceToArrowPath(p: Point, el: ArrowElement): number { const pts = getArrowRenderPoints(el); let best = Infinity; for (let i = 0; i < pts.length - 1; i++)
    best = Math.min(best, distanceToSegment(p, pts[i], pts[i + 1])); return best; }

export function arrowMiddlePoint(el: ArrowElement): Point { const pts = getArrowPathPoints(el); return pts[Math.floor(pts.length / 2)]; }

export function setBranchPointCount(el: ArrowElement, branch: ArrowBranch, count: 3 | 5) {
    const pts = getArrowBranchPathPoints(el, branch), start = pts[0], end = pts[pts.length - 1], middle = pts[Math.floor(pts.length / 2)] || lerpPoint(start, end, .5);
    if (count === 3)
        setBranchInteriorPoints(branch, [middle]);
    else
        setBranchInteriorPoints(branch, [lerpPoint(start, middle, .5), middle, lerpPoint(middle, end, .5)]);
}

export function setArrowPointCount(el: ArrowElement, count: 3 | 5) {
    const pts = getArrowPathPoints(el), start = pts[0], end = pts[pts.length - 1];
    if (count === 3) {
        const middle = pts[Math.floor(pts.length / 2)] || lerpPoint(start, end, .5);
        setArrowInteriorPoints(el, [middle]);
    }
    else {
        const middle = pts[Math.floor(pts.length / 2)] || lerpPoint(start, end, .5);
        // Preserve the current bend at the center and insert stable quarter controls.
        setArrowInteriorPoints(el, [lerpPoint(start, middle, .5), middle, lerpPoint(middle, end, .5)]);
    }
    if (arrowMode(el) === 'branches')
        for (const branch of getArrowBranches(el))
            setBranchPointCount(el, branch, count);
}

export function getEndpointOutwardDirection(el: ArrowElement, root: 'start' | 'end'): Point {
    const pts = getArrowRenderPoints(el);
    if (pts.length < 2)
        return { x: root === 'start' ? -1 : 1, y: 0 };
    const a = root === 'start' ? pts[Math.min(4, pts.length - 1)] : pts[Math.max(0, pts.length - 5)], b = root === 'start' ? pts[0] : pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

export function createArrowBranches(el: ArrowElement, root: 'start' | 'end', count: number) {
    const n = Math.max(1, Math.min(50, Math.floor(count) || 1)), trunk = getArrowPathPoints(el), origin = root === 'start' ? trunk[0] : trunk[trunk.length - 1], dir = getEndpointOutwardDirection(el, root);
    const baseAngle = Math.atan2(dir.y, dir.x), spread = Math.min(Math.PI * .72, Math.max(Math.PI / 8, (n - 1) * Math.PI / 12)), length = 150;
    if (!Array.isArray(el.branches))
        el.branches = [];
    for (let i = 0; i < n; i++) {
        const angle = n === 1 ? baseAngle : baseAngle - spread / 2 + spread * (i / (n - 1)), end = { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
        const middle = lerpPoint(origin, end, .5);
        // Pull the midpoint slightly along the shared outward tangent. Adjacent branches
        // leave the root as a coherent bundle, then fan out naturally.
        middle.x = origin.x + dir.x * 42 + (end.x - origin.x) * .45;
        middle.y = origin.y + dir.y * 42 + (end.y - origin.y) * .45;
        const countMode = el.pointCount === 5 ? 5 : 3, controls = countMode === 5 ? [lerpPoint(origin, middle, .5), middle, lerpPoint(middle, end, .5)] : [middle];
        el.branches.push({ id: generateId(), root, end, controls, pointCount: countMode, labelPosition: .55, labelSide: -1, labelFontFamily: DEFAULT_FONT_FAMILY });
    }
}

export function removeArrowBranch(el: ArrowElement, branchId: string) { if (!el.branches)
    return; el.branches = el.branches.filter(branch => branch.id !== branchId); }

export function setArrowMode(el: ArrowElement, next: ArrowMode) { el.arrowMode = next; if (next === 'branches') { el.routingMode = 'manual'; if (!Array.isArray(el.branches)) el.branches = []; } }

export function closestConnectionPair(a: ConnectableElement, b: ConnectableElement) {
    let best: {
        a: {
            point: ConnectionPoint;
            position: Point;
        };
        b: {
            point: ConnectionPoint;
            position: Point;
        };
        d: number;
    } | undefined;
    for (const pa of getConnectionPoints(a))
        for (const pb of getConnectionPoints(b)) {
            const d = Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y);
            if (!best || d < best.d)
                best = { a: pa, b: pb, d };
        }
    return best!;
}
