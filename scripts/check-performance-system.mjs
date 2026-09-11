import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const sceneIndex = read('src/performance/scene-index.ts');
const spatialIndex = read('src/performance/spatial-index.ts');
const renderer = read('src/renderer/index.ts');
const geometry = read('src/model/geometry.ts');
const pointer = read('src/interactions/pointer.ts');
const layers = read('src/layers/index.ts');
const contextMenu = read('src/ui/context-menu.ts');
const keyboard = read('src/interactions/keyboard.ts');
const hooks = read('src/testing/hooks.ts');
const movement = read('src/interactions/movement.ts');
const snapping = read('src/interactions/snapping.ts');
const instrumentation = read('src/performance/instrumentation.ts');
const selectionCache = read('src/performance/selection-cache.ts');
const arrows = read('src/arrows/index.ts');
const tests = read('tests/canvas-features.spec.ts');
const checks = [
  [sceneIndex.includes('SCENE_SPATIAL_INDEX_THRESHOLD = 180') && sceneIndex.includes('SpatialBucketIndex'), 'large-board scene index has an explicit threshold and bucket implementation'],
  [spatialIndex.includes('maxCellsPerEntry') && spatialIndex.includes('overflow') && spatialIndex.includes('maxCellsPerQuery'), 'spatial buckets safely handle huge objects and huge queries'],
  [layers.includes('querySceneElements') && layers.includes('findElementsAtPoint'), 'point selection/overlap picking uses scene candidates'],
  [geometry.includes('selectionFromMarquee') && geometry.includes('querySceneElements(box, getSpatialIndexBounds)'), 'marquee selection uses scene candidates'],
  [keyboard.includes('return findElementsAtPoint(p)[0]'), 'eraser point targeting reuses spatial point hits'],
  [pointer.includes('eraserPreviewIds') && pointer.includes('querySceneElements(box, getSpatialIndexBounds)'), 'eraser marquee uses scene candidates'],
  [geometry.includes('const nearby = querySceneElements') && geometry.includes('includeVolatileAutoArrows: false') && geometry.includes('findConnectionAtPoint'), 'arrow magnetism uses a local spatial query without pulling every volatile Auto arrow into the cursor candidate set'],
  [renderer.includes('const candidates = querySceneElements(renderBounds, getSpatialIndexBounds)') && renderer.includes('querySceneElements(anchorView, getSpatialIndexBounds, { includeVolatileAutoArrows: false })'), 'normal rendering and arrow-tool anchors use viewport spatial queries'],
  [pointer.includes('for (const el of querySceneElements(view, getSpatialIndexBounds))'), 'move snapshot capture culls through the spatial index'],
  [contextMenu.includes('querySceneElements') && contextMenu.includes('findTextTarget'), 'text edit hit targeting uses scene candidates'],
  [renderer.includes('new LruCache<string, RichLayout>(1200)') && renderer.includes('richTextLayoutCacheKey'), 'rich-text measurement/layout uses a bounded content-addressed runtime cache'],
  [renderer.includes("document.fonts.addEventListener('loadingdone'") && renderer.includes('invalidateSceneSpatialIndexGeometry'), 'font loads invalidate cached metrics and dependent spatial bounds'],
  [geometry.includes('arrowPathCache') && geometry.includes('arrowRenderCache') && geometry.includes('branchRenderCache'), 'complex arrow path/render sampling has runtime caches'],
  [geometry.includes('labelCollisionBoundsCache') && geometry.includes('getAutoRouteObstaclesInBounds') && geometry.includes('autoRouteObstacleSignature') && geometry.includes('validationSignature'), 'arrow labels keep generation caching while Auto routing uses local obstacle signatures instead of global-board reroutes'],
  [sceneIndex.includes('volatileArrowIds') && sceneIndex.includes("routingMode === 'auto'") && sceneIndex.includes('includeVolatileAutoArrows !== false'), 'Auto-routed arrows use a safe volatile fallback while shape-only queries can exclude that fallback'],
  [renderer.includes('requestVisualFrame') && renderer.includes('visualFrameTasks') && !renderer.includes('redrawFramePending'), 'canvas redraw and interaction work share one module-local requestAnimationFrame scheduler'],
  [pointer.includes('queueHotPointerFrame') && pointer.includes("appState.mode === 'moving' || appState.mode === 'resizing' || appState.mode === 'panning'") && pointer.includes('pendingHotPointerFrame'), 'raw drag/pan pointermove events are coalesced before state work'],
  [snapping.includes('createSnapTargets') && snapping.includes('lowerBound') && pointer.includes('activeSnapTargets'), 'snap targets are captured once per interaction and queried with binary search'],
  [sceneIndex.includes('getConnectedArrowIdsForElementIds') && movement.includes('getConnectedArrowIdsForElementIds') && renderer.includes('getConnectedArrowIdsForElementIds'), 'binding dependency lookup updates and redraws only connected arrows'],
  [sceneIndex.includes('getSceneElementById') && geometry.includes('getSceneElementById') && pointer.includes('getSceneElementById'), 'hot geometry/interaction paths use fast ID lookup instead of repeated full-array find'],
  [renderer.includes('elementRichTextLayoutCache') && renderer.includes('lineWidths') && renderer.includes('runWidths'), 'immutable text elements reuse layout and measured paint widths without repeated measureText'],
  [geometry.includes('elementBoundsCache'), 'element envelopes are cached by immutable element identity'],
  [arrows.includes('arrowLabelLayoutCache') && arrows.includes('branchLabelLayoutCache') && arrows.includes('endpointLabelLayoutCache'), 'arrow label geometry is cached by immutable connector/branch identity and derived path inputs'],
  [instrumentation.includes('setPerformanceInstrumentationEnabled') && instrumentation.includes('measurePerformance') && hooks.includes('addStressBoard') && hooks.includes('enablePerformanceInstrumentation'), 'opt-in timing instrumentation and a repeatable stress board are available for profiling'],
  [selectionCache.includes('getSelectedIdSet') && pointer.includes('getSelectedIdSet'), 'selection membership has a memoized Set for hot interaction checks'],
  [hooks.includes('performanceStats') && hooks.includes('sceneCandidateIds') && tests.includes('large boards use spatial candidates and reuse text layout measurements'), 'browser regression hooks cover large-board candidate reduction and layout-cache reuse'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}
console.log('OK: spatial indexing and derived geometry/text caching are integrated across large-board interaction/render paths.');
