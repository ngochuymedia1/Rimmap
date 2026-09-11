// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import '../ui/dom';
import { get, set } from 'idb-keyval';
import { ShortcutId } from '../model/types';
import { BROWSER_RESERVED_SHORTCUTS, SHORTCUT_DEFINITIONS, SHORTCUT_STORAGE_KEY } from './definitions';
import { appState, dispatch } from '../state/store';
import { updateSelectedLockButton } from '../ui/context-menu';
import { isDesktopApp } from '../desktop/index';

export function keyboardEventToBinding(e: KeyboardEvent): string | null { if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key))
    return null; const parts: string[] = []; if (e.ctrlKey || e.metaKey)
    parts.push('Ctrl'); if (e.altKey)
    parts.push('Alt'); if (e.shiftKey)
    parts.push('Shift'); let key = e.code === 'Space' ? 'Space' : e.key; if (key.length === 1)
    key = key.toUpperCase();
else if (key === 'Esc')
    key = 'Escape';
else
    key = key[0]?.toUpperCase() + key.slice(1); parts.push(key); return parts.join('+'); }

export function shortcutMatches(e: KeyboardEvent, id: ShortcutId) { return keyboardEventToBinding(e) === appState.shortcutBindings[id]; }

export function isBrowserReservedShortcut(binding: string) { return !isDesktopApp() && BROWSER_RESERVED_SHORTCUTS.has(binding); }

export function shortcutLabel(id: ShortcutId) { return appState.shortcutBindings[id] || SHORTCUT_DEFINITIONS.find(d => d.id === id)?.defaultBinding || ''; }

export async function loadShortcutPreferences() {
    const shortcutBindings = { ...appState.shortcutBindings };
    try {
        const stored = await get(SHORTCUT_STORAGE_KEY);
        if (stored && typeof stored === 'object') {
            for (const def of SHORTCUT_DEFINITIONS) {
                const v = (stored as any)[def.id];
                if (typeof v === 'string' && v.trim()) {
                    const binding = v.trim();
                    // Ctrl+Alt+N was the historical browser-safe default. Once Rimmap
                    // became a desktop app, migrate that untouched default to Ctrl+N.
                    shortcutBindings[def.id] = def.id === 'newProject' && binding === 'Ctrl+Alt+N'
                        ? def.defaultBinding
                        : binding;
                }
            }
        }
    } catch { }
    dispatch({ type: 'SET_SHORTCUTS', patch: { shortcutBindings, shortcutDraft: { ...shortcutBindings } } });
    refreshShortcutLabels();
}

export function shortcutConflicts(draft: Record<ShortcutId, string>) { const seen = new Map<string, string>(), out: string[] = []; for (const def of SHORTCUT_DEFINITIONS) {
    const b = draft[def.id], prior = seen.get(b);
    if (prior)
        out.push(`${prior} / ${def.label}: ${b}`);
    else
        seen.set(b, def.label);
} return out; }

export async function saveShortcutPreferences() { const status = document.getElementById('shortcut-panel-status'), conflicts = shortcutConflicts(appState.shortcutDraft); if (conflicts.length) {
    if (status)
        status.textContent = `Resolve duplicate shortcut: ${conflicts[0]}`;
    return;
}
const shortcutBindings = { ...appState.shortcutDraft };
dispatch({ type: 'SET_SHORTCUTS', patch: { shortcutBindings } });
try {
    await set(SHORTCUT_STORAGE_KEY, appState.shortcutBindings);
    if (status)
        status.textContent = 'Shortcuts saved';
}
catch {
    if (status)
        status.textContent = 'Could not save shortcuts';
} refreshShortcutLabels(); renderShortcutRows(); }

export function resetShortcutDraft() { const shortcutDraft = Object.fromEntries(SHORTCUT_DEFINITIONS.map(d => [d.id, d.defaultBinding])) as Record<ShortcutId, string>; dispatch({ type: 'SET_SHORTCUTS', patch: { shortcutDraft, capturingShortcutId: null } }); renderShortcutRows(); const status = document.getElementById('shortcut-panel-status'); if (status)
    status.textContent = 'Defaults restored — click Save'; }

export function refreshShortcutLabels() {
    document.querySelectorAll<HTMLElement>('[data-shortcut-display]').forEach(el => { const id = el.dataset.shortcutDisplay as ShortcutId | undefined; if (id)
        el.textContent = shortcutLabel(id); });
    const titles: [
        string,
        ShortcutId,
        string
    ][] = [['tool-select', 'selectTool', 'Select'], ['tool-pencil', 'brushTool', 'Brush'], ['tool-rectangle', 'rectangleTool', 'Rectangle'], ['tool-note', 'noteTool', 'Note'], ['tool-arrow', 'arrowTool', 'Arrow'], ['tool-eraser', 'eraserTool', 'Eraser'], ['tool-hand', 'handTool', 'Hand']];
    for (const [domId, id, label] of titles) {
        const btn = document.getElementById(domId);
        if (btn) {
            const suffix = id === 'handTool' ? ' · Hold Space' : '';
            btn.setAttribute('title', `${label} (${shortcutLabel(id)})${suffix}`);
            btn.setAttribute('aria-label', `${label} (${shortcutLabel(id)})${suffix}`);
        }
    }
    const undoBtn = document.getElementById('btn-undo'), redoBtn = document.getElementById('btn-redo');
    if (undoBtn) {
        undoBtn.setAttribute('title', `Undo (${shortcutLabel('undo')})`);
        undoBtn.setAttribute('aria-label', `Undo (${shortcutLabel('undo')})`);
    }
    if (redoBtn) {
        redoBtn.setAttribute('title', `Redo (${shortcutLabel('redo')} / ${shortcutLabel('redoAlt')})`);
        redoBtn.setAttribute('aria-label', `Redo (${shortcutLabel('redo')} / ${shortcutLabel('redoAlt')})`);
    }
    const ariaBinding = (binding: string) => binding.replace(/^Ctrl/, 'Control');
    for (const [domId, id] of [['project-new', 'newProject'], ['project-open', 'openProject'], ['project-save', 'saveProject'], ['project-save-as', 'saveProjectAs']] as [
        string,
        ShortcutId
    ][])
        document.getElementById(domId)?.setAttribute('aria-keyshortcuts', ariaBinding(shortcutLabel(id)));
    updateSelectedLockButton();
}

export function renderShortcutRows() { const host = document.getElementById('shortcut-list'); if (!host)
    return; const groups: ([
    'File' | 'Edit' | 'Tools' | 'Object',
    string
])[] = [['File', 'File'], ['Edit', 'Edit'], ['Tools', 'Tools'], ['Object', 'Object']]; host.innerHTML = groups.map(([group, title]) => `<section class="shortcut-section"><div class="shortcut-section-title">${title}</div>${SHORTCUT_DEFINITIONS.filter(d => d.group === group).map(def => `<div class="shortcut-row"><span class="shortcut-action">${def.label}</span><button type="button" class="shortcut-capture${appState.capturingShortcutId === def.id ? ' capturing' : ''}" data-shortcut-id="${def.id}">${appState.capturingShortcutId === def.id ? 'Press keys…' : appState.shortcutDraft[def.id]}</button></div>`).join('')}</section>`).join('') + `<section class="shortcut-section shortcut-fixed"><div class="shortcut-section-title">Editing & navigation</div><div class="shortcut-row"><span class="shortcut-action">Pan while held</span><span class="shortcut-fixed-key">Space</span></div><div class="shortcut-row"><span class="shortcut-action">Finish edit / adjustment + deselect</span><span class="shortcut-fixed-key">Esc</span></div><div class="shortcut-row"><span class="shortcut-action">Indent list item</span><span class="shortcut-fixed-key">Tab</span></div><div class="shortcut-row"><span class="shortcut-action">Outdent list item</span><span class="shortcut-fixed-key">Shift+Tab</span></div><div class="shortcut-row"><span class="shortcut-action">Duplicate while dragging</span><span class="shortcut-fixed-key">Alt+Drag</span></div><div class="shortcut-row"><span class="shortcut-action">Delete (alternate)</span><span class="shortcut-fixed-key">Delete / Backspace</span></div></section>`; host.querySelectorAll<HTMLButtonElement>('.shortcut-capture').forEach(btn => btn.addEventListener('click', () => { const capturingShortcutId = btn.dataset.shortcutId as ShortcutId; dispatch({ type: 'SET_SHORTCUTS', patch: { capturingShortcutId } }); renderShortcutRows(); (document.querySelector(`[data-shortcut-id="${capturingShortcutId}"]`) as HTMLButtonElement | null)?.focus(); })); }

export function isShortcutPanelOpen() { return document.getElementById('keyboard-shortcuts-panel')?.classList.contains('open') === true; }

export function setShortcutPanelOpen(open: boolean) {
    const panel = document.getElementById('keyboard-shortcuts-panel') as HTMLDivElement | null;
    const btn = document.getElementById('btn-shortcuts') as HTMLButtonElement | null;
    if (!panel || !btn)
        return;
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
    dispatch({ type: 'SET_SHORTCUTS', patch: { capturingShortcutId: null, shortcutDraft: { ...appState.shortcutBindings } } });
    if (open) {
        renderShortcutRows();
        const status = document.getElementById('shortcut-panel-status');
        if (status)
            status.textContent = '';
        requestAnimationFrame(() => panel.querySelector<HTMLButtonElement>('.shortcut-close')?.focus({ preventScroll: true }));
    }
}

export function toggleShortcutPanel() { setShortcutPanelOpen(!isShortcutPanelOpen()); }
