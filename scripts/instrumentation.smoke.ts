import { getPerformanceInstrumentationStats, measurePerformance, resetPerformanceInstrumentation, setPerformanceInstrumentationEnabled } from '../src/performance/instrumentation';

resetPerformanceInstrumentation();
setPerformanceInstrumentationEnabled(false);
measurePerformance('drawScene', () => 42);
let stats = getPerformanceInstrumentationStats();
if (Object.keys(stats.metrics).length !== 0) throw new Error('disabled instrumentation should not record metrics');

setPerformanceInstrumentationEnabled(true);
for (let i = 0; i < 3; i++) measurePerformance('drawScene', () => i * i);
stats = getPerformanceInstrumentationStats();
if (stats.metrics.drawScene?.count !== 3) throw new Error('enabled instrumentation did not count calls');
if (stats.metrics.drawScene.maxMs < 0 || stats.metrics.drawScene.averageMs < 0) throw new Error('invalid duration metrics');

resetPerformanceInstrumentation();
stats = getPerformanceInstrumentationStats();
if (Object.keys(stats.metrics).length !== 0) throw new Error('reset did not clear metrics');
console.log('OK: performance instrumentation is opt-in, records timings, and resets deterministically.');
