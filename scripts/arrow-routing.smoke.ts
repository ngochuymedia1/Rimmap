import { pathIntersectsObstacleInteriors, routeOrthogonal, type RoutingObstacle } from '../src/arrows/routing';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const start = { x: 0, y: 50 }, end = { x: 300, y: 50 };
const obstacles: RoutingObstacle[] = [
  { id: 'card-a', bounds: { x: 80, y: 10, width: 70, height: 80 } },
  { id: 'card-b', bounds: { x: 190, y: 20, width: 60, height: 70 } },
];
const route = routeOrthogonal(start, end, obstacles);
assert(route.length >= 4, 'Blocked connector should gain orthogonal detour points');
assert(route[0].x === start.x && route[0].y === start.y, 'Route must preserve start');
assert(route.at(-1)?.x === end.x && route.at(-1)?.y === end.y, 'Route must preserve end');
assert(!pathIntersectsObstacleInteriors(route, obstacles), 'Route must avoid obstacle interiors');
assert(JSON.stringify(route) === JSON.stringify(routeOrthogonal(start, end, obstacles)), 'Routing must be deterministic');

const clear = routeOrthogonal(start, end, []);
assert(clear.length === 2, 'Unobstructed connector should stay direct');

const narrow: RoutingObstacle[] = [{ bounds: { x: 120, y: 40, width: 30, height: 20 } }];
const narrowRoute = routeOrthogonal(start, end, narrow);
assert(!pathIntersectsObstacleInteriors(narrowRoute, narrow), 'Narrow obstacle should still be avoided');

const largeBoard: RoutingObstacle[] = [];
for (let row = 0; row < 10; row++)
  for (let col = 0; col < 10; col++)
    largeBoard.push({ id: `card-${row}-${col}`, bounds: { x: 20 + col * 90, y: -100 + row * 70, width: 60, height: 45 } });
const largeRoute = routeOrthogonal({ x: -40, y: 250 }, { x: 930, y: 250 }, largeBoard);
assert(largeRoute.length >= 2, 'Large-board routing should return a path');
assert(!pathIntersectsObstacleInteriors(largeRoute, largeBoard), 'Large-board route must avoid every card');
assert(JSON.stringify(largeRoute) === JSON.stringify(routeOrthogonal({ x: -40, y: 250 }, { x: 930, y: 250 }, largeBoard)), 'Large-board routing must remain deterministic');

console.log(`OK: automatic orthogonal routing is deterministic and obstacle-aware (${largeBoard.length}-card regression included).`);
