export type PerformanceMetricName =
  | 'frame'
  | 'drawScene'
  | 'textLayoutMiss'
  | 'spatialQuery'
  | 'bindingUpdate';

type Metric = { count: number; totalMs: number; maxMs: number };

const metrics = new Map<PerformanceMetricName, Metric>();
let enabled = false;

function metric(name: PerformanceMetricName): Metric {
  let entry = metrics.get(name);
  if (!entry) {
    entry = { count: 0, totalMs: 0, maxMs: 0 };
    metrics.set(name, entry);
  }
  return entry;
}

export function setPerformanceInstrumentationEnabled(next: boolean): void {
  enabled = next;
}

export function isPerformanceInstrumentationEnabled(): boolean {
  return enabled;
}

export function recordPerformanceDuration(name: PerformanceMetricName, durationMs: number): void {
  if (!enabled) return;
  const entry = metric(name);
  entry.count += 1;
  entry.totalMs += durationMs;
  entry.maxMs = Math.max(entry.maxMs, durationMs);
}

export function measurePerformance<T>(name: PerformanceMetricName, fn: () => T): T {
  if (!enabled || typeof performance === 'undefined') return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    recordPerformanceDuration(name, performance.now() - start);
  }
}

export function resetPerformanceInstrumentation(): void {
  metrics.clear();
}

export function getPerformanceInstrumentationStats() {
  const out: Record<string, Metric & { averageMs: number }> = {};
  for (const [name, entry] of metrics) {
    out[name] = {
      ...entry,
      averageMs: entry.count ? entry.totalMs / entry.count : 0,
    };
  }
  return { enabled, metrics: out };
}
