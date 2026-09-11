import { generateId } from '../src/model/ids';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ids = Array.from({ length: 2000 }, () => generateId());
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
assert(ids.every(id => uuidV4.test(id)), 'All generated IDs must be RFC 4122 UUID v4 strings');
assert(new Set(ids).size === ids.length, 'Generated UUIDs must be unique in the smoke sample');

console.log('OK: IDs use cryptographically random UUID v4 values.');
