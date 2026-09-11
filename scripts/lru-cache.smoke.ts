import { LruCache } from '../src/performance/lru-cache';

const cache = new LruCache<string, number>(2);
cache.set('a', 1);
cache.set('b', 2);
if (cache.get('a') !== 1) throw new Error('cache hit failed');
cache.set('c', 3);
if (cache.get('b') !== undefined) throw new Error('least-recently-used entry was not evicted');
if (cache.get('a') !== 1 || cache.get('c') !== 3) throw new Error('live cache entries were lost');
if (cache.size !== 2) throw new Error(`unexpected cache size ${cache.size}`);
if (cache.hits < 3 || cache.misses < 1) throw new Error('cache hit/miss accounting failed');
cache.clear();
const afterClear = { size: Number(cache.size), hits: Number(cache.hits), misses: Number(cache.misses) };
if (afterClear.size !== 0 || afterClear.hits !== 0 || afterClear.misses !== 0) throw new Error('cache clear failed');

console.log('OK: bounded LRU cache reuses hot derived data and evicts deterministically.');
