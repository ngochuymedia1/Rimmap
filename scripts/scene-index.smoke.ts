import type { ArrowElement, Bounds, CanvasElement, RectangleElement } from '../src/model/types';
import { appState, dispatch } from '../src/state/store';
import { getConnectedArrowIdsForElementIds, getSceneElementById, getSceneGeometryGeneration, getSceneSpatialIndexStats, querySceneElements, resetSceneSpatialIndexForTests } from '../src/performance/scene-index';

function rect(id: string, x: number, y: number): RectangleElement {
  return { id, type: 'rectangle', x, y, width: 80, height: 60, color: '#111827', thickness: 1, borderRadius: 0, strokeEnabled: true, strokeStyle: 'solid', strokePatternSpacing: 1, strokeColor: '#111827', text: '', fontSize: 20, textScale: 1, textAlign: 'left', textVerticalAlign: 'top', fontFamily: 'Montserrat' };
}

function resolver(element: CanvasElement): Bounds {
  if (element.type === 'rectangle' || element.type === 'note' || element.type === 'media') return { x: element.x, y: element.y, width: element.width, height: element.height };
  if (element.type === 'text') return { x: element.x, y: element.y - 20, width: 100, height: 30 };
  if (element.type === 'freehand') return { x: element.points[0]?.x || 0, y: element.points[0]?.y || 0, width: 20, height: 20 };
  const target = element.startBinding ? appState.elements.find(item => item.id === element.startBinding) : undefined;
  const startX = target && 'x' in target ? target.x : element.start.x;
  const minX = Math.min(startX, element.end.x);
  return { x: minX, y: Math.min(element.start.y, element.end.y) - 5, width: Math.abs(element.end.x - startX) + 10, height: Math.abs(element.end.y - element.start.y) + 10 };
}

const elements: CanvasElement[] = [];
for (let i = 0; i < 220; i++) elements.push(rect(`rect-${i}`, (i % 22) * 180, Math.floor(i / 22) * 140));
const boundArrow: ArrowElement = { id: 'bound-arrow', type: 'arrow', start: { x: 0, y: 0 }, control: { x: 500, y: 0 }, controls: [{ x: 500, y: 0 }], end: { x: 1000, y: 0 }, arrowMode: 'connection', routingMode: 'manual', style: 'line', curveMode: 'sharp', color: '#111827', thickness: 2, opacity: 1, startBinding: 'rect-0' };
const autoArrow: ArrowElement = { ...boundArrow, id: 'auto-arrow', startBinding: undefined, routingMode: 'auto', start: { x: -10000, y: -10000 }, end: { x: -9000, y: -10000 }, control: { x: -9500, y: -10000 }, controls: [{ x: -9500, y: -10000 }] };
elements.push(boundArrow, autoArrow);

dispatch({ type: 'REPLACE_DOCUMENT', elements, layerGroups: [] });
resetSceneSpatialIndexForTests();
let hits = querySceneElements({ x: 0, y: 0, width: 90, height: 70 }, resolver);
let stats = getSceneSpatialIndexStats();
if (!stats.enabled || !stats.lastQueryUsedIndex) throw new Error('large-board spatial index did not activate');
if (hits.length >= 40) throw new Error(`large-board local query was not selective: ${hits.length}`);
if (!hits.some(item => item.id === 'rect-0')) throw new Error('local rectangle missing');
if (!hits.some(item => item.id === 'auto-arrow')) throw new Error('Auto arrow safe fallback missing');

if (getSceneElementById('rect-0')?.id !== 'rect-0') throw new Error('fast scene ID lookup failed');
const connectedBeforeMove = getConnectedArrowIdsForElementIds(['rect-0']);
if (!connectedBeforeMove.has('bound-arrow') || connectedBeforeMove.has('auto-arrow')) throw new Error('connector dependency lookup is incorrect');

const beforeGeneration = getSceneGeometryGeneration();
dispatch({ type: 'MOVE_ELEMENTS', ids: ['rect-0'], delta: { x: 2500, y: 0 } });
hits = querySceneElements({ x: 0, y: 0, width: 90, height: 70 }, resolver);
if (hits.some(item => item.id === 'rect-0')) throw new Error('moved rectangle remained at old indexed location');
const movedHits = querySceneElements({ x: 2490, y: 0, width: 120, height: 70 }, resolver);
if (!movedHits.some(item => item.id === 'rect-0')) throw new Error('moved rectangle missing from new indexed location');
if ((getSceneElementById('rect-0') as RectangleElement).x !== 2500) throw new Error('fast ID lookup returned stale element after move');
if (getSceneGeometryGeneration() <= beforeGeneration) throw new Error('geometry generation did not advance');

// The bound arrow resolver depends on rect-0. Moving rect-0 must therefore
// invalidate the arrow's index entry even though the arrow record itself did not change.
if (!movedHits.some(item => item.id === 'bound-arrow')) throw new Error('bound-arrow dependent index entry was not refreshed');

stats = getSceneSpatialIndexStats();
if (stats.volatileArrowCount !== 1) throw new Error(`expected one volatile Auto arrow, saw ${stats.volatileArrowCount}`);

console.log('OK: large-board scene index activates lazily, updates incrementally, tracks bound-arrow dependencies, and keeps Auto arrows safe.');
