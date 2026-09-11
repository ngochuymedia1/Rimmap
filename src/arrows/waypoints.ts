import type { Point } from '../model/types';

function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (!l2)
        return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function nearestPathSegmentIndex(path: Point[], p: Point): number {
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
        const distance = distanceToSegment(p, path[i], path[i + 1]);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
        }
    }
    return best;
}

export function insertWaypointAtNearestSegment(interiors: Point[], path: Point[], p: Point): { interiors: Point[]; pathPointIndex: number } {
    const segmentIndex = nearestPathSegmentIndex(path, p);
    const next = interiors.map(point => ({ ...point }));
    next.splice(segmentIndex, 0, { ...p });
    return { interiors: next, pathPointIndex: segmentIndex + 1 };
}

export function removeWaypointAtPathIndex(interiors: Point[], pathPointIndex: number): { interiors: Point[]; changed: boolean } {
    const interiorIndex = pathPointIndex - 1;
    if (interiorIndex < 0 || interiorIndex >= interiors.length)
        return { interiors: interiors.map(point => ({ ...point })), changed: false };
    const next = interiors.map(point => ({ ...point }));
    next.splice(interiorIndex, 1);
    return { interiors: next, changed: true };
}

export function findInteriorPathPointNear(path: Point[], p: Point, tolerance: number): number | null {
    for (let i = 1; i < path.length - 1; i++)
        if (Math.hypot(path[i].x - p.x, path[i].y - p.y) <= tolerance)
            return i;
    return null;
}
