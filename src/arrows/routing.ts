import type { Bounds, Point } from '../model/types';

export type RoutingObstacle = { id?: string; bounds: Bounds };

type Direction = 'h' | 'v' | 'none';
type SearchState = { xi: number; yi: number; dir: Direction; g: number; f: number; parent?: string };
const EPS = 1e-7;

function uniqueSorted(values: number[]): number[] {
    return [...new Set(values.map(value => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

function pointStrictlyInside(p: Point, b: Bounds): boolean {
    return p.x > b.x + EPS && p.x < b.x + b.width - EPS && p.y > b.y + EPS && p.y < b.y + b.height - EPS;
}

function segmentHitsRect(a: Point, b: Point, r: Bounds): boolean {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - r.x, r.x + r.width - a.x, a.y - r.y, r.y + r.height - a.y];
    for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < EPS) {
            if (q[i] < 0) return false;
            continue;
        }
        const ratio = q[i] / p[i];
        if (p[i] < 0) t0 = Math.max(t0, ratio);
        else t1 = Math.min(t1, ratio);
        if (t0 > t1) return false;
    }
    return true;
}

function orthogonalSegmentClear(a: Point, b: Point, obstacles: RoutingObstacle[]): boolean {
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS)
        return false;
    for (const { bounds: r } of obstacles) {
        if (Math.abs(a.y - b.y) <= EPS) {
            const y = a.y;
            if (y <= r.y + EPS || y >= r.y + r.height - EPS) continue;
            const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
            if (maxX > r.x + EPS && minX < r.x + r.width - EPS) return false;
        } else {
            const x = a.x;
            if (x <= r.x + EPS || x >= r.x + r.width - EPS) continue;
            const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
            if (maxY > r.y + EPS && minY < r.y + r.height - EPS) return false;
        }
    }
    return true;
}

function directSegmentClear(a: Point, b: Point, obstacles: RoutingObstacle[]): boolean {
    return !obstacles.some(({ bounds }) => segmentHitsRect(a, b, bounds));
}

function simplify(points: Point[]): Point[] {
    const deduped: Point[] = [];
    for (const point of points) {
        const previous = deduped[deduped.length - 1];
        if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > EPS)
            deduped.push({ ...point });
    }
    const out: Point[] = [];
    for (const point of deduped) {
        while (out.length >= 2) {
            const a = out[out.length - 2], b = out[out.length - 1];
            if ((Math.abs(a.x - b.x) <= EPS && Math.abs(b.x - point.x) <= EPS) || (Math.abs(a.y - b.y) <= EPS && Math.abs(b.y - point.y) <= EPS)) out.pop();
            else break;
        }
        out.push(point);
    }
    return out;
}

function compareSearchState(a: SearchState, b: SearchState): number {
    return a.f - b.f || a.g - b.g || a.yi - b.yi || a.xi - b.xi || a.dir.localeCompare(b.dir);
}

function heapPush(heap: SearchState[], value: SearchState) {
    heap.push(value);
    let index = heap.length - 1;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (compareSearchState(heap[parent], value) <= 0) break;
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = value;
}

function heapPop(heap: SearchState[]): SearchState | undefined {
    if (!heap.length) return undefined;
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
        let index = 0;
        while (true) {
            const left = index * 2 + 1, right = left + 1;
            if (left >= heap.length) break;
            let child = left;
            if (right < heap.length && compareSearchState(heap[right], heap[left]) < 0) child = right;
            if (compareSearchState(last, heap[child]) <= 0) break;
            heap[index] = heap[child];
            index = child;
        }
        heap[index] = last;
    }
    return first;
}

export function routeOrthogonal(start: Point, end: Point, obstacles: RoutingObstacle[], bendPenalty = 18): Point[] {
    if (directSegmentClear(start, end, obstacles)) return [{ ...start }, { ...end }];
    const allX = [start.x, end.x, ...obstacles.flatMap(o => [o.bounds.x, o.bounds.x + o.bounds.width])];
    const allY = [start.y, end.y, ...obstacles.flatMap(o => [o.bounds.y, o.bounds.y + o.bounds.height])];
    const outerPad = 40;
    const xs = uniqueSorted([...allX, Math.min(...allX) - outerPad, Math.max(...allX) + outerPad]);
    const ys = uniqueSorted([...allY, Math.min(...allY) - outerPad, Math.max(...allY) + outerPad]);
    const sx = xs.indexOf(Math.round(start.x * 1000) / 1000), sy = ys.indexOf(Math.round(start.y * 1000) / 1000);
    const ex = xs.indexOf(Math.round(end.x * 1000) / 1000), ey = ys.indexOf(Math.round(end.y * 1000) / 1000);
    const nodeValid = (xi: number, yi: number) => !obstacles.some(o => pointStrictlyInside({ x: xs[xi], y: ys[yi] }, o.bounds));
    const key = (xi: number, yi: number, dir: Direction) => `${xi},${yi},${dir}`;
    const heuristic = (xi: number, yi: number) => Math.abs(xs[xi] - end.x) + Math.abs(ys[yi] - end.y);
    const initial: SearchState = { xi: sx, yi: sy, dir: 'none', g: 0, f: heuristic(sx, sy) };
    const open: SearchState[] = [];
    heapPush(open, initial);
    const best = new Map<string, SearchState>([[key(sx, sy, 'none'), initial]]);
    const closed = new Set<string>();
    const pushNeighbor = (current: SearchState, xi: number, yi: number, dir: Direction) => {
        const distance = Math.abs(xs[xi] - xs[current.xi]) + Math.abs(ys[yi] - ys[current.yi]);
        const turn = current.dir !== 'none' && current.dir !== dir ? bendPenalty : 0;
        const g = current.g + distance + turn;
        const stateKey = key(xi, yi, dir);
        const prior = best.get(stateKey);
        if (prior && prior.g <= g + EPS) return;
        const next: SearchState = { xi, yi, dir, g, f: g + heuristic(xi, yi), parent: key(current.xi, current.yi, current.dir) };
        best.set(stateKey, next);
        heapPush(open, next);
    };
    let goal: SearchState | undefined;
    while (open.length) {
        const current = heapPop(open)!;
        const currentKey = key(current.xi, current.yi, current.dir);
        if (closed.has(currentKey)) continue;
        closed.add(currentKey);
        if (current.xi === ex && current.yi === ey) { goal = current; break; }
        const directions: Array<[number, number, Direction]> = [[1, 0, 'h'], [-1, 0, 'h'], [0, 1, 'v'], [0, -1, 'v']];
        for (const [dx, dy, dir] of directions) {
            let xi = current.xi + dx, yi = current.yi + dy;
            while (xi >= 0 && xi < xs.length && yi >= 0 && yi < ys.length) {
                const from = { x: xs[current.xi], y: ys[current.yi] }, candidate = { x: xs[xi], y: ys[yi] };
                if (!orthogonalSegmentClear(from, candidate, obstacles)) break;
                if (nodeValid(xi, yi)) { pushNeighbor(current, xi, yi, dir); break; }
                xi += dx;
                yi += dy;
            }
        }
    }
    if (!goal) return [{ ...start }, { ...end }];
    const reversed: Point[] = [];
    let cursor: SearchState | undefined = goal;
    while (cursor) {
        reversed.push({ x: xs[cursor.xi], y: ys[cursor.yi] });
        cursor = cursor.parent ? best.get(cursor.parent) : undefined;
    }
    return simplify(reversed.reverse());
}

export function pathIntersectsObstacleInteriors(points: Point[], obstacles: RoutingObstacle[]): boolean {
    for (let i = 0; i < points.length - 1; i++)
        if (!orthogonalSegmentClear(points[i], points[i + 1], obstacles)) return true;
    return false;
}
