import { SpatialBucketIndex } from '../src/performance/spatial-index';

const index = new SpatialBucketIndex(200, 16, 100);
for (let y = 0; y < 20; y++) {
  for (let x = 0; x < 50; x++) {
    const id = `r-${x}-${y}`;
    index.upsert(id, { x: x * 240, y: y * 180, width: 100, height: 80 });
  }
}

const local = index.query({ x: 470, y: 350, width: 80, height: 80 });
if (!local.has('r-2-2')) throw new Error('local query missed the expected rectangle');
if (local.size > 6) throw new Error(`local query returned too many candidates: ${local.size}`);

index.upsert('huge', { x: -5000, y: -5000, width: 20000, height: 20000 });
if (!index.query({ x: 9000, y: 9000, width: 20, height: 20 }).has('huge')) throw new Error('overflow entry was missed');

index.upsert('moving', { x: 0, y: 0, width: 30, height: 30 });
if (!index.query({ x: 0, y: 0, width: 10, height: 10 }).has('moving')) throw new Error('inserted entry missing');
index.upsert('moving', { x: 4000, y: -4000, width: 30, height: 30 });
if (index.query({ x: 0, y: 0, width: 10, height: 10 }).has('moving')) throw new Error('updated entry remained in old bucket');
if (!index.query({ x: 4000, y: -4000, width: 10, height: 10 }).has('moving')) throw new Error('updated entry missing from new bucket');
index.remove('moving');
if (index.query({ x: 4000, y: -4000, width: 10, height: 10 }).has('moving')) throw new Error('removed entry still indexed');

console.log('OK: spatial buckets query locally, update incrementally, and safely handle huge overflow objects.');
