import { getArrowBranches, getArrowInteriorPoints, getBranchInteriorPoints, setArrowInteriorPoints, setBranchInteriorPoints } from '../model/geometry';
import type { Point } from '../model/types';
import { getConnectedArrowIdsForElementIds } from '../performance/scene-index';
import { measurePerformance } from '../performance/instrumentation';
import { dispatch } from '../state/store';

export function commitBoundArrowsForMovedObjects(dx: number, dy: number, movedIds: Set<string>) {
  if (dx === 0 && dy === 0) return;
  const affectedArrowIds = getConnectedArrowIdsForElementIds(movedIds);
  if (!affectedArrowIds.size) return;

  measurePerformance('bindingUpdate', () => {
    dispatch({ type: 'UPDATE_ELEMENTS', ids: [...affectedArrowIds], update: element => {
      if (element.type !== 'arrow' && element.type !== 'connector' || movedIds.has(element.id)) return;
      const startMoved = !!element.startBinding && movedIds.has(element.startBinding);
      const endMoved = !!element.endBinding && movedIds.has(element.endBinding);
      const hasMovedBranch = getArrowBranches(element).some(branch => !!branch.endBinding && movedIds.has(branch.endBinding));
      if (!startMoved && !endMoved && !hasMovedBranch) return;

      if (startMoved) element.start = { x: element.start.x + dx, y: element.start.y + dy };
      if (endMoved) element.end = { x: element.end.x + dx, y: element.end.y + dy };
      if (startMoved || endMoved) {
        const controls = getArrowInteriorPoints(element);
        setArrowInteriorPoints(element, controls.map((point, index) => {
          const t = (index + 1) / (controls.length + 1);
          const factor = (startMoved ? (1 - t) : 0) + (endMoved ? t : 0);
          return { x: point.x + dx * factor, y: point.y + dy * factor };
        }));
      }
      for (const branch of getArrowBranches(element)) {
        const rootMoved = branch.root === 'start' ? startMoved : endMoved;
        const branchEndMoved = !!branch.endBinding && movedIds.has(branch.endBinding);
        if (branchEndMoved) branch.end = { x: branch.end.x + dx, y: branch.end.y + dy };
        if (!rootMoved && !branchEndMoved) continue;
        const root = branch.root === 'start' ? element.start : element.end;
        const controls = getBranchInteriorPoints(branch, root);
        setBranchInteriorPoints(branch, controls.map((point, index) => {
          const t = (index + 1) / (controls.length + 1);
          const factor = (rootMoved ? (1 - t) : 0) + (branchEndMoved ? t : 0);
          return { x: point.x + dx * factor, y: point.y + dy * factor };
        }));
      }
    } });
  });
}

export function moveElementsAndBindings(ids: string[], delta: Point) {
  if (!ids.length || (!delta.x && !delta.y)) return;
  const movedIds = new Set(ids);
  dispatch({ type: 'MOVE_ELEMENTS', ids, delta });
  commitBoundArrowsForMovedObjects(delta.x, delta.y, movedIds);
}
