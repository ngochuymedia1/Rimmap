import { findInteriorPathPointNear, insertWaypointAtNearestSegment, removeWaypointAtPathIndex } from '../src/arrows/waypoints';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
const inserted = insertWaypointAtNearestSegment([{ x: 100, y: 0 }], path, { x: 40, y: 5 });
assert(inserted.interiors.length === 2 && inserted.pathPointIndex === 1, 'Double-click insertion should target nearest segment');
assert(inserted.interiors[0].x === 40, 'Inserted waypoint should preserve requested geometry');
const removed = removeWaypointAtPathIndex(inserted.interiors, 1);
assert(removed.changed && removed.interiors.length === 1 && removed.interiors[0].x === 100, 'Alt-click removal should remove only the chosen interior waypoint');
assert(!removeWaypointAtPathIndex(removed.interiors, 0).changed, 'Endpoints must never be removed as waypoints');
assert(findInteriorPathPointNear(path, { x: 101, y: 1 }, 4) === 1, 'Existing interior waypoint should be detected for duplicate prevention');
console.log('OK: arbitrary connector waypoint insertion/removal and duplicate detection pass.');
