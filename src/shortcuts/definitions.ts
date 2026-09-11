// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { ShortcutDefinition } from '../model/types';

export const SHORTCUT_STORAGE_KEY = 'my-board-shortcuts-v1';

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
    { id: 'newProject', label: 'New project', group: 'File', defaultBinding: 'Ctrl+N' },
    { id: 'openProject', label: 'Open', group: 'File', defaultBinding: 'Ctrl+O' },
    { id: 'saveProject', label: 'Save', group: 'File', defaultBinding: 'Ctrl+S' },
    { id: 'saveProjectAs', label: 'Save As', group: 'File', defaultBinding: 'Ctrl+Shift+S' },
    { id: 'undo', label: 'Undo', group: 'Edit', defaultBinding: 'Ctrl+Z' },
    { id: 'redo', label: 'Redo', group: 'Edit', defaultBinding: 'Ctrl+Shift+Z' },
    { id: 'redoAlt', label: 'Redo (alternate)', group: 'Edit', defaultBinding: 'Ctrl+Y' },
    { id: 'selectAll', label: 'Select all', group: 'Edit', defaultBinding: 'Ctrl+A' },
    { id: 'group', label: 'Group', group: 'Edit', defaultBinding: 'Ctrl+G' },
    { id: 'ungroup', label: 'Ungroup', group: 'Edit', defaultBinding: 'Ctrl+Shift+G' },
    { id: 'duplicate', label: 'Duplicate', group: 'Edit', defaultBinding: 'Ctrl+D' },
    { id: 'copy', label: 'Copy', group: 'Edit', defaultBinding: 'Ctrl+C' },
    { id: 'cut', label: 'Cut', group: 'Edit', defaultBinding: 'Ctrl+X' },
    { id: 'paste', label: 'Paste', group: 'Edit', defaultBinding: 'Ctrl+V' },
    { id: 'selectTool', label: 'Select tool', group: 'Tools', defaultBinding: 'V' },
    { id: 'brushTool', label: 'Brush tool', group: 'Tools', defaultBinding: 'B' },
    { id: 'rectangleTool', label: 'Rectangle tool', group: 'Tools', defaultBinding: 'R' },
    { id: 'noteTool', label: 'Note tool', group: 'Tools', defaultBinding: 'N' },
    { id: 'arrowTool', label: 'Arrow tool', group: 'Tools', defaultBinding: 'A' },
    { id: 'quickConnect', label: 'Quick connect', group: 'Tools', defaultBinding: 'Shift+A' },
    { id: 'eraserTool', label: 'Eraser tool', group: 'Tools', defaultBinding: 'E' },
    { id: 'handTool', label: 'Hand tool', group: 'Tools', defaultBinding: 'H' },
    { id: 'toggleLock', label: 'Lock selection', group: 'Object', defaultBinding: 'Q' },
    { id: 'bringForward', label: 'Bring forward', group: 'Object', defaultBinding: 'W' },
    { id: 'sendBackward', label: 'Send backward', group: 'Object', defaultBinding: 'S' },
    { id: 'bringFront', label: 'Bring to front', group: 'Object', defaultBinding: 'Alt+W' },
    { id: 'sendBack', label: 'Send to back', group: 'Object', defaultBinding: 'Alt+S' },
    { id: 'deleteSelection', label: 'Delete selection', group: 'Object', defaultBinding: 'D' },
];

export const BROWSER_RESERVED_SHORTCUTS = new Set(['Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+T', 'Ctrl+Shift+T', 'Ctrl+W', 'Ctrl+L', 'Ctrl+Shift+S']);
