import type { Bounds } from '../model/types';

export type SpatialIndexStats = {
  entries: number;
  buckets: number;
  overflowEntries: number;
};

type Entry = {
  bounds: Bounds;
  cells: string[] | null;
};

const intersects = (a: Bounds, b: Bounds) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

/**
 * Small, allocation-conscious uniform-grid spatial index for an unbounded board.
 * Extremely large objects are kept in an overflow set rather than being copied
 * into thousands of buckets. Query results are IDs only; scene z-order remains
 * owned by appState.elements.
 */
export class SpatialBucketIndex {
  private readonly buckets = new Map<string, Set<string>>();
  private readonly entries = new Map<string, Entry>();
  private readonly overflow = new Set<string>();

  constructor(
    readonly cellSize = 320,
    private readonly maxCellsPerEntry = 256,
    private readonly maxCellsPerQuery = 4096,
  ) {}

  clear(): void {
    this.buckets.clear();
    this.entries.clear();
    this.overflow.clear();
  }

  remove(id: string): void {
    const previous = this.entries.get(id);
    if (!previous) return;
    if (previous.cells) {
      for (const key of previous.cells) {
        const bucket = this.buckets.get(key);
        if (!bucket) continue;
        bucket.delete(id);
        if (!bucket.size) this.buckets.delete(key);
      }
    } else {
      this.overflow.delete(id);
    }
    this.entries.delete(id);
  }

  upsert(id: string, bounds: Bounds): void {
    this.remove(id);
    const normalized = normalizeBounds(bounds);
    const range = this.cellRange(normalized);
    const cellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    if (cellCount > this.maxCellsPerEntry) {
      this.entries.set(id, { bounds: normalized, cells: null });
      this.overflow.add(id);
      return;
    }
    const cells: string[] = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const key = cellKey(x, y);
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = new Set<string>();
          this.buckets.set(key, bucket);
        }
        bucket.add(id);
        cells.push(key);
      }
    }
    this.entries.set(id, { bounds: normalized, cells });
  }

  query(bounds: Bounds): Set<string> {
    const queryBounds = normalizeBounds(bounds);
    const range = this.cellRange(queryBounds);
    const cellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    const candidates = new Set<string>();

    // Huge marquees/zoomed-out viewports are cheaper as one exact entry scan
    // than as thousands of hash lookups.
    if (cellCount > this.maxCellsPerQuery) {
      for (const [id, entry] of this.entries) if (intersects(entry.bounds, queryBounds)) candidates.add(id);
      return candidates;
    }

    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const bucket = this.buckets.get(cellKey(x, y));
        if (!bucket) continue;
        for (const id of bucket) candidates.add(id);
      }
    }
    for (const id of this.overflow) candidates.add(id);

    for (const id of [...candidates]) {
      const entry = this.entries.get(id);
      if (!entry || !intersects(entry.bounds, queryBounds)) candidates.delete(id);
    }
    return candidates;
  }

  stats(): SpatialIndexStats {
    return { entries: this.entries.size, buckets: this.buckets.size, overflowEntries: this.overflow.size };
  }

  private cellRange(bounds: Bounds) {
    const epsilon = 1e-9;
    const minX = Math.floor(bounds.x / this.cellSize);
    const minY = Math.floor(bounds.y / this.cellSize);
    const maxX = Math.floor((bounds.x + Math.max(0, bounds.width) - epsilon) / this.cellSize);
    const maxY = Math.floor((bounds.y + Math.max(0, bounds.height) - epsilon) / this.cellSize);
    return { minX, minY, maxX: Math.max(minX, maxX), maxY: Math.max(minY, maxY) };
  }
}

function cellKey(x: number, y: number): string { return `${x}:${y}`; }

function normalizeBounds(bounds: Bounds): Bounds {
  const x2 = bounds.x + bounds.width;
  const y2 = bounds.y + bounds.height;
  return {
    x: Math.min(bounds.x, x2),
    y: Math.min(bounds.y, y2),
    width: Math.max(0, Math.abs(bounds.width)),
    height: Math.max(0, Math.abs(bounds.height)),
  };
}
