// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { appState, dispatch } from '../state/store';
import { MEDIA_INPUT_ACCEPT } from '../media/formats';

// --- 3. UI SETUP ---
export const appDiv = document.getElementById('app')!;

appDiv.innerHTML = `
  <div class="bottom-history" aria-label="History and canvas actions">
    <div class="history-controls">
      <button class="history-btn" id="btn-undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></svg>
      </button>
      <button class="history-btn" id="btn-redo" title="Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)" aria-label="Redo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></svg>
      </button>
      <button class="history-clear-btn" id="btn-clear" title="Clear all" aria-label="Clear all">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>
      </button>
      <button class="history-btn" id="btn-reset-view" title="Reset view (100%)" aria-label="Reset view (100%)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9a7 7 0 1 1 2 7.2"/><path d="M5 5v4h4"/><path d="M12 8v4l3 2"/></svg>
      </button>
      <button class="history-btn" id="btn-shortcuts" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M6.5 9h1M10 9h1M13.5 9h1M17 9h.5M6.5 12h1M10 12h1M13.5 12h1M17 12h.5M7 15h10"/></svg>
      </button>
    </div>
  </div>

  <div class="keyboard-shortcuts-panel" id="keyboard-shortcuts-panel" role="dialog" aria-label="Keyboard shortcuts" aria-hidden="true">
    <div class="shortcut-panel-header"><div><div class="shortcut-panel-title">Keyboard shortcuts</div><div class="shortcut-panel-subtitle">Click a shortcut, then press a new key combination.</div></div><button type="button" class="shortcut-close" aria-label="Close shortcuts">×</button></div>
    <div class="shortcut-list" id="shortcut-list"></div>
    <div class="shortcut-panel-footer"><span id="shortcut-panel-status" class="shortcut-panel-status"></span><div class="shortcut-panel-actions"><button type="button" id="shortcut-reset" class="shortcut-secondary">Reset defaults</button><button type="button" id="shortcut-save" class="shortcut-primary">Save shortcuts</button></div></div>
  </div>

  <div class="all-layers-panel" id="all-layers-panel" aria-label="All layers">
    <div class="all-layers-header">
      <div class="all-layers-title">All layers</div>
      <div class="panel-actions">
        <button class="all-layers-lock-toggle" id="btn-lock-selected" type="button" aria-label="Lock selected layers" title="Lock selected (Q)" disabled>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.25" y="8.75" width="9.5" height="7" rx="1.6"/><path d="M7.5 8.75V6.8a2.5 2.5 0 0 1 5 0v1.95"/></svg>
        </button>
        <button class="panel-drag-handle" id="layers-drag" type="button" aria-label="Move layers panel" title="Hold to move panel">
          <svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1.1"/><circle cx="9" cy="3" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="9" cy="8" r="1.1"/><circle cx="3" cy="13" r="1.1"/><circle cx="9" cy="13" r="1.1"/></svg>
        </button>
        <button class="all-layers-toggle" id="btn-all-layers-toggle" type="button" aria-expanded="true" aria-label="Collapse layers panel" title="Collapse layers panel">
          <span class="panel-toggle-chevron" aria-hidden="true">−</span>
          <span class="panel-collapsed-icon panel-icon-layers" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 8h12M6 12h9M6 16h12"/></svg></span>
        </button>
      </div>
    </div>
    <label class="all-layers-search" id="all-layers-search" hidden>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5"/><path d="m12 12 4 4"/></svg>
      <input id="all-layers-search-input" type="search" placeholder="Search layers" aria-label="Search layers by type or name" autocomplete="off" spellcheck="false">
    </label>
    <div class="all-layers-list" id="all-layers-list"></div>
  </div>

  <div class="bottom-toolbar" aria-label="Drawing tools">
    <button class="tool-btn active" id="tool-select" title="Select (V)" aria-label="Select (V)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5 17 14l-5.2.2 3.1 5.9-2.2 1.1-3-5.9L6 19z"/></svg>
    </button>
    <button class="tool-btn" id="tool-hand" title="Hand (H) · Hold Space" aria-label="Hand (H) · Hold Space">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 11V6.1a1.4 1.4 0 0 1 2.8 0V11"/><path d="M11 10V4.8a1.4 1.4 0 1 1 2.8 0V11"/><path d="M13.8 10V6.2a1.4 1.4 0 1 1 2.8 0v6.1"/><path d="M16.6 11V8.7a1.35 1.35 0 1 1 2.7 0v5.5c0 3.7-2.8 6.3-6.2 6.3h-.8c-2.4 0-3.8-1-5.1-2.6L4.5 15a1.4 1.4 0 0 1 2.2-1.7L8.2 15"/></svg>
    </button>
    <button class="tool-btn" id="tool-pencil" title="Brush (B)" aria-label="Brush (B)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 3.5-.8L19 7.7a2 2 0 0 0-2.8-2.8L4.7 16.4z"/><path d="m14.7 6.1 3.2 3.2"/><path d="M4 20l4.8-1.1"/></svg>
    </button>
    <button class="tool-btn" id="tool-rectangle" title="Rectangle (R)" aria-label="Rectangle (R)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1.5"/></svg>
    </button>
    <button class="tool-btn note-tool" id="tool-note" title="Note (N)" aria-label="Note (N)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14v11l-4.5 4H5z"/><path d="M14.5 19.5V15H19"/><path d="M8 9h8M8 12h6"/></svg>
    </button>
    <button class="tool-btn arrow-tool-btn" id="tool-arrow" title="Arrow (A)" aria-label="Arrow (A)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h13"/><path d="m13 7 5 5-5 5"/></svg>
    </button>
    <button class="tool-btn" id="tool-eraser" title="Eraser (E)" aria-label="Eraser (E)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.7 15.3 9.6-9.6a2.1 2.1 0 0 1 3 0l1.1 1.1a2.1 2.1 0 0 1 0 3l-8.5 8.5H6.6z"/><path d="M10.2 18.3H20"/></svg>
    </button>
    <button class="tool-btn" id="btn-media" title="Import image" aria-label="Import image">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="15.5" cy="9" r="1.5"/><path d="m7 16 3.2-4 2.7 3 1.9-2.1L18 16"/></svg>
    </button>

    <div class="project-menu-wrap" id="project-menu-wrap">
      <button type="button" class="tool-btn project-menu-trigger" id="project-menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-label="File menu" title="File">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h9l5 5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z"/><path d="M14 4.5V10h5"/><path d="M8 14h8M8 17h6"/></svg>
      </button>
    </div>
  </div>

  <div class="project-menu" id="project-menu" role="menu" aria-hidden="true">
    <div class="project-menu-meta">
      <div class="project-name-wrap">
        <span class="project-name" id="project-name">Untitled Board</span>
      </div>
      <div class="project-brand" aria-label="Rimmap">
        <img class="project-brand-logo" src="/rimmap-logo.png" alt="Rimmap">
      </div>
    </div>

    <div class="project-menu-actions" role="group" aria-label="Project actions">
      <button type="button" class="project-menu-item" id="project-new" role="menuitem" aria-keyshortcuts="Control+N">New <span class="project-menu-shortcut" data-shortcut-display="newProject">Ctrl+N</span></button>
      <button type="button" class="project-menu-item" id="project-open" role="menuitem" aria-keyshortcuts="Control+O Meta+O">Open <span class="project-menu-shortcut" data-shortcut-display="openProject">Ctrl+O</span></button>
      <button type="button" class="project-menu-item project-menu-save" id="project-save" role="menuitem" aria-keyshortcuts="Control+S Meta+S">Save <span class="project-menu-shortcut" data-shortcut-display="saveProject">Ctrl+S</span></button>
      <button type="button" class="project-menu-item" id="project-save-as" role="menuitem" aria-keyshortcuts="Control+Shift+S Meta+Shift+S">Save As <span class="project-menu-shortcut" data-shortcut-display="saveProjectAs">Ctrl+Shift+S</span></button>
      <button type="button" class="project-menu-item" id="project-exit" role="menuitem" hidden>Exit</button>
    </div>

    <div class="project-menu-separator"></div>
    <div class="project-menu-section-label">Export</div>
    <div class="project-export-grid" role="group" aria-label="Export format">
      <button type="button" class="project-export-btn" id="project-export-png">PNG</button>
      <button type="button" class="project-export-btn" id="project-export-svg">SVG</button>
      <button type="button" class="project-export-btn" id="project-export-pdf">PDF</button>
    </div>
    <div class="project-menu-quality" id="project-menu-quality">
      <div class="project-menu-quality-label">PNG scale</div>
      <div class="project-menu-quality-row" role="group" aria-label="PNG export scale">
        <button type="button" class="project-scale-btn" data-export-scale="2">2×</button>
        <button type="button" class="project-scale-btn selected" data-export-scale="4">4×</button>
        <button type="button" class="project-scale-btn" data-export-scale="6">6×</button>
      </div>
    </div>
  </div>

  <input id="project-input" type="file" hidden accept=".board.zip,.zip,.board,.board.json,.json,application/zip,application/json">

  <canvas id="canvas" aria-label="Drawing board"></canvas>

  <input id="media-input" type="file" multiple hidden accept="${MEDIA_INPUT_ACCEPT}">

  <div id="context-menu" class="context-menu" aria-hidden="true">
    <button class="context-item" data-action="duplicate">Duplicate <span class="shortcut" data-shortcut-display="duplicate">Ctrl+D</span></button>
    <button class="context-item" data-action="copy">Copy <span class="shortcut" data-shortcut-display="copy">Ctrl+C</span></button>
    <button class="context-item" data-action="cut">Cut <span class="shortcut" data-shortcut-display="cut">Ctrl+X</span></button>
    <button class="context-item" data-action="paste">Paste <span class="shortcut" data-shortcut-display="paste">Ctrl+V</span></button>
    <button class="context-item" data-action="delete">Delete <span class="shortcut" data-shortcut-display="deleteSelection">D</span></button>
    <div class="context-separator"></div>
    <button class="context-item" data-action="group">Group <span class="shortcut" data-shortcut-display="group">Ctrl+G</span></button>
    <button class="context-item" data-action="ungroup">Ungroup <span class="shortcut" data-shortcut-display="ungroup">Ctrl+Shift+G</span></button>
    <button class="context-item has-submenu">Arrange <span>›</span></button>
    <div class="context-submenu submenu-arrange">
      <button class="context-item" data-action="front">Bring to front <span class="shortcut" data-shortcut-display="bringFront">Alt+W</span></button>
      <button class="context-item" data-action="forward">Bring forward <span class="shortcut" data-shortcut-display="bringForward">W</span></button>
      <button class="context-item" data-action="backward">Send backward <span class="shortcut" data-shortcut-display="sendBackward">S</span></button>
      <button class="context-item" data-action="back">Send to back <span class="shortcut" data-shortcut-display="sendBack">Alt+S</span></button>
    </div>
    <button class="context-item has-submenu" id="context-align-trigger">Align <span>›</span></button>
    <div class="context-submenu submenu-align">
      <button class="context-item" data-action="align-left">Align left</button>
      <button class="context-item" data-action="align-center-h">Center horizontally</button>
      <button class="context-item" data-action="align-right">Align right</button>
      <div class="context-separator"></div>
      <button class="context-item" data-action="align-top">Align top</button>
      <button class="context-item" data-action="align-center-v">Center vertically</button>
      <button class="context-item" data-action="align-bottom">Align bottom</button>
      <div class="context-separator"></div>
      <button class="context-item distribution-context" data-action="distribute-h">Distribute horizontally</button>
      <button class="context-item distribution-context" data-action="distribute-v">Distribute vertically</button>
      <button class="context-item distribution-context" data-action="space-h">Equal horizontal spacing</button>
      <button class="context-item distribution-context" data-action="space-v">Equal vertical spacing</button>
    </div>
    <button class="context-item has-submenu arrow-mode-context" id="context-arrow-trigger" hidden>Arrow <span>›</span></button>
    <div class="context-submenu submenu-arrow-mode arrow-mode-context" hidden>
      <button class="context-item" data-action="arrow-mode-connection">Connection</button>
      <button class="context-item" data-action="arrow-mode-branches">Branches</button>
    </div>
    <button class="context-item has-submenu branch-context" id="context-branch-trigger" hidden>Branch <span>›</span></button>
    <div class="context-submenu submenu-branch branch-context" hidden>
      <button class="context-item branch-add-context" data-action="branch-add-1">Add 1 branch</button>
      <button class="context-item branch-add-context" data-action="branch-add-2">Add 2 branches</button>
      <button class="context-item branch-add-context" data-action="branch-add-3">Add 3 branches</button>
      <button class="context-item branch-add-context" data-action="branch-add-5">Add 5 branches</button>
      <button class="context-item branch-add-context" data-action="branch-add-x">Add X branches…</button>
      <div class="context-separator branch-remove-context" hidden></div>
      <button class="context-item branch-remove-context" data-action="branch-remove" hidden>Remove branch</button>
    </div>
    <div class="context-separator arrow-points-context" hidden></div>
    <button class="context-item arrow-points-context" data-action="arrow-points-3" hidden>3 Points</button>
    <button class="context-item arrow-points-context" data-action="arrow-points-5" hidden>5 Points</button>
    <button class="context-item" data-action="select-all">Select all <span class="shortcut" data-shortcut-display="selectAll">Ctrl+A</span></button>
    <div class="context-separator"></div>

    <button class="context-item has-submenu">Copy as <span>›</span></button>
    <div class="context-submenu context-submenu-export submenu-copy">
      <button class="context-item" data-action="copy-svg">SVG</button>
      <button class="context-item" data-action="copy-png">PNG</button>
      <label class="context-toggle">
        <span>Transparent</span>
        <input type="checkbox" id="copy-transparent" checked>
      </label>
    </div>

    <button class="context-item has-submenu">Export as <span>›</span></button>
    <div class="context-submenu context-submenu-export submenu-export">
      <button class="context-item" data-action="export-svg">SVG</button>
      <button class="context-item" data-action="export-png">PNG</button>
      <div class="context-export-quality">
        <span class="context-export-quality-label">PNG quality</span>
        <div class="context-export-quality-row" role="group" aria-label="PNG export scale">
          <button type="button" class="export-scale-btn" data-export-scale="2">2×</button>
          <button type="button" class="export-scale-btn selected" data-export-scale="4">4×</button>
          <button type="button" class="export-scale-btn" data-export-scale="6">6×</button>
        </div>
      </div>
      <label class="context-toggle">
        <span>Transparent</span>
        <input type="checkbox" id="export-transparent" checked>
      </label>
    </div>
  </div>
`;

export const canvas = document.getElementById('canvas') as HTMLCanvasElement;

export const ctx = canvas.getContext('2d')!;

export const contextMenu = document.getElementById('context-menu') as HTMLDivElement;

dispatch({ type: 'SET_UI', patch: { historyBar: document.querySelector('.bottom-history') as HTMLDivElement | null } });

dispatch({ type: 'SET_UI', patch: { mediaInput: document.getElementById('media-input') as HTMLInputElement } });

export const projectInput = document.getElementById('project-input') as HTMLInputElement;

export const projectNameEl = document.getElementById('project-name') as HTMLSpanElement;

export const projectMenuWrap = document.getElementById('project-menu-wrap') as HTMLDivElement;

export const projectMenuTrigger = document.getElementById('project-menu-trigger') as HTMLButtonElement;

export const projectMenu = document.getElementById('project-menu') as HTMLDivElement;
