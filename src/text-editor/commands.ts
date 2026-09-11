/**
 * Browser-editing compatibility boundary.
 *
 * The canonical document model lives in model/text-document.ts. This module is
 * the only place where the legacy contenteditable command API may be used while
 * list/inline toolbar behavior is migrated to Selection/Range operations.
 */
export function legacyContentEditableCommand(command: string, value?: string): boolean {
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

export function setLegacyStyleWithCss(enabled: boolean): void {
  legacyContentEditableCommand('styleWithCSS', enabled ? 'true' : 'false');
}

export function insertPlainTextAtSelection(editor: HTMLElement, text: string): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
}


export function insertHtmlAtSelection(editor: HTMLElement, html: string, plainText = ''): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  let fragment: DocumentFragment;
  try {
    fragment = range.createContextualFragment(html);
  } catch {
    return insertPlainTextAtSelection(editor, plainText);
  }
  const last = fragment.lastChild;
  if (!last) return insertPlainTextAtSelection(editor, plainText);
  range.insertNode(fragment);
  const next = document.createRange();
  next.setStartAfter(last);
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null }));
  return true;
}

export function legacyQueryCommandState(command: string): boolean {
  try { return document.queryCommandState(command); } catch { return false; }
}
