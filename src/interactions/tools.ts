// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { cancelEraserPreview } from './keyboard';
import { requestLayersPanelRefresh } from '../layers/index';
import { redraw } from '../renderer/index';
import { toggleShortcutPanel } from '../shortcuts/index';
import { redo, undo, updateHistoryButtons } from '../state/history';
import { appState, dispatch } from '../state/store';
import { closeTextEditor } from '../text-editor/index';
import { hideContextMenu, lockSelectedObjects } from '../ui/context-menu';
import { canvas } from '../ui/dom';
import { closeArrowPopover, resetView, updateTextStylePanel } from '../ui/inspector';

// --- 4. TOOL SELECTION ---
export function setTool(tool: typeof appState.activeTool, options: { refreshLayers?: boolean } = {}) {
    if (appState.textEditor)
        closeTextEditor(true);
    if (appState.activeTool === 'eraser' && tool !== 'eraser')
        cancelEraserPreview();
    dispatch({ type: 'SET_TOOL_STATE', patch: { activeTool: tool } });
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === `tool-${tool}`);
    });
    if (tool !== 'select')
        dispatch({ type: 'SET_SELECTION', ids: [] });
    if (tool !== 'eraser') {
        dispatch({ type: 'SET_INTERACTION', patch: { eraserTargetId: null, eraserPreviewIds: new Set() } });
    }
    canvas.className = tool === 'hand' || appState.isSpacePanning ? 'panning' : tool === 'eraser' ? 'eraser-preview' : '';
    hideContextMenu();
    if (tool !== 'arrow')
        closeArrowPopover();
    redraw();
    updateTextStylePanel();
    if (options.refreshLayers !== false)
        requestLayersPanelRefresh();
}

document.getElementById('tool-select')!.addEventListener('click', () => setTool('select'));

document.getElementById('tool-hand')!.addEventListener('click', () => setTool('hand'));

document.getElementById('tool-pencil')!.addEventListener('click', () => setTool('pencil'));

document.getElementById('tool-rectangle')!.addEventListener('click', () => setTool('rectangle'));

document.getElementById('tool-note')!.addEventListener('click', () => setTool('note'));

document.getElementById('tool-arrow')!.addEventListener('click', () => setTool('arrow'));

document.getElementById('tool-eraser')!.addEventListener('click', () => setTool('eraser'));

document.getElementById('btn-undo')!.addEventListener('click', undo);

document.getElementById('btn-redo')!.addEventListener('click', redo);

document.getElementById('btn-reset-view')!.addEventListener('click', resetView);

document.getElementById('btn-shortcuts')?.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleShortcutPanel(); });

document.getElementById('btn-lock-selected')?.addEventListener('click', e => { e.stopPropagation(); lockSelectedObjects(); });

updateHistoryButtons();
