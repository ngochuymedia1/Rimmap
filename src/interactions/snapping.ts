import { getBoundingBox } from '../model/geometry';
import type { Bounds } from '../model/types';
import { appState } from '../state/store';

const SNAP_SCREEN_THRESHOLD = 6;

export type SnapTargets = { x: number[]; y: number[] };

function thresholdWorld() {
  return SNAP_SCREEN_THRESHOLD / Math.max(0.1, appState.camera.zoom);
}

/**
 * Capture stationary snap geometry once at interaction start. Targets remain
 * global (not spatially clipped), preserving the existing far-axis semantics.
 */
export function createSnapTargets(excludedIds: ReadonlySet<string>): SnapTargets {
  const x: number[] = [];
  const y: number[] = [];
  for (const element of appState.elements) {
    if (element.hidden || excludedIds.has(element.id)) continue;
    const b = getBoundingBox(element);
    x.push(b.x, b.x + b.width / 2, b.x + b.width);
    y.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  x.sort((a, b) => a - b);
  y.sort((a, b) => a - b);
  return { x, y };
}

function lowerBound(values: number[], needle: number): number {
  let lo = 0, hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < needle) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nearestCorrection(source: number, targets: number[], threshold: number): number | null {
  if (!targets.length) return null;
  const index = lowerBound(targets, source);
  let best: number | null = null;
  for (const i of [index - 1, index]) {
    if (i < 0 || i >= targets.length) continue;
    const correction = targets[i] - source;
    if (Math.abs(correction) > threshold) continue;
    if (best === null || Math.abs(correction) < Math.abs(best)) best = correction;
  }
  return best;
}

function bestSnap(sourceValues: number[], targets: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const source of sourceValues) {
    const correction = nearestCorrection(source, targets, threshold);
    if (correction === null) continue;
    if (best === null || Math.abs(correction) < Math.abs(best)) best = correction;
  }
  return best;
}

function translateBounds(bounds: Bounds, dx: number, dy: number): Bounds {
  return { x: bounds.x + dx, y: bounds.y + dy, width: bounds.width, height: bounds.height };
}

/** Gently snaps a moving selection to nearby object edges/centers. */
export function snapMoveDelta(
  rawDelta: { x: number; y: number },
  initialBounds: Bounds,
  movingIds: ReadonlySet<string>,
  capturedTargets?: SnapTargets,
): { x: number; y: number } {
  const threshold = thresholdWorld();
  const rawBounds = translateBounds(initialBounds, rawDelta.x, rawDelta.y);
  const targets = capturedTargets ?? createSnapTargets(movingIds);
  const xCorrection = bestSnap(
    [rawBounds.x, rawBounds.x + rawBounds.width / 2, rawBounds.x + rawBounds.width],
    targets.x,
    threshold,
  );
  const yCorrection = bestSnap(
    [rawBounds.y, rawBounds.y + rawBounds.height / 2, rawBounds.y + rawBounds.height],
    targets.y,
    threshold,
  );
  return {
    x: rawDelta.x + (xCorrection ?? 0),
    y: rawDelta.y + (yCorrection ?? 0),
  };
}

function bestResizeSnap(source: Array<{ value: number; multiplier: number }>, targets: number[], threshold: number) {
  let best: number | null = null;
  for (const item of source) {
    const raw = nearestCorrection(item.value, targets, threshold / Math.max(1, Math.abs(item.multiplier)));
    if (raw === null) continue;
    const correction = raw * item.multiplier;
    if (best === null || Math.abs(correction) < Math.abs(best)) best = correction;
  }
  return best;
}

/** Snaps the actively-resized edge/center without drawing guides. */
export function snapResizeBounds(
  raw: Bounds,
  handle: string | null,
  selectedIds: ReadonlySet<string>,
  capturedTargets?: SnapTargets,
): Bounds {
  const threshold = thresholdWorld();
  const next = { ...raw };
  if (!handle) return next;
  const targets = capturedTargets ?? createSnapTargets(selectedIds);

  const movesWest = handle.includes('w');
  const movesEast = handle.includes('e');
  const movesNorth = handle.includes('n');
  const movesSouth = handle.includes('s');

  if (movesWest || movesEast) {
    const edge = movesWest ? next.x : next.x + next.width;
    const center = next.x + next.width / 2;
    const correction = bestResizeSnap(
      [{ value: edge, multiplier: 1 }, { value: center, multiplier: 2 }],
      targets.x,
      threshold,
    );
    if (correction !== null) {
      if (movesWest) {
        next.x += correction;
        next.width -= correction;
      } else next.width += correction;
    }
  }

  if (movesNorth || movesSouth) {
    const edge = movesNorth ? next.y : next.y + next.height;
    const center = next.y + next.height / 2;
    const correction = bestResizeSnap(
      [{ value: edge, multiplier: 1 }, { value: center, multiplier: 2 }],
      targets.y,
      threshold,
    );
    if (correction !== null) {
      if (movesNorth) {
        next.y += correction;
        next.height -= correction;
      } else next.height += correction;
    }
  }

  next.width = Math.max(5, next.width);
  next.height = Math.max(5, next.height);
  return next;
}
