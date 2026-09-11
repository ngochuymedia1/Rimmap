// Alignment and distribution commands share one history transaction and move
// objects through the central store so bindings/history remain predictable.
import { getBoundingBox } from '../model/geometry';
import { saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { appState, dispatch } from '../state/store';
import { selectionContainsLocked } from '../ui/context-menu';

type AlignAction =
    | 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v'
    | 'distribute-h' | 'distribute-v' | 'space-h' | 'space-v';

function move(id: string, dx: number, dy: number) {
    if (!dx && !dy) return;
    const element = appState.elements.find(item => item.id === id);
    dispatch({
        type: 'MOVE_ELEMENTS',
        ids: [id],
        delta: { x: dx, y: dy },
        detachBindings: element?.type === 'arrow' || element?.type === 'connector',
    });
}

export function alignSelection(action: AlignAction) {
    // An exact Layer-group row represents one structural node. Until group-level
    // alignment semantics exist, never align its descendants against each other.
    if (appState.selectedLayerGroupId) return;
    const isDistribution = action.startsWith('distribute-') || action.startsWith('space-');
    const minimum = isDistribution ? 3 : 2;
    if (appState.selectedIds.length < minimum || selectionContainsLocked()) return;

    const before = beginHistoryTransaction();
    const items = appState.elements.filter(el => appState.selectedIds.includes(el.id));
    const boxes = items.map(el => ({ el, box: getBoundingBox(el) }));

    if (action === 'distribute-h') {
        const ordered = [...boxes].sort((a, b) => (a.box.x + a.box.width / 2) - (b.box.x + b.box.width / 2));
        const first = ordered[0], last = ordered[ordered.length - 1];
        const start = first.box.x + first.box.width / 2;
        const end = last.box.x + last.box.width / 2;
        const step = (end - start) / (ordered.length - 1);
        ordered.slice(1, -1).forEach((item, index) => move(item.el.id, start + step * (index + 1) - (item.box.x + item.box.width / 2), 0));
    } else if (action === 'distribute-v') {
        const ordered = [...boxes].sort((a, b) => (a.box.y + a.box.height / 2) - (b.box.y + b.box.height / 2));
        const first = ordered[0], last = ordered[ordered.length - 1];
        const start = first.box.y + first.box.height / 2;
        const end = last.box.y + last.box.height / 2;
        const step = (end - start) / (ordered.length - 1);
        ordered.slice(1, -1).forEach((item, index) => move(item.el.id, 0, start + step * (index + 1) - (item.box.y + item.box.height / 2)));
    } else if (action === 'space-h') {
        const ordered = [...boxes].sort((a, b) => a.box.x - b.box.x);
        const first = ordered[0], last = ordered[ordered.length - 1];
        const span = last.box.x + last.box.width - first.box.x;
        const widths = ordered.reduce((sum, item) => sum + item.box.width, 0);
        const gap = (span - widths) / (ordered.length - 1);
        let cursor = first.box.x + first.box.width + gap;
        for (const item of ordered.slice(1, -1)) {
            move(item.el.id, cursor - item.box.x, 0);
            cursor += item.box.width + gap;
        }
    } else if (action === 'space-v') {
        const ordered = [...boxes].sort((a, b) => a.box.y - b.box.y);
        const first = ordered[0], last = ordered[ordered.length - 1];
        const span = last.box.y + last.box.height - first.box.y;
        const heights = ordered.reduce((sum, item) => sum + item.box.height, 0);
        const gap = (span - heights) / (ordered.length - 1);
        let cursor = first.box.y + first.box.height + gap;
        for (const item of ordered.slice(1, -1)) {
            move(item.el.id, 0, cursor - item.box.y);
            cursor += item.box.height + gap;
        }
    } else {
        const left = Math.min(...boxes.map(item => item.box.x));
        const right = Math.max(...boxes.map(item => item.box.x + item.box.width));
        const top = Math.min(...boxes.map(item => item.box.y));
        const bottom = Math.max(...boxes.map(item => item.box.y + item.box.height));

        for (const { el, box } of boxes) {
            const dx = action === 'left' ? left - box.x
                : action === 'right' ? right - (box.x + box.width)
                : action === 'center-h' ? (left + right) / 2 - (box.x + box.width / 2)
                : 0;
            const dy = action === 'top' ? top - box.y
                : action === 'bottom' ? bottom - (box.y + box.height)
                : action === 'center-v' ? (top + bottom) / 2 - (box.y + box.height / 2)
                : 0;
            move(el.id, dx, dy);
        }
    }

    saveToLocal();
    commitHistory(before);
    redraw();
}
