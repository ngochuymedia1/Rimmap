// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { exportAsPdf, exportAsPng, exportAsSvg } from '../exports/index';
import { installDesktopFileDrop, isDesktopApp, requestDesktopClose } from '../desktop/index';
import { requestLayersPanelRefresh } from '../layers/index';
import { getScreenToWorld } from '../model/geometry';
import { CanvasElement } from '../model/types';
import { countUnsupportedMediaFiles, insertMediaFiles, isSupportedMediaPath, mediaFilesFromDesktopPaths, mediaFilesFromDrop, showMediaImportFailure, showUnsupportedMediaWarning } from '../media/import';
import { newProject, openProject, openProjectFile, saveProject, saveProjectAs, saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { isBrowserReservedShortcut, keyboardEventToBinding, renderShortcutRows, resetShortcutDraft, saveShortcutPreferences, setShortcutPanelOpen } from '../shortcuts/index';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { appState, dispatch } from '../state/store';
import { canvas, projectInput, projectMenu, projectMenuTrigger, projectMenuWrap } from './dom';
import { closeArrowPopover, showInspectorPopover, syncHistoryBarPosition, updateTextStylePanel } from './inspector';

document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (appState.arrowPopover && !appState.arrowPopover.contains(e.target as Node) && !target.closest('#tool-arrow'))
        closeArrowPopover();
});

export const shortcutPanel = document.getElementById('keyboard-shortcuts-panel') as HTMLDivElement | null;

shortcutPanel?.addEventListener('click', e => e.stopPropagation());

shortcutPanel?.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') {
    e.preventDefault();
    dispatch({ type: 'SET_SHORTCUTS', patch: { capturingShortcutId: null } });
    setShortcutPanelOpen(false);
    return;
} if (!appState.capturingShortcutId)
    return; const binding = keyboardEventToBinding(e); if (!binding)
    return; e.preventDefault(); const status = document.getElementById('shortcut-panel-status'); if (isBrowserReservedShortcut(binding)) {
    if (status)
        status.textContent = `${binding} is reserved by the browser`;
    return;
} const captureId = appState.capturingShortcutId; if (captureId) { const shortcutDraft = { ...appState.shortcutDraft, [captureId]: binding }; dispatch({ type: 'SET_SHORTCUTS', patch: { shortcutDraft, capturingShortcutId: null } }); } renderShortcutRows(); if (status)
    status.textContent = 'Unsaved changes'; });

shortcutPanel?.querySelector('.shortcut-close')?.addEventListener('click', () => setShortcutPanelOpen(false));

document.getElementById('shortcut-save')?.addEventListener('click', () => { void saveShortcutPreferences(); });

document.getElementById('shortcut-reset')?.addEventListener('click', resetShortcutDraft);

document.addEventListener('pointerdown', e => { const panel = document.getElementById('keyboard-shortcuts-panel') as HTMLDivElement | null; if (panel?.classList.contains('open') && !panel.contains(e.target as Node) && !(e.target as HTMLElement).closest('#btn-shortcuts'))
    setShortcutPanelOpen(false); }, true);

showInspectorPopover();

requestLayersPanelRefresh();

syncHistoryBarPosition();

updateTextStylePanel();

export function positionProjectMenu() {
    if (!projectMenuWrap || !projectMenuTrigger || !projectMenu)
        return;
    const anchor = projectMenuTrigger.getBoundingClientRect();
    const menuWidth = 200;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, anchor.left));
    projectMenu.style.left = `${Math.round(left)}px`;
    projectMenu.style.top = 'auto';
    const menuHeight = projectMenu.getBoundingClientRect().height || 260;
    const top = anchor.top - menuHeight - 8;
    projectMenu.style.top = `${Math.max(8, Math.round(top))}px`;
}

export function setProjectMenuOpen(open: boolean) {
    if (!projectMenuWrap || !projectMenuTrigger || !projectMenu)
        return;
    projectMenuWrap.classList.toggle('open', open);
    projectMenu.classList.toggle('visible', open);
    projectMenuTrigger.setAttribute('aria-expanded', String(open));
    projectMenu.setAttribute('aria-hidden', String(!open));
    if (open)
        requestAnimationFrame(positionProjectMenu);
}

export function toggleProjectMenu() { setProjectMenuOpen(!projectMenuWrap.classList.contains('open')); }

window.addEventListener('resize', () => { if (projectMenuWrap?.classList.contains('open'))
    positionProjectMenu(); });

projectMenuTrigger?.addEventListener('click', e => { e.stopPropagation(); toggleProjectMenu(); });

projectMenu?.addEventListener('click', e => e.stopPropagation());

projectMenu?.querySelectorAll<HTMLButtonElement>('.project-menu-item, .project-export-btn').forEach(btn => btn.addEventListener('click', () => setProjectMenuOpen(false)));

document.addEventListener('click', () => setProjectMenuOpen(false));

document.getElementById('project-new')?.addEventListener('click', () => { void newProject(); });

document.getElementById('project-open')?.addEventListener('click', () => { void openProject(); });

document.getElementById('project-save')?.addEventListener('click', () => { void saveProject(); });

document.getElementById('project-save-as')?.addEventListener('click', () => { void saveProjectAs(); });

const projectExit = document.getElementById('project-exit') as HTMLButtonElement | null;
if (projectExit && isDesktopApp()) {
    projectExit.hidden = false;
    projectExit.addEventListener('click', () => { void requestDesktopClose(); });
}

document.getElementById('project-export-png')?.addEventListener('click', () => { void exportAsPng(false); });

document.getElementById('project-export-svg')?.addEventListener('click', () => { void exportAsSvg(false); });

document.getElementById('project-export-pdf')?.addEventListener('click', () => { void exportAsPdf(false); });

projectMenu?.querySelectorAll<HTMLButtonElement>('[data-export-scale]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    dispatch({ type: 'SET_PROJECT', patch: { exportPngScale: Number(btn.dataset.exportScale) || 4 } });
    projectMenu?.querySelectorAll<HTMLButtonElement>('[data-export-scale]').forEach(b => b.classList.toggle('selected', Number(b.dataset.exportScale) === appState.exportPngScale));
}));

projectInput?.addEventListener('change', () => { const file = projectInput.files?.[0]; if (file)
    void openProjectFile(file); projectInput.value = ''; });

document.getElementById('btn-media')!.addEventListener('click', () => appState.mediaInput?.click());

appState.mediaInput?.addEventListener('change', async () => {
    if (!appState.mediaInput?.files?.length) return;
    const files = Array.from(appState.mediaInput.files);
    const unsupported = countUnsupportedMediaFiles(files);
    const anchor = getScreenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const inserted = await insertMediaFiles(files, anchor);
    if (!inserted) showMediaImportFailure('picker');
    if (unsupported) showUnsupportedMediaWarning(unsupported);
    appState.mediaInput.value = '';
});

function isNativeDropOverCanvas(clientX: number, clientY: number): boolean {
    return document.elementFromPoint(clientX, clientY) === canvas;
}

if (isDesktopApp()) {
    let nativeMediaDrag = false;
    void installDesktopFileDrop(async event => {
        if (event.type === 'leave') {
            nativeMediaDrag = false;
            canvas.classList.remove('media-drop-ready');
            return;
        }

        if (event.type === 'enter')
            nativeMediaDrag = event.paths.some(isSupportedMediaPath);

        if (event.type === 'over' || event.type === 'enter') {
            canvas.classList.toggle('media-drop-ready', nativeMediaDrag && isNativeDropOverCanvas(event.clientX, event.clientY));
            return;
        }

        canvas.classList.remove('media-drop-ready');
        const overCanvas = isNativeDropOverCanvas(event.clientX, event.clientY);
        const supportedCount = event.paths.filter(isSupportedMediaPath).length;
        const unsupportedCount = event.paths.length - supportedCount;
        nativeMediaDrag = false;
        if (!overCanvas) return;
        if (!supportedCount) {
            showMediaImportFailure('drop');
            return;
        }

        const files = await mediaFilesFromDesktopPaths(event.paths);
        if (!files.length) {
            showMediaImportFailure('drop');
            return;
        }
        const anchor = getScreenToWorld(event.clientX, event.clientY);
        const inserted = await insertMediaFiles(files, anchor);
        if (!inserted) showMediaImportFailure('drop');
        if (unsupportedCount) showUnsupportedMediaWarning(unsupportedCount);
    });
}

canvas.addEventListener('dragover', event => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const types = Array.from(transfer.types || []);
    const hasFiles = types.includes('Files');
    const hasBrowserImage = types.some(type => type === 'text/uri-list' || type === 'text/html');
    if (!hasFiles && !hasBrowserImage) return;
    event.preventDefault();
    transfer.dropEffect = 'copy';
    canvas.classList.add('media-drop-ready');
});

canvas.addEventListener('dragleave', event => {
    if (event.relatedTarget instanceof Node && canvas.contains(event.relatedTarget)) return;
    canvas.classList.remove('media-drop-ready');
});

canvas.addEventListener('drop', async event => {
    const transfer = event.dataTransfer;
    canvas.classList.remove('media-drop-ready');
    if (!transfer) return;
    event.preventDefault();
    const allFiles = Array.from(transfer.files || []);
    const unsupported = countUnsupportedMediaFiles(allFiles);
    const files = await mediaFilesFromDrop(transfer);
    if (!files.length) {
        showMediaImportFailure('drop');
        return;
    }
    const anchor = getScreenToWorld(event.clientX, event.clientY);
    const inserted = await insertMediaFiles(files, anchor);
    if (!inserted) showMediaImportFailure('drop');
    if (unsupported) showUnsupportedMediaWarning(unsupported);
});

window.addEventListener('dragend', () => canvas.classList.remove('media-drop-ready'));

document.getElementById('btn-clear')!.addEventListener('click', () => {
    if (!appState.elements.some(el => !el.locked))
        return;
    const before = beginHistoryTransaction();
    const remaining = appState.elements.filter(el => el.locked);
    dispatch({ type: 'REPLACE_ELEMENTS', elements: remaining });
    dispatch({ type: 'SET_SELECTION', ids: appState.selectedIds.filter(id => remaining.some(el => el.id === id)) });
    saveToLocal();
    commitHistory(before);
    redraw();
    requestLayersPanelRefresh();
});
