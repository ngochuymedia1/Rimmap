// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { ARROW_LABEL_FONT_SIZE, ARROW_LABEL_GAP, ARROW_LABEL_MAX_WIDTH, ARROW_LABEL_PAD_X, ARROW_LABEL_PAD_Y, ARROW_LABEL_TEXT_COLOR, arrowLabelSide, arrowPathLocationAtPoints, clampArrowLabelPosition, getArrowLabelLayout, getBranchLabelLayout, getEndpointLabelData, getEndpointLabelLayout, getEndpointLabelLayoutFromLines, getPathLabelLayoutFromLines, normalizeArrowLabelFontSize, unitTangent } from '../arrows/index';
import { setTool } from '../interactions/tools';
import { nextAutoLayerName, requestLayersPanelRefresh } from '../layers/index';
import { getArrowBranchRenderPoints, getArrowBranches, getArrowLabelCollisionBounds, getArrowRenderPoints, getBoundingBox, getWorldToScreen } from '../model/geometry';
import { generateId } from '../model/ids';
import { CHECK_CONTENT_INDENT, LIST_BULLET_SCALE, LIST_CONTENT_INDENT, LIST_MARKER_GAP, LIST_NUMBER_SCALE, RICH_TEXT_LINE_HEIGHT, clipboardTextHasListMarkers, cloneRichLines, cloneTextDocument, richLineContentIndent, richLineListMarker, scaleRichLines, textDocumentClipboardText, textDocumentFromClipboardText, textDocumentFromHtml, textDocumentFromLines, textDocumentFromPlainText, textDocumentPlainText, textDocumentToHtml, normalizeTextDocument } from '../model/text-document';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE, TEXT_BBOX_PAD, TEXT_COLOR_PALETTE, TEXT_PAD_X, TEXT_PAD_Y, fontStack, getEditorScreenScale, getTextScale, normalizeFontFamily } from '../model/text';
import { ArrowElement, ArrowLabelLayout, ArrowTextTarget, Point, RichLine, TextAlign, TextDocument } from '../model/types';
import { saveToLocal } from '../persistence/index';
import { measureRichTextLayout, redraw } from '../renderer/index';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { appState, dispatch } from '../state/store';
import { appDiv } from '../ui/dom';
import { updateTextStylePanel } from '../ui/inspector';
import { insertHtmlAtSelection, insertPlainTextAtSelection, legacyContentEditableCommand, legacyQueryCommandState, setLegacyStyleWithCss } from './commands';

export { CHECK_CONTENT_INDENT, LIST_BULLET_SCALE, LIST_CONTENT_INDENT, LIST_MARKER_GAP, LIST_NUMBER_SCALE, RICH_TEXT_LINE_HEIGHT, cloneRichLines, richLineContentIndent, richLineListMarker, scaleRichLines };

export function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;'); }

export function plainTextFromRichHtml(html: string) {
    const lines = textDocumentFromHtml(html, '#1e1e1e').lines;
    return lines.map(line => line.runs.map(run => run.text).join('')).join('\n').replace(/\u00a0/g, ' ');
}

// Read the editor's visible text directly from the live DOM when committing.
// The HTML -> rich-line parser is presentation-oriented and can legally merge
// or split visual lines; it must never be the single source used to decide what
// plain text is persisted.  innerText follows the browser's actual block layout
// and therefore preserves every line the user can see.
export function plainTextFromLiveEditor(editor: HTMLElement | null): string {
    if (!editor)
        return '';
    // Use the same DOM -> RichLine parser that committed canvas rendering uses.
    // innerText is intentionally avoided here because browsers insert extra
    // newlines around DIV/LI boundaries, which was the source of the edit-mode
    // vs committed-mode "one Enter becomes two lines" bug.
    const html = sanitizeRichText(editor.innerHTML || '');
    const lines = textDocumentFromHtml(html, '#1e1e1e').lines;
    return lines.map(line => line.runs.map(run => run.text).join('')).join('\n').replace(/\u00a0/g, ' ');
}

export function normalizeSavedRichLines(lines: RichLine[], plainText: string, baseColor: string): RichLine[] {
    const expected = plainText ? plainText.split('\n').length : 0;
    if (expected === 0)
        return [];
    const parsedText = lines.map(line => line.runs.map(run => run.text).join('')).join('\n').replace(/\u00a0/g, ' ');
    const normalize = (v: string) => v.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
    // IMPORTANT: list metadata is structural information. Never replace parsed
    // list lines with plain <div> lines merely because the browser represented a
    // block break slightly differently. Doing that removes listType/listIndex and
    // makes bullets/numbers disappear the moment the editor closes.
    const hasStructuredFormatting = lines.some(line => !!line.listType);
    if (hasStructuredFormatting)
        return cloneRichLines(lines);
    // For ordinary non-list text, keep the old defensive fallback so a browser
    // specific DOM shape cannot lose visible lines on commit.
    if (lines.length !== expected || normalize(parsedText) !== normalize(plainText)) {
        return cloneRichLines(textDocumentFromPlainText(plainText, baseColor).lines);
    }
    return cloneRichLines(lines);
}

export function textToRichHtml(value: string) {
    return value.split(/\n/).map(line => `<div>${escapeHtml(line) || '<br>'}</div>`).join('');
}

function significantClipboardNodes(root: HTMLElement): Node[] {
    return Array.from(root.childNodes).filter(node => node.nodeType !== Node.TEXT_NODE || !!(node.textContent || '').trim());
}

type EditorClipboardPayload = {
    plain: string;
    html: string;
    visiblePlain: string;
    doc: TextDocument;
    hasList: boolean;
    copiedAt: number;
};

// Same-app rich-text fallback. Native copy/paste remains the primary path, but
// some desktop/webview environments expose only text/plain (or occasionally no
// clipboard payload at all) after a contenteditable copy. Keep the canonical
// selection projection in memory so a list copied inside My Board can always be
// pasted back into Text, Note, or Rectangle without depending on OS HTML support.
let internalEditorClipboard: EditorClipboardPayload | null = null;
let editorPasteSequence = 0;

function isEmptyClipboardLine(line: RichLine): boolean {
    return !line.listType && line.runs.every(run => !run.text.replace(/\u00a0/g, ' ').trim());
}

/**
 * Clipboard text/plain is the most reliable description of the *selected range*.
 * Browser HTML fragments can contain empty boundary blocks/BR placeholders that
 * were not actually selected. Keep intentional empty lines in the middle, but
 * trim only phantom leading/trailing lines that are absent from text/plain.
 */
function trimClipboardDocumentBoundaries(doc: TextDocument, exactPlain: string): TextDocument {
    const normalizedPlain = String(exactPlain || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    const lines = cloneRichLines(doc.lines);
    const startsWithBreak = normalizedPlain.startsWith('\n');
    const endsWithBreak = normalizedPlain.endsWith('\n');
    const targetLineCount = normalizedPlain === '' ? 1 : normalizedPlain.split('\n').length;

    if (!startsWithBreak) {
        while (lines.length > 1 && isEmptyClipboardLine(lines[0])) lines.shift();
    }
    if (!endsWithBreak) {
        while (lines.length > 1 && isEmptyClipboardLine(lines[lines.length - 1])) lines.pop();
    }
    // If browser wrapper repair produced more lines than the exact selection,
    // remove only empty boundary artifacts until the counts agree.
    while (lines.length > targetLineCount && lines.length > 1) {
        if (!startsWithBreak && isEmptyClipboardLine(lines[0])) { lines.shift(); continue; }
        if (!endsWithBreak && isEmptyClipboardLine(lines[lines.length - 1])) { lines.pop(); continue; }
        break;
    }
    return textDocumentFromLines(lines.length ? lines : [{ runs: [{ text: '', color: '#111827' }] }]);
}

function buildEditorClipboardPayload(editor: HTMLDivElement, range: Range): EditorClipboardPayload | null {
    if (!editor.contains(range.commonAncestorContainer)) return null;
    const selection = window.getSelection();
    const exactPlain = (selection?.toString() || range.toString() || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    const fragment = range.cloneContents();
    const holder = document.createElement('div');
    holder.appendChild(fragment);
    let safeHtml = sanitizeRichText(holder.innerHTML);
    safeHtml = restoreSelectionListContext(safeHtml, range);

    // Always create a canonical selection document. This is the same-app source
    // of truth; HTML is only the interoperable clipboard representation.
    let doc = textDocumentFromHtml(safeHtml, editor.style.color || '#111827');
    doc = trimClipboardDocumentBoundaries(doc, exactPlain);
    const hasList = doc.lines.some(line => line.listType === 'bullet' || line.listType === 'number' || line.listType === 'check');
    const visiblePlain = exactPlain;
    const plain = hasList ? textDocumentClipboardText(doc) : exactPlain;
    return {
        plain,
        html: textDocumentToHtml(doc),
        visiblePlain,
        doc: cloneTextDocument(doc)!,
        hasList,
        copiedAt: Date.now(),
    };
}
function rememberEditorSelectionForClipboard(editor: HTMLDivElement): EditorClipboardPayload | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const payload = buildEditorClipboardPayload(editor, selection.getRangeAt(0));
    if (payload) internalEditorClipboard = payload;
    return payload;
}

function sameClipboardText(a: string, b: string): boolean {
    const normalize = (value: string) => String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+$/gm, '')
        .trim();
    return normalize(a) === normalize(b);
}

function clipboardTextWithoutListMarkers(value: string): string {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line
            .replace(/^\s*(?:[•●◦▪*+-]|(?:\d+\.)+)\s+/, '')
            .trimEnd())
        .join('\n')
        .trim();
}

function resolvePasteClipboardPayload(rawText: string, rawHtml: string, customDoc?: TextDocument): { text: string; html: string; doc?: TextDocument } {
    let text = String(rawText || '');
    let html = String(rawHtml || '');
    if (customDoc) return { text, html, doc: cloneTextDocument(customDoc) };
    const fallback = internalEditorClipboard;
    if (!fallback) return { text, html };

    const fallbackIsFresh = Date.now() - fallback.copiedAt < 30 * 60 * 1000;
    if (!fallbackIsFresh) return { text, html };

    // For same-app copies, prefer the canonical selection document over native
    // contenteditable HTML. Chrome/WebView can omit list ancestors, add wrapper
    // blocks, or expose only markerless text/plain depending on the host OS.
    const textMatchesInternal = !text
        || sameClipboardText(text, fallback.plain)
        || sameClipboardText(text, fallback.visiblePlain)
        || sameClipboardText(
            clipboardTextWithoutListMarkers(text),
            clipboardTextWithoutListMarkers(fallback.visiblePlain),
        );
    if (textMatchesInternal || (!text && !html)) {
        return { text: fallback.plain, html: fallback.html, doc: cloneTextDocument(fallback.doc) };
    }
    return { text, html };
}
/**
 * Range.cloneContents() omits the common ancestor itself. When a user drags
 * across several LI nodes, Chromium therefore gives us sibling <li> fragments
 * with no surrounding <ol>/<ul>. Restore that editing context before parsing
 * the fragment into the canonical TextDocument.
 */
function restoreSelectionListContext(html: string, range: Range): string {
    if (!html) return html;
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const nodes = significantClipboardNodes(holder);
    if (!nodes.length) return html;

    // cloneContents() never includes its common ancestor. For list selections
    // that means Chromium may return sibling LI nodes with no OL/UL, or the own
    // content of a parent LI plus a nested list with the parent LI missing. Wrap
    // exactly the omitted structural ancestor(s) needed to make the fragment a
    // valid list again; do not add unrelated editor blocks above/below it.
    let common = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer as HTMLElement
        : range.commonAncestorContainer.parentElement;
    while (common && appState.textEditorContent && common !== appState.textEditorContent && !['LI', 'UL', 'OL'].includes(common.tagName)) common = common.parentElement;
    if (!common || common === appState.textEditorContent || !['LI', 'UL', 'OL'].includes(common.tagName)) return html;

    let wrapped: HTMLElement;
    if (common.tagName === 'UL' || common.tagName === 'OL') {
        wrapped = document.createElement(common.tagName.toLowerCase());
        while (holder.firstChild) wrapped.appendChild(holder.firstChild);
    } else {
        const li = document.createElement('li');
        while (holder.firstChild) li.appendChild(holder.firstChild);
        const parentList = common.parentElement;
        if (!parentList || !['UL', 'OL'].includes(parentList.tagName)) return html;
        wrapped = document.createElement(parentList.tagName.toLowerCase());
        wrapped.appendChild(li);
    }
    holder.replaceChildren(wrapped);
    return sanitizeRichText(holder.innerHTML);
}
function repairOrphanClipboardListHtml(html: string, plainText: string): string {
    if (!html) return html;
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const nodes = significantClipboardNodes(holder);
    if (!nodes.length || !nodes.every(node => node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'LI')) return html;
    const firstListLine = String(plainText || '').split(/\r?\n/).find(line => /^(?:\s*(?:[•●◦▪*-]|(?:\d+\.)+)\s+)/.test(line));
    const tag = firstListLine && /^\s*(?:\d+\.)+\s+/.test(firstListLine) ? 'ol' : 'ul';
    const list = document.createElement(tag);
    while (holder.firstChild) list.appendChild(holder.firstChild);
    holder.appendChild(list);
    return sanitizeRichText(holder.innerHTML);
}

export function sanitizeRichText(html: string) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const allowed = new Set(['DIV', 'P', 'BR', 'UL', 'OL', 'LI', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'STRIKE', 'FONT', 'MARK']);

    const cleanElement = (node: HTMLElement) => {
        if (!allowed.has(node.tagName)) {
            // Clipboard HTML from browsers/office apps is often wrapped in
            // HTML/BODY/SECTION/etc. Unwrap recursively *and continue cleaning
            // the moved children*. The old sanitizer stopped after one unwrap,
            // which could leave BODY around an OL/UL and flatten the list later.
            const parent = node.parentNode;
            const moved = Array.from(node.childNodes);
            for (const child of moved) parent?.insertBefore(child, node);
            parent?.removeChild(node);
            for (const child of moved) if (child.nodeType === Node.ELEMENT_NODE) cleanElement(child as HTMLElement);
            return;
        }
        for (const attribute of Array.from(node.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name !== 'style' && name !== 'data-checklist' && name !== 'data-checked') node.removeAttribute(attribute.name);
        }
        const style = node.getAttribute('style');
        if (style) {
            const keep: string[] = [];
            style.split(';').forEach(rule => {
                const [rawKey, ...rest] = rule.split(':');
                const key = rawKey?.trim().toLowerCase();
                const value = rest.join(':').trim();
                if (!value) return;
                const isClipboardSurfaceWhite = key === 'background-color' && /^(?:white|#fff(?:fff)?|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*1(?:\.0+)?\s*\))$/i.test(value);
                if (['font-weight', 'font-style', 'text-decoration', 'color', 'background-color', 'text-align'].includes(key) && !/[<>]/.test(value) && !isClipboardSurfaceWhite) keep.push(`${key}:${value}`);
            });
            if (keep.length) node.setAttribute('style', keep.join(';'));
            else node.removeAttribute('style');
        }
        node.removeAttribute('class');
        node.removeAttribute('id');
        for (const child of Array.from(node.children)) cleanElement(child as HTMLElement);
    };

    for (const child of Array.from(box.children)) cleanElement(child as HTMLElement);
    return box.innerHTML;
}
export function normalizeEditorFontTags() {
    if (!appState.textEditorContent)
        return;
    appState.textEditorContent.querySelectorAll('font').forEach(font => {
        const span = document.createElement('span');
        if (font.getAttribute('color'))
            span.style.color = font.getAttribute('color')!;
        span.innerHTML = font.innerHTML;
        font.replaceWith(span);
    });
    appState.textEditorContent.querySelectorAll<HTMLElement>('[style*="font-size"]').forEach(node => node.style.removeProperty('font-size'));
}

export function saveEditorSelection() {
    if (!appState.textEditorContent)
        return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return;
    const range = sel.getRangeAt(0);
    if (appState.textEditorContent.contains(range.commonAncestorContainer))
        dispatch({ type: 'SET_EDITOR', patch: { savedEditorRange: range.cloneRange() } });
}

export function restoreEditorSelection() {
    if (!appState.textEditorContent || !appState.savedEditorRange)
        return false;
    if (!appState.textEditorContent.contains(appState.savedEditorRange.commonAncestorContainer))
        return false;
    const sel = window.getSelection();
    if (!sel)
        return false;
    sel.removeAllRanges();
    sel.addRange(appState.savedEditorRange);
    return true;
}

export function clearEditorSelection() { dispatch({ type: 'SET_EDITOR', patch: { savedEditorRange: null } }); }

export function richEditorText() {
    normalizeEditorFontTags();
    return plainTextFromRichHtml(appState.textEditorContent?.innerHTML || '');
}

export function insertSoftBreak() {
    if (!appState.textEditorContent)
        return;
    appState.textEditorContent.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !appState.textEditorContent.contains(sel.anchorNode))
        return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    normalizeEditorFontTags();
    redraw();
}

export function execEditorCommand(command: string, value?: string) {
    if (!appState.textEditorContent)
        return;
    // Toolbar clicks can move focus away from contenteditable and collapse the
    // browser selection. Restore the last selection before applying formatting.
    restoreEditorSelection();
    appState.textEditorContent.focus();
    restoreEditorSelection();
    setLegacyStyleWithCss(true);
    legacyContentEditableCommand(command, value);
    saveEditorSelection();
    normalizeEditorFontTags();
    normalizeDecorationTags();
    updateRichToolbar();
    redraw();
}

export function restoreRange(range: Range) {
    const sel = window.getSelection();
    if (!sel)
        return;
    sel.removeAllRanges();
    sel.addRange(range);
}

export function normalizeDecorationTags() {
    if (!appState.textEditorContent)
        return;
    // Normalize semantic decoration tags to spans so underline and strike-through
    // can be combined without browser-specific nesting behaviour getting in the way.
    appState.textEditorContent.querySelectorAll<HTMLElement>('u,s,del,strike').forEach(node => {
        const tag = node.tagName;
        const span = document.createElement('span');
        span.setAttribute('style', node.getAttribute('style') || '');
        const existing = span.style.textDecoration.trim();
        const decoration = tag === 'U' ? 'underline' : 'line-through';
        span.style.textDecoration = existing ? `${existing} ${decoration}` : decoration;
        while (node.firstChild)
            span.appendChild(node.firstChild);
        node.replaceWith(span);
    });
}

export function toggleEditorDecoration(property: 'underline' | 'line-through', command: string) {
    if (!appState.textEditorContent)
        return;
    restoreEditorSelection();
    appState.textEditorContent.focus();
    restoreEditorSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !appState.textEditorContent.contains(sel.anchorNode)) {
        return;
    }
    // Let the browser perform the actual range editing. Semantic decoration
    // tags are normalized after the command so the live selection is preserved.
    setLegacyStyleWithCss(false);
    const before = appState.textEditorContent.innerHTML;
    legacyContentEditableCommand(command);
    const changed = appState.textEditorContent.innerHTML !== before;
    // Deterministic fallback for browsers where execCommand is unavailable.
    if (!changed) {
        const range = sel.getRangeAt(0).cloneRange();
        if (!range.collapsed) {
            const wrapper = document.createElement('span');
            wrapper.style.textDecoration = property;
            try {
                wrapper.appendChild(range.extractContents());
                range.insertNode(wrapper);
                range.selectNodeContents(wrapper);
                sel.removeAllRanges();
                sel.addRange(range);
            }
            catch { }
        }
    }
    saveEditorSelection();
    normalizeDecorationTags();
    updateRichToolbar();
    redraw();
}

export function toggleEditorUnderline() { toggleEditorDecoration('underline', 'underline'); }

export function toggleEditorStrikeThrough() { toggleEditorDecoration('line-through', 'strikeThrough'); }

export function getSelectionElement(): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !appState.textEditorContent)
        return null;
    let node = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode as HTMLElement;
    return node?.closest('div,p,li,span,strong,b,em,i,u,s,mark') as HTMLElement | null;
}

export function closestBlock(node: Node | null): HTMLElement | null {
    let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement | null;
    return el?.closest('div,p,li') as HTMLElement | null;
}

export function stripChecklistMarker(block: HTMLElement) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text | null;
    if (!first)
        return false;
    const value = first.textContent || '';
    const match = value.match(/^\s*[☐☑]\s?/);
    if (!match)
        return false;
    first.textContent = value.slice(match[0].length);
    return true;
}

export function getEditorBlocksFromSelection(restore = false): HTMLElement[] {
    const editorContent = appState.textEditorContent;
    if (!editorContent)
        return [];
    if (restore)
        restoreEditorSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return [];
    const range = sel.getRangeAt(0);
    const blocks: HTMLElement[] = [];
    const push = (b: HTMLElement | null) => { if (b && editorContent.contains(b) && !blocks.includes(b))
        blocks.push(b); };
    const closestRelevant = (node: Node | null): HTMLElement | null => {
        let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement | null;
        while (el && el !== appState.textEditorContent) {
            if (el.tagName === 'LI' && (el.parentElement?.tagName === 'UL' || el.parentElement?.tagName === 'OL'))
                return el;
            if ((el.tagName === 'DIV' || el.tagName === 'P') && el.parentElement === appState.textEditorContent)
                return el;
            el = el.parentElement;
        }
        return null;
    };
    push(closestRelevant(range.startContainer));
    push(closestRelevant(range.endContainer));
    const walker = document.createTreeWalker(editorContent, NodeFilter.SHOW_ELEMENT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
        const el = n as HTMLElement;
        const isLine = (el.tagName === 'LI' && (el.parentElement?.tagName === 'UL' || el.parentElement?.tagName === 'OL')) || ((el.tagName === 'DIV' || el.tagName === 'P') && el.parentElement === appState.textEditorContent);
        if (!isLine)
            continue;
        try {
            if (range.intersectsNode(el))
                push(el);
        }
        catch { }
    }
    blocks.sort((a, b) => {
        if (a === b)
            return 0;
        const pos = a.compareDocumentPosition(b);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return blocks;
}

export function removeChecklistMarkerFromBlock(block: HTMLElement) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text | null;
    if (!first)
        return false;
    const value = first.textContent || '';
    const match = value.match(/^\s*[☐☑]\s?/);
    if (!match)
        return false;
    if (value.trim() === '☐' || value.trim() === '☑' || value === match[0])
        first.parentNode?.removeChild(first);
    else
        first.textContent = value.slice(match[0].length);
    return true;
}

export function getChecklistState(block: HTMLElement): 'checked' | 'unchecked' | 'none' {
    if (block.dataset.checklist === 'true')
        return block.dataset.checked === 'true' ? 'checked' : 'unchecked';
    const text = (block.textContent || '').trimStart();
    if (text.startsWith('☑ ') || text === '☑')
        return 'checked';
    if (text.startsWith('☐ ') || text === '☐')
        return 'unchecked';
    return 'none';
}

export function listElementForBlock(block: HTMLElement): HTMLElement | null { return block.closest('ul,ol') as HTMLElement | null; }

export function unwrapListBlocks(blocks: HTMLElement[]): HTMLElement[] {
    if (!appState.textEditorContent)
        return [];
    const replacements: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const block of blocks) {
        const li = (block.tagName === 'LI' ? block : block.closest('li')) as HTMLElement | null;
        if (!li || !appState.textEditorContent.contains(li) || seen.has(li))
            continue;
        seen.add(li);
        const replacement = document.createElement('div');
        while (li.firstChild) {
            const child = li.firstChild as Node;
            if (child.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((child as HTMLElement).tagName))
                break;
            replacement.appendChild(child);
        }
        if (!replacement.firstChild)
            replacement.appendChild(document.createElement('br'));
        li.parentNode?.insertBefore(replacement, li);
        li.remove();
        replacements.push(replacement);
    }
    appState.textEditorContent.querySelectorAll('ul,ol').forEach(list => { if (!list.querySelector('li'))
        list.remove(); });
    return replacements;
}

export function addChecklistMarker(block: HTMLElement, checked = false) {
    removeChecklistMarkerFromBlock(block);
    block.dataset.checklist = 'true';
    block.dataset.checked = String(checked);
    block.insertBefore(document.createTextNode(checked ? '☑ ' : '☐ '), block.firstChild);
}

export function setChecklistMarker(block: HTMLElement, checked: boolean) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text | null;
    if (!first) {
        addChecklistMarker(block, checked);
        return;
    }
    const value = first.textContent || '';
    const match = value.match(/^\s*[☐☑]\s?/);
    first.textContent = match ? (checked ? '☑ ' : '☐ ') + value.slice(match[0].length) : (checked ? '☑ ' : '☐ ') + value;
    block.dataset.checklist = 'true';
    block.dataset.checked = String(checked);
}

export function firstContentPosition(block: HTMLElement): {
    node: Node;
    offset: number;
} | null {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
        const text = n.textContent || '';
        const prefix = text.match(/^\s*[☐☑]\s?/);
        if (prefix)
            return { node: n, offset: prefix[0].length };
        if (text.length)
            return { node: n, offset: 0 };
    }
    return null;
}

export function lastTextPosition(block: HTMLElement): {
    node: Node;
    offset: number;
} | null {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    let n: Node | null;
    while ((n = walker.nextNode()))
        last = n as Text;
    return last ? { node: last, offset: (last.textContent || '').length } : null;
}

export function selectWholeBlocks(blocks: HTMLElement[], skipChecklistMarker = true) {
    const editorContent = appState.textEditorContent;
    if (!editorContent || !blocks.length)
        return;
    const ordered = blocks.filter(b => editorContent.contains(b));
    if (!ordered.length)
        return;
    const start = skipChecklistMarker ? firstContentPosition(ordered[0]) : firstContentPosition(ordered[0]);
    const end = lastTextPosition(ordered[ordered.length - 1]);
    if (!start || !end)
        return;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    restoreRange(range);
}

export function blockContentRange(block: HTMLElement): Range | null {
    const range = document.createRange();
    const first = firstTextPosition(block);
    const last = lastTextPosition(block);
    if (!first || !last)
        return null;
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    return range;
}

export function firstTextPosition(block: HTMLElement): {
    node: Node;
    offset: number;
} | null {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
        const text = n.textContent || '';
        if (text.length)
            return { node: n, offset: 0 };
    }
    const br = block.querySelector('br');
    if (br?.parentNode)
        return { node: br.parentNode, offset: Array.from(br.parentNode.childNodes).indexOf(br) };
    return null;
}

export function getSelectedBlocksWithoutRestoring(): HTMLElement[] {
    const editorContent = appState.textEditorContent;
    if (!editorContent)
        return [];
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return [];
    const range = sel.getRangeAt(0);
    if (!editorContent.contains(range.commonAncestorContainer))
        return [];
    const blocks: HTMLElement[] = [];
    const add = (el: HTMLElement | null) => {
        if (el && editorContent.contains(el) && !blocks.includes(el))
            blocks.push(el);
    };
    const findBlock = (node: Node | null): HTMLElement | null => {
        let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement | null;
        while (el && el !== appState.textEditorContent) {
            if (el.tagName === 'LI' && (el.parentElement?.tagName === 'UL' || el.parentElement?.tagName === 'OL'))
                return el;
            if ((el.tagName === 'DIV' || el.tagName === 'P') && el.parentElement === appState.textEditorContent)
                return el;
            el = el.parentElement;
        }
        return null;
    };
    add(findBlock(range.startContainer));
    add(findBlock(range.endContainer));
    const walker = document.createTreeWalker(editorContent, NodeFilter.SHOW_ELEMENT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
        const el = n as HTMLElement;
        const isBlock = (el.tagName === 'LI' && (el.parentElement?.tagName === 'UL' || el.parentElement?.tagName === 'OL')) ||
            ((el.tagName === 'DIV' || el.tagName === 'P') && el.parentElement === appState.textEditorContent);
        if (!isBlock)
            continue;
        try {
            if (range.intersectsNode(el))
                add(el);
        }
        catch { }
    }
    return blocks;
}

export function normalizeSelectedListItems(blocks: HTMLElement[]): HTMLElement[] {
    return blocks
        .filter(block => block.tagName === 'LI' && appState.textEditorContent?.contains(block))
        .filter((block, i, arr) => arr.indexOf(block) === i);
}

export function unwrapSelectedListItems(items: HTMLElement[]) {
    const byList = new Map<HTMLElement, HTMLElement[]>();
    for (const li of items) {
        const list = li.parentElement as HTMLElement | null;
        if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL'))
            continue;
        if (!byList.has(list))
            byList.set(list, []);
        byList.get(list)!.push(li);
    }
    for (const [list, selected] of byList) {
        const children = Array.from(list.children).filter(c => c.tagName === 'LI') as HTMLElement[];
        let run: HTMLElement[] = [];
        const flush = () => {
            if (!run.length)
                return;
            const fragment = document.createDocumentFragment();
            for (const li of run) {
                const div = document.createElement('div');
                while (li.firstChild) {
                    const child = li.firstChild;
                    if (child.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((child as HTMLElement).tagName))
                        break;
                    div.appendChild(child);
                }
                if (!div.firstChild)
                    div.appendChild(document.createElement('br'));
                fragment.appendChild(div);
                li.remove();
            }
            list.parentNode?.insertBefore(fragment, list);
            run = [];
        };
        for (const li of children) {
            if (selected.includes(li))
                run.push(li);
            else
                flush();
        }
        flush();
        if (!list.querySelector('li'))
            list.remove();
    }
}

export function convertListElementType(list: HTMLElement, mode: 'bullet' | 'number') {
    const replacement = document.createElement(mode === 'bullet' ? 'ul' : 'ol');
    replacement.className = list.className;
    while (list.firstChild)
        replacement.appendChild(list.firstChild);
    list.replaceWith(replacement);
}

export function wrapPlainBlocksInList(blocks: HTMLElement[], mode: 'bullet' | 'number') {
    const plain = blocks.filter(block => block.tagName === 'DIV' || block.tagName === 'P');
    if (!plain.length)
        return;
    const groups: HTMLElement[][] = [];
    let group: HTMLElement[] = [];
    for (const block of plain) {
        const previous = group[group.length - 1];
        const contiguous = !!previous && previous.parentNode === block.parentNode && previous.nextSibling === block;
        if (!group.length || contiguous)
            group.push(block);
        else {
            groups.push(group);
            group = [block];
        }
    }
    if (group.length)
        groups.push(group);
    for (const items of groups) {
        const first = items[0];
        const parent = first.parentNode;
        if (!parent)
            continue;
        const list = document.createElement(mode === 'bullet' ? 'ul' : 'ol');
        list.className = 'rich-list';
        parent.insertBefore(list, first);
        for (const block of items) {
            const li = document.createElement('li');
            while (block.firstChild)
                li.appendChild(block.firstChild);
            list.appendChild(li);
            block.remove();
        }
    }
}

export function restoreSelectionAcrossBlocks(blocks: HTMLElement[]) {
    if (!appState.textEditorContent || !blocks.length)
        return;
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    const range = document.createRange();
    const firstPos = firstTextPosition(first);
    const lastPos = lastTextPosition(last);
    if (!firstPos || !lastPos)
        return;
    range.setStart(firstPos.node, firstPos.offset);
    range.setEnd(lastPos.node, lastPos.offset);
    restoreRange(range);
    saveEditorSelection();
}

export function normalizeEditorListStructure() {
    if (!appState.textEditorContent)
        return;
    // Browser list commands can leave two adjacent UL/OL containers after a
    // partial toggle. Adjacent containers of the same type are one logical list;
    // merge them so ordered numbering cannot restart at 1 and bullet toggling is
    // fully reversible.
    const parents: HTMLElement[] = [appState.textEditorContent, ...Array.from(appState.textEditorContent.querySelectorAll<HTMLElement>('li'))];
    for (const parent of parents) {
        let node = parent.firstChild;
        while (node) {
            if (node.nodeType !== Node.ELEMENT_NODE || !['UL', 'OL'].includes((node as HTMLElement).tagName)) {
                node = node.nextSibling;
                continue;
            }
            const list = node as HTMLElement;
            let probe = list.nextSibling;
            while (probe && probe.nodeType === Node.TEXT_NODE && !(probe.textContent || '').trim())
                probe = probe.nextSibling;
            if (probe && probe.nodeType === Node.ELEMENT_NODE && (probe as HTMLElement).tagName === list.tagName) {
                const nextList = probe as HTMLElement;
                while (nextList.firstChild)
                    list.appendChild(nextList.firstChild);
                nextList.remove();
                continue;
            }
            node = list.nextSibling;
        }
    }
    appState.textEditorContent.querySelectorAll('ul,ol').forEach(list => { if (!list.querySelector(':scope > li'))
        list.remove(); });
    // Chromium can preserve LI[value]/OL[start] from the pre-indent position.
    // Our visible numbering is structural, so stale explicit values must not
    // survive a Tab/Shift+Tab move and later corrupt the canonical numberPath.
    appState.textEditorContent.querySelectorAll('li[value]').forEach(li => li.removeAttribute('value'));
    appState.textEditorContent.querySelectorAll('ol[start]').forEach(list => list.removeAttribute('start'));
    appState.textEditorContent.querySelectorAll('li').forEach(li => { if (!li.textContent?.trim() && !li.querySelector('br'))
        li.appendChild(document.createElement('br')); });
}

export function closestEditorListItem(node: Node | null): HTMLElement | null {
    if (!appState.textEditorContent || !node)
        return null;
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement | null;
    while (el && el !== appState.textEditorContent) {
        if (el.tagName === 'LI' && (el.parentElement?.tagName === 'UL' || el.parentElement?.tagName === 'OL'))
            return el;
        el = el.parentElement;
    }
    return null;
}

export function listItemOwnContentIntersectsRange(li: HTMLElement, range: Range): boolean {
    // A parent LI contains its nested UL/OL, so range.intersectsNode(li) alone
    // incorrectly selects the parent whenever the caret is inside a child item.
    // Only count the LI when the range touches content that belongs to this item
    // itself (not one of its descendant lists).
    for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((child as HTMLElement).tagName))
            continue;
        try {
            if (range.intersectsNode(child))
                return true;
        }
        catch { }
    }
    return false;
}

export function getSelectedListItemsForNesting(): HTMLElement[] {
    const editorContent = appState.textEditorContent;
    if (!editorContent)
        return [];
    restoreEditorSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return [];
    const range = sel.getRangeAt(0);
    if (!editorContent.contains(range.commonAncestorContainer))
        return [];
    if (range.collapsed) {
        const li = closestEditorListItem(range.startContainer);
        return li ? [li] : [];
    }
    const items: HTMLElement[] = [];
    editorContent.querySelectorAll<HTMLElement>('li').forEach(li => {
        if (listItemOwnContentIntersectsRange(li, range))
            items.push(li);
    });
    // Always include the actual start/end list items even for an empty LI whose
    // only child is <br> or when the browser gives us an unusual boundary node.
    for (const li of [closestEditorListItem(range.startContainer), closestEditorListItem(range.endContainer)]) {
        if (li && !items.includes(li))
            items.push(li);
    }
    items.sort((a, b) => {
        if (a === b)
            return 0;
        const pos = a.compareDocumentPosition(b);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return items;
}

export function directListChild(li: HTMLElement, tagName: 'UL' | 'OL'): HTMLElement | null {
    return Array.from(li.children).find(child => child.tagName === tagName) as HTMLElement | undefined || null;
}

export function listDepth(li: HTMLElement): number {
    let depth = 0;
    let node: HTMLElement | null = li.parentElement;
    while (node && node !== appState.textEditorContent) {
        if (node.tagName === 'UL' || node.tagName === 'OL')
            depth++;
        node = node.parentElement;
    }
    return depth;
}

export function selectedSiblingRuns(items: HTMLElement[]): Array<{
    list: HTMLElement;
    items: HTMLElement[];
}> {
    const selected = new Set(items);
    const runs: Array<{
        list: HTMLElement;
        items: HTMLElement[];
    }> = [];
    const lists = Array.from(new Set(items.map(li => li.parentElement).filter((x): x is HTMLElement => !!x)));
    for (const list of lists) {
        const children = Array.from(list.children).filter(child => child.tagName === 'LI') as HTMLElement[];
        let run: HTMLElement[] = [];
        const flush = () => { if (run.length)
            runs.push({ list, items: run }); run = []; };
        for (const li of children) {
            if (selected.has(li))
                run.push(li);
            else
                flush();
        }
        flush();
    }
    return runs;
}

export function restoreRangeAfterListMutation(range: Range | null, collapsedCaret?: { node: Node; offset: number } | null) {
    if (!appState.textEditorContent)
        return;
    normalizeEditorListStructure();
    let restored = false;
    // DOM Range objects are live. Moving an LI between lists can cause Chromium
    // to re-anchor a collapsed Range to the old parent even though its text node
    // survived. Prefer a fresh Range built from the pre-mutation caret node so an
    // immediate Tab -> Shift+Tab operates on the same logical list item.
    if (collapsedCaret?.node.isConnected && appState.textEditorContent.contains(collapsedCaret.node)) {
        const fresh = document.createRange();
        const maxOffset = collapsedCaret.node.nodeType === Node.TEXT_NODE
            ? (collapsedCaret.node.textContent || '').length
            : collapsedCaret.node.childNodes.length;
        fresh.setStart(collapsedCaret.node, Math.max(0, Math.min(collapsedCaret.offset, maxOffset)));
        fresh.collapse(true);
        restoreRange(fresh);
        restored = true;
    }
    if (!restored && range && range.startContainer.isConnected && range.endContainer.isConnected &&
        appState.textEditorContent.contains(range.startContainer) && appState.textEditorContent.contains(range.endContainer)) {
        restoreRange(range);
    }
    saveEditorSelection();
    normalizeEditorFontTags();
    normalizeDecorationTags();
    syncLiveTextEditorSize();
    syncArrowLabelEditorPosition();
    positionTextEditor();
    refreshRichToolbarState();
    scheduleRichToolbarPosition();
    redraw();
}

export function indentSelectedListItems(selectedItemsOverride?: HTMLElement[]): boolean {
    if (!appState.textEditorContent)
        return false;
    restoreEditorSelection();
    appState.textEditorContent.focus();
    restoreEditorSelection();
    const sel = window.getSelection();
    const savedRange = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const collapsedCaret = savedRange?.collapsed ? { node: savedRange.startContainer, offset: savedRange.startOffset } : null;
    const selectedItems = selectedItemsOverride ?? getSelectedListItemsForNesting();
    if (!selectedItems.length)
        return false;
    // If a parent item and one of its descendants are both in a broad selection,
    // move only the parent. Its entire nested subtree naturally moves with it.
    const selectedSet = new Set(selectedItems);
    const roots = selectedItems.filter(li => {
        let parent = li.parentElement?.closest('li') as HTMLElement | null;
        while (parent) {
            if (selectedSet.has(parent))
                return false;
            parent = parent.parentElement?.closest('li') as HTMLElement | null;
        }
        return true;
    });
    let changed = false;
    // Deepest groups first keeps independently selected nested runs stable.
    const runs = selectedSiblingRuns(roots).sort((a, b) => listDepth(b.items[0]) - listDepth(a.items[0]));
    for (const run of runs) {
        const first = run.items[0];
        const previous = first.previousElementSibling as HTMLElement | null;
        if (!previous || previous.tagName !== 'LI')
            continue; // first item has nothing to nest under
        const tag = run.list.tagName as 'UL' | 'OL';
        let nested = directListChild(previous, tag);
        if (!nested) {
            nested = document.createElement(tag.toLowerCase()) as HTMLElement;
            nested.className = 'rich-list';
            previous.appendChild(nested);
        }
        for (const li of run.items)
            nested.appendChild(li);
        changed = true;
    }
    if (!changed)
        return false;
    restoreRangeAfterListMutation(savedRange, collapsedCaret);
    return true;
}

export function outdentSelectedListItems(selectedItemsOverride?: HTMLElement[]): boolean {
    if (!appState.textEditorContent)
        return false;
    restoreEditorSelection();
    appState.textEditorContent.focus();
    restoreEditorSelection();
    const sel = window.getSelection();
    const savedRange = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const collapsedCaret = savedRange?.collapsed ? { node: savedRange.startContainer, offset: savedRange.startOffset } : null;
    const selectedItems = selectedItemsOverride ?? getSelectedListItemsForNesting();
    if (!selectedItems.length)
        return false;
    const selectedSet = new Set(selectedItems);
    const roots = selectedItems.filter(li => {
        let parent = li.parentElement?.closest('li') as HTMLElement | null;
        while (parent) {
            if (selectedSet.has(parent))
                return false;
            parent = parent.parentElement?.closest('li') as HTMLElement | null;
        }
        return true;
    });
    let changed = false;
    const runs = selectedSiblingRuns(roots).sort((a, b) => listDepth(b.items[0]) - listDepth(a.items[0]));
    for (const run of runs) {
        const nestedList = run.list;
        const ownerLi = nestedList.parentElement;
        if (!ownerLi || ownerLi.tagName !== 'LI')
            continue; // already at root list level
        const outerList = ownerLi.parentElement;
        if (!outerList || (outerList.tagName !== 'UL' && outerList.tagName !== 'OL'))
            continue;
        // Insert the whole selected run immediately after the owner LI. Inserting
        // each subsequent node after the previous one preserves the visual/order
        // sequence and lets OL numbering recalculate naturally at the new level.
        let insertAfter: Element = ownerLi;
        for (const li of run.items) {
            insertAfter.insertAdjacentElement('afterend', li);
            insertAfter = li;
        }
        if (!nestedList.querySelector(':scope > li'))
            nestedList.remove();
        changed = true;
    }
    if (!changed)
        return false;
    restoreRangeAfterListMutation(savedRange, collapsedCaret);
    return true;
}

export function handleEditorListTab(e: KeyboardEvent): boolean {
    if (e.key !== 'Tab' || !appState.textEditorContent)
        return false;
    const items = getSelectedListItemsForNesting();
    if (!items.length)
        return false;
    e.preventDefault();
    e.stopPropagation();
    // Use the exact LI nodes resolved for this key event. Re-reading the saved
    // Range after an indent DOM move can briefly resolve to the owner/parent LI
    // in Chromium, making the immediate Shift+Tab a no-op. Passing the stable
    // element identities keeps Tab -> Shift+Tab perfectly reversible.
    if (e.shiftKey)
        outdentSelectedListItems(items);
    else
        indentSelectedListItems(items);
    return true;
}

export function applyListMode(mode: 'bullet' | 'number') {
    if (!appState.textEditorContent)
        return;
    restoreEditorSelection();
    appState.textEditorContent.focus();
    restoreEditorSelection();
    // Let contenteditable perform the structural list toggle. It already knows
    // how to toggle the same list OFF on a second click and how to convert a
    // selected range between UL and OL without manufacturing marker characters.
    const command = mode === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList';
    legacyContentEditableCommand(command);
    normalizeEditorListStructure();
    saveEditorSelection();
    normalizeEditorFontTags();
    normalizeDecorationTags();
    syncLiveTextEditorSize();
    syncArrowLabelEditorPosition();
    positionTextEditor();
    refreshRichToolbarState();
    scheduleRichToolbarPosition();
    redraw();
}

// Checklist cycle: 1 = unchecked, 2 = checked, 3 = off.
export function toggleChecklist() {
    if (!appState.textEditorContent)
        return;
    restoreEditorSelection();
    appState.textEditorContent.focus();
    restoreEditorSelection();
    const blocks = getEditorBlocksFromSelection();
    if (!blocks.length)
        return;
    const states = blocks.map(getChecklistState);
    const allChecklist = states.every(state => state !== 'none');
    if (!allChecklist) {
        const listBlocks = blocks.filter(block => !!block.closest('li'));
        const plainBlocks = blocks.filter(block => !block.closest('li'));
        const unwrapped = unwrapListBlocks(listBlocks);
        const targets = Array.from(new Set([...unwrapped, ...plainBlocks]));
        targets.forEach(block => addChecklistMarker(block, false));
        selectWholeBlocks(targets, true);
        saveEditorSelection();
        updateRichToolbar();
        redraw();
        return;
    }
    const allChecked = states.every(state => state === 'checked');
    if (!allChecked) {
        blocks.forEach(block => setChecklistMarker(block, true));
    }
    else {
        blocks.forEach(block => { removeChecklistMarkerFromBlock(block); delete block.dataset.checklist; delete block.dataset.checked; });
    }
    selectWholeBlocks(blocks, !allChecked);
    saveEditorSelection();
    updateRichToolbar();
    redraw();
}

export function closeRichColorMenu(shell: HTMLDivElement) {
    shell.querySelector('.rich-color-menu')?.remove();
}

export function makeColorMenu(button: HTMLButtonElement, shell: HTMLDivElement) {
    const existing = shell.querySelector('.rich-color-menu') as HTMLDivElement | null;
    if (existing) {
        existing.remove();
        return;
    }
    const textPalette = TEXT_COLOR_PALETTE.map(c => [c.value, c.name] as const);
    const highlightPalette = [
        ['transparent', 'None'], ['#fef3c7', 'Yellow'], ['#fed7aa', 'Orange'], ['#fecdd3', 'Rose'], ['#fbcfe8', 'Pink'],
        ['#e9d5ff', 'Lavender'], ['#ddd6fe', 'Violet'], ['#bfdbfe', 'Blue'], ['#bae6fd', 'Sky'], ['#a7f3d0', 'Mint'],
        ['#bbf7d0', 'Green'], ['#d9f99d', 'Lime']
    ];
    const menu = document.createElement('div');
    menu.className = 'rich-color-menu notion-color-menu';
    menu.innerHTML = `
    <div class="rich-color-section-title">Text color</div>
    <div class="rich-color-grid">
      ${textPalette.map(([c, label]) => `<button type="button" class="rich-swatch" data-kind="text" data-value="${c}" style="--swatch:${c}" title="${label}" aria-label="Text: ${label}"></button>`).join('')}
    </div>
    <div class="rich-color-section-separator"></div>
    <div class="rich-color-section-title">Background</div>
    <div class="rich-color-grid">
      ${highlightPalette.map(([c, label]) => `<button type="button" class="rich-swatch${c === 'transparent' ? ' clear' : ''}" data-kind="highlight" data-value="${c}" style="--swatch:${c}" title="${label}" aria-label="Background: ${label}"></button>`).join('')}
    </div>`;
    shell.appendChild(menu);
    const buttonRect = button.getBoundingClientRect();
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.transform = 'translate(0,0)';
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, buttonRect.left), window.innerWidth - menuRect.width - 8);
    const top = Math.min(buttonRect.bottom + 8, window.innerHeight - menuRect.height - 8);
    // The picker is intentionally viewport-fixed so it never gets clipped by the
    // text editor or canvas bounds.
    menu.style.position = 'fixed';
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.querySelectorAll<HTMLButtonElement>('[data-value]').forEach(btn => btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const value = btn.dataset.value!;
        const kind = btn.dataset.kind;
        if (kind === 'text')
            execEditorCommand('foreColor', value);
        else
            execEditorCommand('hiliteColor', value === 'transparent' ? 'transparent' : value);
        closeRichColorMenu(shell);
    }));
}

export function getCurrentListMode(block: HTMLElement | null): 'bullet' | 'number' | 'none' {
    if (!block)
        return 'none';
    const list = block.closest('ul,ol') as HTMLElement | null;
    if (list?.tagName === 'UL')
        return 'bullet';
    if (list?.tagName === 'OL')
        return 'number';
    return 'none';
}

export function isEditorTextSelection(): boolean {
    if (!appState.textEditorContent)
        return false;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return false;
    const range = sel.getRangeAt(0);
    return !range.collapsed && appState.textEditorContent.contains(range.commonAncestorContainer) && !!sel.toString();
}

export function hideRichToolbarWhileSelecting() {
    if (!appState.textEditor)
        return;
    appState.textEditor.classList.toggle('is-pointer-selecting', appState.editorSelectionPointerActive);
    const toolbar = appState.textEditor.querySelector('.rich-toolbar') as HTMLDivElement | null;
    if (appState.editorSelectionPointerActive)
        toolbar?.classList.remove('visible');
}

export function getStableSelectionRect(range: Range): DOMRect | null {
    if (!appState.textEditorContent)
        return null;
    const editorRect = appState.textEditorContent.getBoundingClientRect();
    const rawRects = Array.from(range.getClientRects());
    // Browser Range geometry can contain zero-width caret fragments or odd
    // outliers while a multi-line selection is being normalized. Keep only
    // visible fragments that overlap the editor, then build a direction-neutral
    // union. This makes forward and backward selections produce the same anchor.
    const rects = rawRects.filter(r => Number.isFinite(r.left) && Number.isFinite(r.top) && Number.isFinite(r.right) && Number.isFinite(r.bottom) &&
        r.width > 0.5 && r.height > 0.5 &&
        r.right >= editorRect.left - 1 && r.left <= editorRect.right + 1 &&
        r.bottom >= editorRect.top - 1 && r.top <= editorRect.bottom + 1);
    if (!rects.length) {
        const fallback = range.getBoundingClientRect();
        if (!Number.isFinite(fallback.left) || !Number.isFinite(fallback.top) || fallback.width <= 0 || fallback.height <= 0)
            return null;
        return fallback;
    }
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.right));
    const top = Math.min(...rects.map(r => r.top));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
}

export function updateRichToolbarPosition() {
    if (!appState.textEditor)
        return;
    const toolbar = appState.textEditor.querySelector('.rich-toolbar') as HTMLDivElement | null;
    if (!toolbar)
        return;
    // Never let the toolbar appear underneath the mouse while the user is still
    // dragging a native selection. This was the backward-selection bug: when the
    // focus end was at the top-left, the toolbar could pop under the pointer and
    // steal pointerup/mouseup from contenteditable.
    if (appState.editorSelectionPointerActive) {
        toolbar.classList.remove('visible');
        return;
    }
    if (!isEditorTextSelection()) {
        toolbar.classList.remove('visible');
        return;
    }
    const sel = window.getSelection()!;
    const range = sel.getRangeAt(0);
    const rect = getStableSelectionRect(range);
    if (!rect) {
        toolbar.classList.remove('visible');
        return;
    }
    // Measure while hidden, then reveal only after the final position is known.
    // This avoids a one-frame flash at the previous selection's coordinates.
    toolbar.classList.remove('visible');
    const toolbarRect = toolbar.getBoundingClientRect();
    const gap = 8;
    let left = rect.left + (rect.width - toolbarRect.width) / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarRect.width - 8));
    let top = rect.top - toolbarRect.height - gap;
    if (top < 8)
        top = rect.bottom + gap;
    top = Math.max(8, Math.min(top, window.innerHeight - toolbarRect.height - 8));
    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;
    toolbar.classList.add('visible');
}

export function scheduleRichToolbarPosition() {
    if (appState.richToolbarPositionRaf !== null)
        return;
    const richToolbarPositionRaf = requestAnimationFrame(() => {
        dispatch({ type: 'SET_EDITOR', patch: { richToolbarPositionRaf: null } });
        updateRichToolbarPosition();
    });
    dispatch({ type: 'SET_EDITOR', patch: { richToolbarPositionRaf } });
}

export function getSelectionListModeFast(): 'bullet' | 'number' | 'none' {
    if (!appState.textEditorContent)
        return 'none';
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount)
        return 'none';
    const range = sel.getRangeAt(0);
    const inspect = (node: Node | null): 'bullet' | 'number' | 'none' => {
        let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement | null;
        while (el && el !== appState.textEditorContent) {
            if (el.tagName === 'UL')
                return 'bullet';
            if (el.tagName === 'OL')
                return 'number';
            el = el.parentElement;
        }
        return 'none';
    };
    const start = inspect(range.startContainer);
    const end = inspect(range.endContainer);
    return start === end ? start : 'none';
}

export function refreshRichToolbarState() {
    if (!appState.textEditor)
        return;
    const query = legacyQueryCommandState;
    appState.textEditor.querySelector('[data-cmd=bold]')?.classList.toggle('active', query('bold'));
    appState.textEditor.querySelector('[data-cmd=italic]')?.classList.toggle('active', query('italic'));
    appState.textEditor.querySelector('[data-cmd=underline]')?.classList.toggle('active', query('underline'));
    const strikeEl = appState.textEditor.querySelector('[data-cmd=strikeThrough]') as HTMLElement | null;
    let strikeActive = query('strikeThrough');
    if (!strikeActive) {
        const el = getSelectionElement();
        if (el) {
            const dec = getComputedStyle(el).textDecorationLine || getComputedStyle(el).textDecoration;
            strikeActive = dec.includes('line-through');
        }
    }
    strikeEl?.classList.toggle('active', strikeActive);
    const mode = getSelectionListModeFast();
    appState.textEditor.querySelector('#rich-bullet')?.classList.toggle('active', mode === 'bullet');
    appState.textEditor.querySelector('#rich-number')?.classList.toggle('active', mode === 'number');
}

export function updateRichToolbar() {
    if (!appState.textEditor)
        return;
    scheduleRichToolbarRefresh();
}

export function buildRichToolbar(shell: HTMLDivElement) {
    const toolbar = document.createElement('div');
    toolbar.className = 'rich-toolbar';
    toolbar.innerHTML = `
    <div class="rich-btn-group rich-format-group" aria-label="Text formatting">
      <button type="button" class="rich-btn" data-cmd="bold" title="Bold (Ctrl/Cmd+B)"><b>B</b></button>
      <button type="button" class="rich-btn" data-cmd="italic" title="Italic (Ctrl/Cmd+I)"><i>I</i></button>
      <button type="button" class="rich-btn" data-cmd="underline" title="Underline (Ctrl/Cmd+U)"><u>U</u></button>
      <button type="button" class="rich-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
    </div>
    <div class="rich-btn-group rich-color-group" aria-label="Colors">
      <button type="button" class="rich-btn rich-color-text-btn" id="rich-text-color" title="Text & background color" aria-label="Text and background color"><span class="rich-color-letter">A</span></button>
    </div>
    <div class="rich-btn-group rich-list-group" aria-label="Lists">
      <button type="button" class="rich-btn rich-list-btn" id="rich-bullet" title="Bulleted list"><span class="rich-list-glyph">•</span><span class="rich-list-lines">≡</span></button>
      <button type="button" class="rich-btn rich-list-btn" id="rich-number" title="Numbered list"><span class="rich-list-num">1.</span><span class="rich-list-lines">≡</span></button>
    </div>
    <button type="button" class="rich-btn rich-clear-btn" id="rich-clear" title="Clear formatting">Tx</button>`;
    shell.appendChild(toolbar);
    toolbar.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach(btn => btn.addEventListener('mousedown', e => { e.preventDefault(); if (btn.dataset.cmd === 'strikeThrough')
        toggleEditorStrikeThrough();
    else if (btn.dataset.cmd === 'underline')
        toggleEditorUnderline();
    else
        execEditorCommand(btn.dataset.cmd!); }));
    toolbar.querySelector('#rich-text-color')?.addEventListener('mousedown', e => { e.preventDefault(); makeColorMenu(e.currentTarget as HTMLButtonElement, shell); });
    toolbar.querySelector('#rich-bullet')?.addEventListener('mousedown', e => { e.preventDefault(); applyListMode('bullet'); });
    toolbar.querySelector('#rich-number')?.addEventListener('mousedown', e => { e.preventDefault(); applyListMode('number'); });
    toolbar.querySelector('#rich-clear')?.addEventListener('mousedown', e => { e.preventDefault(); execEditorCommand('removeFormat'); execEditorCommand('formatBlock', 'div'); });
    return toolbar;
}

export function scheduleRichToolbarRefresh() {
    if (appState.richToolbarRefreshRaf !== null)
        return;
    const richToolbarRefreshRaf = requestAnimationFrame(() => {
        dispatch({ type: 'SET_EDITOR', patch: { richToolbarRefreshRaf: null } });
        if (!appState.textEditor)
            return;
        refreshRichToolbarState();
        updateRichToolbarPosition();
    });
    dispatch({ type: 'SET_EDITOR', patch: { richToolbarRefreshRaf } });
}

export function handleEditorSelectionChange() {
    // Keep the native selection entirely in the browser's hands while dragging.
    // Save the Range, but do not show/reposition the toolbar until pointerup.
    saveEditorSelection();
    if (appState.editorSelectionPointerActive) {
        hideRichToolbarWhileSelecting();
        return;
    }
    scheduleRichToolbarRefresh();
}

export function beginEditorPointerSelection(e: PointerEvent) {
    if (e.button !== 0 || !appState.textEditorContent)
        return;
    const target = e.target as Node | null;
    if (!target || !appState.textEditorContent.contains(target))
        return;
    dispatch({ type: 'SET_EDITOR', patch: { editorSelectionPointerActive: true, editorSelectionPointerId: e.pointerId } });
    hideRichToolbarWhileSelecting();
}

export function finishEditorPointerSelection(e?: PointerEvent) {
    if (!appState.editorSelectionPointerActive)
        return;
    if (e && appState.editorSelectionPointerId !== null && e.pointerId !== appState.editorSelectionPointerId)
        return;
    dispatch({ type: 'SET_EDITOR', patch: { editorSelectionPointerActive: false, editorSelectionPointerId: null } });
    hideRichToolbarWhileSelecting();
    // Native contenteditable selection can settle one frame after pointerup,
    // especially for backward/multi-line drags. Wait two frames and position
    // once from the finalized direction-neutral Range geometry.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!appState.textEditor)
            return;
        saveEditorSelection();
        refreshRichToolbarState();
        updateRichToolbarPosition();
    }));
}

export function syncLiveTextEditorSize() {
    if (!appState.textEditor || !appState.textEditorContent || appState.textEditor.dataset.kind !== 'text')
        return;
    const html = appState.textEditorContent.innerHTML || '<div><br></div>';
    const plain = appState.textEditorContent.innerText || '';
    const id = appState.editingTextId;
    const editingTarget = id ? appState.elements.find(el => el.id === id) : undefined;
    const baseColor = editingTarget && (editingTarget.type === 'arrow' || editingTarget.type === 'connector') ? ARROW_LABEL_TEXT_COLOR : (editingTarget?.color || '#111827');
    const scale = Number(appState.textEditorContent.dataset.renderScale || 1);
    const layout = measureRichTextLayout(html, plain, DEFAULT_TEXT_FONT_SIZE, baseColor, undefined, scale, appState.textEditorContent.dataset.fontFamily);
    const width = Math.max(24, Math.ceil(layout.width) + TEXT_BBOX_PAD * 2);
    // Let the browser's content box grow to the measured line stack. Do not set
    // a fixed height that can become stale while a wrapped line is being edited.
    const height = Math.max(22, Math.ceil(layout.height) + TEXT_BBOX_PAD * 2);
    appState.textEditor.dataset.width = String(width);
    appState.textEditor.dataset.height = String(height);
    appState.textEditorContent.style.width = `${width}px`;
    appState.textEditorContent.style.minHeight = `${height}px`;
    appState.textEditorContent.style.height = `${height}px`;
    const anchorX = Number(appState.textEditor.dataset.anchorX || 0);
    const anchorY = Number(appState.textEditor.dataset.anchorY || 0);
    dispatch({ type: 'SET_EDITOR', patch: { liveTextEditorBounds: {
        x: anchorX - TEXT_BBOX_PAD,
        y: anchorY - TEXT_BBOX_PAD,
        width,
        height,
    } } });
}

function arrowTextTargetFontSize(arrow: ArrowElement, target: { kind: ArrowTextTarget; branchId?: string }): number {
    return target.kind === 'label' ? normalizeArrowLabelFontSize(arrow.labelFontSize) : ARROW_LABEL_FONT_SIZE;
}

function getLiveArrowTextLayout(arrow: ArrowElement, target: { kind: ArrowTextTarget; branchId?: string }, lines: RichLine[], family: string): ArrowLabelLayout | null {
    if (target.kind === 'branch' && target.branchId) {
        const branch = getArrowBranches(arrow).find(item => item.id === target.branchId);
        if (!branch) return null;
        return getPathLabelLayoutFromLines(lines, getArrowBranchRenderPoints(arrow, branch), clampArrowLabelPosition(branch.labelPosition), branch.labelSide === 1 ? 1 : -1, ARROW_LABEL_FONT_SIZE, family, getArrowLabelCollisionBounds(arrow.id));
    }
    if (target.kind === 'start' || target.kind === 'end')
        return getEndpointLabelLayoutFromLines(arrow, target.kind, lines, family);
    return getPathLabelLayoutFromLines(lines, getArrowRenderPoints(arrow), clampArrowLabelPosition(arrow.labelPosition), arrowLabelSide(arrow), normalizeArrowLabelFontSize(arrow.labelFontSize), family, getArrowLabelCollisionBounds(arrow.id));
}

export function syncArrowLabelEditorPosition() {
    if (!appState.textEditor || !appState.textEditorContent || !appState.editingTextId || (appState.textEditor.dataset.kind !== 'arrow' && appState.textEditor.dataset.kind !== 'connector'))
        return;
    const el = appState.elements.find(x => x.id === appState.editingTextId);
    if (!el || (el.type !== 'arrow' && el.type !== 'connector'))
        return;
    const arrow = el as ArrowElement, target = appState.editingArrowTextTarget ?? { kind: 'label' as ArrowTextTarget };
    const html = appState.textEditorContent.innerHTML || '<div><br></div>';
    const liveLines = textDocumentFromHtml(html, ARROW_LABEL_TEXT_COLOR).lines;
    const family = normalizeFontFamily(appState.textEditorContent.dataset.fontFamily || DEFAULT_FONT_FAMILY);
    const layout = getLiveArrowTextLayout(arrow, target, liveLines, family);
    if (!layout) return;

    // The DOM editor uses the exact same wrapping width, line stack, padding,
    // font size/family, and collision-resolved anchor as the canvas layout.
    // This is the WYSIWYG contract for connector labels.
    const width = layout.textWidth + ARROW_LABEL_PAD_X * 2;
    const height = layout.textHeight + ARROW_LABEL_PAD_Y * 2;
    const anchor = { x: layout.textX - ARROW_LABEL_PAD_X, y: layout.box.y };
    appState.textEditor.dataset.width = String(width);
    appState.textEditor.dataset.height = String(height);
    appState.textEditor.dataset.anchorX = String(anchor.x);
    appState.textEditor.dataset.anchorY = String(anchor.y);
    appState.textEditorContent.style.width = `${width}px`;
    appState.textEditorContent.style.minHeight = `${height}px`;
    appState.textEditorContent.style.height = `${height}px`;
    appState.textEditorContent.style.lineHeight = String(RICH_TEXT_LINE_HEIGHT);
}

export function syncShapeTextEditorPosition() {
    const shell = appState.textEditor;
    const editor = appState.textEditorContent;
    if (!shell || !editor || (shell.dataset.kind !== 'note' && shell.dataset.kind !== 'rectangle')) return;
    const id = appState.editingTextId;
    const el = id ? appState.elements.find(item => item.id === id) : undefined;
    if (!el || (el.type !== 'note' && el.type !== 'rectangle')) return;
    const b = getBoundingBox(el);
    const width = Math.max(20, b.width - TEXT_PAD_X * 2);
    const html = editor.innerHTML || '<div><br></div>';
    const plain = editor.innerText || '';
    const scale = getTextScale(el);
    const layout = measureRichTextLayout(html, plain, DEFAULT_TEXT_FONT_SIZE, el.color, width, scale, editor.dataset.fontFamily || el.fontFamily);
    const innerHeight = Math.max(0, b.height - TEXT_PAD_Y * 2);
    const offset = el.textVerticalAlign === 'middle' ? Math.max(0, (innerHeight - layout.height) / 2) : 0;
    // Bound the live editor to the shape's inner height. A pasted list should not
    // create a transparent contenteditable overlay far beyond the Note/Rectangle
    // and accidentally swallow outside clicks.
    editor.style.maxHeight = `${Math.max(22, innerHeight)}px`;
    shell.dataset.width = String(width);
    shell.dataset.anchorX = String(b.x + TEXT_PAD_X);
    shell.dataset.anchorY = String(b.y + TEXT_PAD_Y + offset);
    shell.dataset.shapeX = String(b.x);
    shell.dataset.shapeY = String(b.y);
    shell.dataset.shapeWidth = String(b.width);
    shell.dataset.shapeHeight = String(b.height);
}

export function positionTextEditor() {
    if (!appState.textEditor)
        return;
    const a = appState.textEditor.dataset.anchorX && appState.textEditor.dataset.anchorY ? getWorldToScreen({ x: Number(appState.textEditor.dataset.anchorX), y: Number(appState.textEditor.dataset.anchorY) }) : { x: 0, y: 0 };
    appState.textEditor.style.left = `${a.x}px`;
    appState.textEditor.style.top = `${Math.max(6, a.y)}px`;
    const kind = appState.textEditor.dataset.kind;
    // Keep layout dimensions in world-equivalent CSS pixels and scale only the
    // editable surface. The toolbar stays at a comfortable, fixed UI size.
    const width = Number(appState.textEditor.dataset.width || 0);
    appState.textEditor.style.width = `${kind === 'text' ? Math.max(24, width) : kind === 'arrow' || kind === 'connector' ? Math.max(34, Math.min(ARROW_LABEL_MAX_WIDTH + ARROW_LABEL_PAD_X * 2, width)) : Math.max(20, width)}px`;
    const editor = appState.textEditorContent;
    if (editor) {
        editor.style.transformOrigin = 'top left';
        editor.style.transform = `scale(${getEditorScreenScale()})`;
    }
}

function isTextEditorUiTarget(target: Node | null): boolean {
    const shell = appState.textEditor;
    if (!shell || !target)
        return false;
    const element = target.nodeType === Node.ELEMENT_NODE ? target as Element : target.parentElement;
    if (!element)
        return false;
    const editor = appState.textEditorContent;
    if (editor && (element === editor || editor.contains(element)))
        return true;
    // The floating rich toolbar is a child of the shell but positioned outside
    // its normal box. Treat only the actual controls/menus as editor UI; do not
    // let an oversized shell intercept an otherwise legitimate outside click.
    const editorUi = element.closest('.rich-toolbar, .rich-color-menu');
    return !!editorUi && shell.contains(editorUi);
}

function exitTextEditingFromEscape(e?: KeyboardEvent) {
    if (!appState.textEditor)
        return;
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    closeTextEditor(true, true);
    dispatch({ type: 'SET_SELECTION', ids: [] });
    redraw();
    updateTextStylePanel();
    requestLayersPanelRefresh();
}

export function onEditorDocumentKeyDown(e: KeyboardEvent) {
    // Capture Escape at document level so a paste-induced focus/selection change
    // cannot strand the user in edit mode. The contenteditable-local handler is
    // intentionally not relied on for this escape hatch.
    if (e.key === 'Escape' && appState.textEditor)
        exitTextEditingFromEscape(e);
}

export function onEditorWindowKeyDown(e: KeyboardEvent) {
    // Redundant top-level escape hatch. A browser paste can temporarily move the
    // active selection outside contenteditable; window capture still guarantees
    // the editing session can be closed. document's handler normally wins, and
    // closeTextEditor() is idempotent so this fallback is harmless.
    if (e.key === 'Escape' && appState.textEditor)
        exitTextEditingFromEscape(e);
}

function ensureEditorFocusAndCaret(editor: HTMLDivElement) {
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
        placeEditorCaretAtEnd(editor);
        return;
    }
    saveEditorSelection();
}

/**
 * True when the contenteditable only contains browser caret placeholders.
 * Chromium commonly represents an untouched editor as <div><br></div> and its
 * innerText as a newline; that newline is not user content and must not become
 * a second canonical line on close/reopen.
 */
function editorHasNoVisibleContent(editor: HTMLDivElement): boolean {
    const doc = textDocumentFromHtml(sanitizeRichText(editor.innerHTML || ''), editor.style.color || '#111827');
    return !doc.lines.some(line => !!line.listType || line.runs.some(run => run.text.replace(/\u00a0/g, ' ').trim().length > 0));
}

/**
 * When a list is pasted into an empty DIV/P placeholder inside contenteditable,
 * replace that placeholder instead of inserting a UL/OL beside its <br>. Leaving
 * the BR behind creates a phantom blank line and can make a fresh Note appear to
 * start on line two the next time it is edited.
 */
function selectEmptyCaretBlock(editor: HTMLDivElement): void {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    let element = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as HTMLElement
        : range.startContainer.parentElement;
    while (element && element !== editor && !['DIV', 'P', 'LI'].includes(element.tagName)) element = element.parentElement;
    if (!element || element === editor || element.tagName === 'LI') return;
    if ((element.textContent || '').replace(/\u00a0/g, ' ').trim()) return;
    if (element.querySelector('ul,ol,[data-checklist="true"]')) return;
    const replacement = document.createRange();
    replacement.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(replacement);
}

function replaceEmptyEditorWithHtml(editor: HTMLDivElement, html: string): boolean {
    if (!editorHasNoVisibleContent(editor)) return false;
    editor.innerHTML = html || '<div><br></div>';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null }));
    placeEditorCaretAtEnd(editor);
    return true;
}

export function closeTextEditor(commit = true, exitToSelect = false) {
    if (!appState.textEditor)
        return;

    // Capture everything needed for commit before detaching the editor.  The
    // teardown happens *before* parsing pasted rich HTML so a malformed browser
    // DOM can never strand the application in text-edit mode.  This is
    // especially important after pasting UL/OL fragments, where Chromium may
    // repair the DOM/selection in ways that differ between clipboard sources.
    const shell = appState.textEditor;
    const editor = appState.textEditorContent;
    const id = appState.editingTextId;
    const editingArrowTarget = appState.editingArrowTextTarget;
    const historyBefore = appState.textEditBefore;
    const rawHtml = editor?.innerHTML || '';
    const fallbackPlain = (editor?.innerText || editor?.textContent || '').replace(/\u00a0/g, ' ');
    const editorTextAlign = (editor?.dataset.textAlign as TextAlign) || undefined;
    const editorFontFamily = normalizeFontFamily(editor?.dataset.fontFamily);
    const anchorX = Number(shell.dataset.anchorX);
    const anchorY = Number(shell.dataset.anchorY);

    // Remove every exit/listener surface first. Removing the shell after the
    // listeners are detached also prevents focusout from recursively committing.
    shell.removeEventListener('focusout', onEditorBlur);
    document.removeEventListener('selectionchange', handleEditorSelectionChange);
    document.removeEventListener('pointerdown', onEditorOutsidePointerDown, true);
    document.removeEventListener('keydown', onEditorDocumentKeyDown, true);
    window.removeEventListener('keydown', onEditorWindowKeyDown, true);
    window.removeEventListener('pointerup', finishEditorPointerSelection, true);
    window.removeEventListener('pointercancel', finishEditorPointerSelection, true);
    window.removeEventListener('resize', scheduleRichToolbarPosition);
    window.removeEventListener('scroll', scheduleRichToolbarPosition, true);
    editor?.removeEventListener('pointerdown', beginEditorPointerSelection, true);
    dispatch({
        type: 'SET_EDITOR',
        patch: {
            textEditor: null,
            textEditorContent: null,
            editingTextId: null,
            editingArrowTextTarget: null,
            liveTextEditorBounds: null,
            textEditBefore: null,
            editorSelectionPointerActive: false,
            editorSelectionPointerId: null,
            savedEditorRange: null,
        },
    });
    shell.remove();

    if (commit) {
        try {
            const editingTarget = id ? appState.elements.find(el => el.id === id) : undefined;
            const baseColor = editingTarget && (editingTarget.type === 'arrow' || editingTarget.type === 'connector')
                ? ARROW_LABEL_TEXT_COLOR
                : (editingTarget?.color || '#111827');

            let savedTextDoc;
            try {
                const html = sanitizeRichText(rawHtml);
                const domValue = plainTextFromRichHtml(html);
                const parsedLines = textDocumentFromHtml(html, baseColor).lines;
                const parsedValue = parsedLines.map(line => line.runs.map(run => run.text).join('')).join('\n').replace(/\u00a0/g, ' ');
                const hasStructuredList = parsedLines.some(line => !!line.listType);
                // innerText for an untouched <div><br></div> is usually "\n" in
                // Chromium. Only consult it as a fallback when it contains actual
                // visible characters; otherwise reopening an empty Note gains a
                // phantom second line on every edit cycle.
                const meaningfulFallbackPlain = fallbackPlain.trim().length ? fallbackPlain : '';
                const visibleValue = hasStructuredList ? parsedValue : (domValue || parsedValue || meaningfulFallbackPlain);
                const savedRichLines = hasStructuredList
                    ? cloneRichLines(parsedLines)
                    : normalizeSavedRichLines(parsedLines, visibleValue, baseColor);
                savedTextDoc = textDocumentFromLines(savedRichLines);
            } catch (error) {
                // Last-resort commit path: preserve the user's visible text even
                // if a browser-specific pasted fragment cannot be parsed. Exiting
                // edit mode must never depend on successful rich-DOM parsing.
                console.warn('Falling back to plain-text commit after rich-text parse failure.', error);
                savedTextDoc = textDocumentFromPlainText(fallbackPlain, baseColor);
            }

            const value = textDocumentPlainText(savedTextDoc);
            if (id) {
                const existing = appState.elements.find(el => el.id === id);
                if (existing?.type === 'text' && !value.trim()) {
                    dispatch({ type: 'DELETE_ELEMENTS', ids: [id] });
                } else if (existing) {
                    const textAlign = editorTextAlign || ('textAlign' in existing ? existing.textAlign : undefined) || 'left';
                    const fontFamily = editorFontFamily;
                    dispatch({
                        type: 'UPDATE_ELEMENT',
                        id,
                        update: element => {
                            if (element.type === 'text') {
                                element.text = value;
                                element.textDoc = cloneTextDocument(savedTextDoc);
                                delete (element as any).richText;
                                delete (element as any).richLines;
                                element.textAlign = textAlign;
                                element.textWidth = undefined;
                            } else if (element.type === 'note') {
                                element.text = value;
                                element.textDoc = cloneTextDocument(savedTextDoc);
                                delete (element as any).richText;
                                delete (element as any).richLines;
                                element.textAlign = textAlign;
                            } else if (element.type === 'rectangle') {
                                element.text = value.trim() ? value : undefined;
                                element.textDoc = value.trim() ? cloneTextDocument(savedTextDoc) : undefined;
                                delete (element as any).richText;
                                delete (element as any).richLines;
                                element.textAlign = textAlign;
                            } else if (element.type === 'arrow' || element.type === 'connector') {
                                const arrow = element as ArrowElement;
                                const target = editingArrowTarget ?? { kind: 'label' as ArrowTextTarget };
                                const has = value.trim().length > 0;
                                if (target.kind === 'branch' && target.branchId) {
                                    const branch = getArrowBranches(arrow).find(b => b.id === target.branchId);
                                    if (branch) {
                                        branch.label = has ? value : undefined;
                                        branch.labelDoc = has ? cloneTextDocument(savedTextDoc) : undefined;
                                        delete (branch as any).labelRichText;
                                        delete (branch as any).labelRichLines;
                                        branch.labelFontFamily = fontFamily;
                                        branch.labelPosition = clampArrowLabelPosition(branch.labelPosition);
                                        branch.labelSide = branch.labelSide === 1 ? 1 : -1;
                                    }
                                } else if (target.kind === 'start') {
                                    arrow.startLabel = has ? value : undefined;
                                    arrow.startLabelDoc = has ? cloneTextDocument(savedTextDoc) : undefined;
                                    delete (arrow as any).startLabelRichText;
                                    delete (arrow as any).startLabelRichLines;
                                    arrow.startLabelFontFamily = fontFamily;
                                } else if (target.kind === 'end') {
                                    arrow.endLabel = has ? value : undefined;
                                    arrow.endLabelDoc = has ? cloneTextDocument(savedTextDoc) : undefined;
                                    delete (arrow as any).endLabelRichText;
                                    delete (arrow as any).endLabelRichLines;
                                    arrow.endLabelFontFamily = fontFamily;
                                } else {
                                    arrow.label = has ? value : undefined;
                                    arrow.labelDoc = has ? cloneTextDocument(savedTextDoc) : undefined;
                                    delete (arrow as any).labelRichText;
                                    delete (arrow as any).labelRichLines;
                                    arrow.labelFontSize = normalizeArrowLabelFontSize(arrow.labelFontSize);
                                    arrow.labelFontFamily = fontFamily;
                                    arrow.labelPosition = clampArrowLabelPosition(arrow.labelPosition);
                                    arrow.labelSide = arrowLabelSide(arrow);
                                }
                            }
                        },
                    });
                }
            } else if (value.trim()) {
                const fontSize = DEFAULT_TEXT_FONT_SIZE;
                const textAlign = editorTextAlign || 'left';
                dispatch({
                    type: 'ADD_ELEMENT',
                    element: {
                        id: generateId(),
                        type: 'text',
                        x: anchorX,
                        y: anchorY + fontSize,
                        text: value,
                        textDoc: savedTextDoc,
                        color: '#111827',
                        thickness: appState.currentThickness,
                        fontSize,
                        textAlign,
                        fontFamily: editorFontFamily,
                        name: nextAutoLayerName('text'),
                    },
                });
            }
            saveToLocal();
            commitHistory(historyBefore);
        } catch (error) {
            // The session has already been torn down above. Log commit failures,
            // but never re-open or trap the editor because of them.
            console.error('Could not commit text edit.', error);
        }
    }

    redraw();
    if (exitToSelect)
        setTool('select');
}

export function onEditorOutsidePointerDown(e: PointerEvent) {
    if (!appState.textEditor)
        return;
    const target = e.target as Node | null;
    if (isTextEditorUiTarget(target))
        return;
    closeTextEditor(true, true);
}

export function onEditorBlur(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && appState.textEditor?.contains(next))
        return;
    closeTextEditor(true, true);
}

export function placeEditorCaretAtEnd(editor: HTMLDivElement) {
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection)
        return;
    // Put the caret inside the deepest final editable node rather than merely
    // after the root element. This matters for OL/UL/LI and block-based rich
    // text because typing should continue inside the final line/list item.
    let node: Node = editor;
    while (node.lastChild)
        node = node.lastChild;
    const range = document.createRange();
    if (node.nodeType === Node.TEXT_NODE) {
        range.setStart(node, node.textContent?.length || 0);
    }
    else if (node.nodeName === 'BR' && node.parentNode) {
        // Empty contenteditable blocks commonly end in <br>. A range immediately
        // before that BR is the browser-compatible caret position for the line.
        range.setStartBefore(node);
    }
    else {
        range.selectNodeContents(node);
        range.collapse(false);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    dispatch({ type: 'SET_EDITOR', patch: { savedEditorRange: range.cloneRange() } });
}

export function startTextEditing(worldPos: Point, existingId: string | null = null, forcedAnchor?: Point, arrowTextTarget?: {
    kind: ArrowTextTarget;
    branchId?: string;
}) {
    closeTextEditor(false);
    dispatch({ type: 'SET_EDITOR', patch: { textEditBefore: beginHistoryTransaction(), editingTextId: existingId, editingArrowTextTarget: arrowTextTarget ?? null, liveTextEditorBounds: null } });
    if (existingId) {
        dispatch({ type: 'SET_SELECTION', ids: [existingId] });
        requestLayersPanelRefresh();
    }
    const existing = existingId ? appState.elements.find(el => el.id === existingId) : undefined;
    let anchor = forcedAnchor ? forcedAnchor : worldPos;
    let fontSize = DEFAULT_TEXT_FONT_SIZE;
    let value = '';
    let richHtml = '';
    let width = 24;
    let align: TextAlign = 'left';
    let verticalAlign: 'top' | 'middle' = 'top';
    let shapeBounds: { x: number; y: number; width: number; height: number } | null = null;
    let fontFamily = DEFAULT_FONT_FAMILY;
    if (existing?.type === 'text') {
        anchor = { x: existing.x, y: existing.y - existing.fontSize };
        fontSize = DEFAULT_TEXT_FONT_SIZE;
        value = existing.text;
        richHtml = textDocumentToHtml(existing.textDoc || textDocumentFromPlainText(existing.text, existing.color));
        fontFamily = normalizeFontFamily(existing.fontFamily);
        const natural = measureRichTextLayout(richHtml, value, fontSize, existing.color, undefined, getTextScale(existing), fontFamily);
        width = Math.max(24, Math.ceil(natural.width) + 2);
        align = existing.textAlign || 'left';
    }
    else if (existing?.type === 'note') {
        const note = existing;
        const b = getBoundingBox(note);
        shapeBounds = b;
        fontSize = DEFAULT_TEXT_FONT_SIZE;
        value = note.text;
        richHtml = textDocumentToHtml(note.textDoc || textDocumentFromPlainText(note.text, note.color));
        width = Math.max(20, b.width - TEXT_PAD_X * 2);
        align = note.textAlign || 'left';
        verticalAlign = note.textVerticalAlign === 'middle' ? 'middle' : 'top';
        fontFamily = normalizeFontFamily(note.fontFamily);
        const layout = measureRichTextLayout(richHtml, value, fontSize, note.color, width, getTextScale(note), fontFamily);
        const innerHeight = Math.max(0, b.height - TEXT_PAD_Y * 2);
        const offset = verticalAlign === 'middle' ? Math.max(0, (innerHeight - layout.height) / 2) : 0;
        anchor = { x: b.x + TEXT_PAD_X, y: b.y + TEXT_PAD_Y + offset };
    }
    else if (existing?.type === 'rectangle' && existing.text !== undefined) {
        const rect = existing;
        const b = getBoundingBox(rect);
        shapeBounds = b;
        fontSize = DEFAULT_TEXT_FONT_SIZE;
        value = rect.text ?? '';
        richHtml = textDocumentToHtml(rect.textDoc || textDocumentFromPlainText(value, rect.color));
        width = Math.max(20, b.width - TEXT_PAD_X * 2);
        align = rect.textAlign || 'left';
        verticalAlign = rect.textVerticalAlign === 'middle' ? 'middle' : 'top';
        fontFamily = normalizeFontFamily(rect.fontFamily);
        const layout = measureRichTextLayout(richHtml, value, fontSize, rect.color, width, getTextScale(rect), fontFamily);
        const innerHeight = Math.max(0, b.height - TEXT_PAD_Y * 2);
        const offset = verticalAlign === 'middle' ? Math.max(0, (innerHeight - layout.height) / 2) : 0;
        anchor = { x: b.x + TEXT_PAD_X, y: b.y + TEXT_PAD_Y + offset };
    }
    else if (existing && (existing.type === 'arrow' || existing.type === 'connector')) {
        const arrow = existing as ArrowElement, target = appState.editingArrowTextTarget ?? { kind: 'label' as ArrowTextTarget };
        dispatch({ type: 'SET_EDITOR', patch: { editingArrowTextTarget: target } });
        fontSize = arrowTextTargetFontSize(arrow, target);
        align = 'center';
        fontFamily = DEFAULT_FONT_FAMILY;
        width = 150;
        let layout: ArrowLabelLayout | null = null;
        if (target.kind === 'branch' && target.branchId) {
            const branch = getArrowBranches(arrow).find(b => b.id === target.branchId);
            if (branch) {
                value = branch.label || '';
                richHtml = textDocumentToHtml(branch.labelDoc || textDocumentFromPlainText(value, ARROW_LABEL_TEXT_COLOR));
                fontFamily = normalizeFontFamily(branch.labelFontFamily || DEFAULT_FONT_FAMILY);
                const normalizedPosition = clampArrowLabelPosition(branch.labelPosition);
                const normalizedSide = branch.labelSide === 1 ? 1 : -1;
                if (normalizedPosition !== branch.labelPosition || normalizedSide !== branch.labelSide) {
                    dispatch({ type: 'UPDATE_ELEMENT', id: arrow.id, update: element => {
                        if (element.type !== 'arrow' && element.type !== 'connector') return;
                        const targetBranch = getArrowBranches(element).find(b => b.id === branch.id);
                        if (targetBranch) { targetBranch.labelPosition = normalizedPosition; targetBranch.labelSide = normalizedSide; }
                    } });
                }
                const bpts = getArrowBranchRenderPoints(arrow, branch);
                layout = getBranchLabelLayout(branch, bpts, getArrowLabelCollisionBounds(arrow.id));
                if (!layout) {
                    const loc = arrowPathLocationAtPoints(bpts, normalizedPosition, false), h = fontSize * 1.25 + ARROW_LABEL_PAD_Y * 2, center = { x: loc.point.x + loc.normal.x * normalizedSide * (ARROW_LABEL_GAP + h / 2), y: loc.point.y + loc.normal.y * normalizedSide * (ARROW_LABEL_GAP + h / 2) };
                    anchor = { x: center.x - width / 2, y: center.y - h / 2 };
                }
            }
        }
        else if (target.kind === 'start' || target.kind === 'end') {
            const data = getEndpointLabelData(arrow, target.kind);
            value = data.text || '';
            richHtml = textDocumentToHtml(data.textDoc || textDocumentFromPlainText(value, ARROW_LABEL_TEXT_COLOR));
            fontFamily = normalizeFontFamily(target.kind === 'start' ? arrow.startLabelFontFamily || DEFAULT_FONT_FAMILY : arrow.endLabelFontFamily || DEFAULT_FONT_FAMILY);
            layout = getEndpointLabelLayout(arrow, target.kind);
            if (!layout) {
                const pts = getArrowRenderPoints(arrow), point = target.kind === 'start' ? pts[0] : pts[pts.length - 1], near = target.kind === 'start' ? pts[Math.min(3, pts.length - 1)] : pts[Math.max(0, pts.length - 4)], tan = target.kind === 'start' ? unitTangent(point, near) : unitTangent(near, point), normal = { x: -tan.y, y: tan.x }, outward = target.kind === 'start' ? { x: -tan.x, y: -tan.y } : tan, h = fontSize * 1.25 + ARROW_LABEL_PAD_Y * 2, center = { x: point.x + outward.x * (width / 2 + 8) + normal.x * (-1) * (h / 2 + 3), y: point.y + outward.y * (width / 2 + 8) + normal.y * (-1) * (h / 2 + 3) };
                anchor = { x: center.x - width / 2, y: center.y - h / 2 };
            }
        }
        else {
            value = arrow.label || '';
            richHtml = textDocumentToHtml(arrow.labelDoc || textDocumentFromPlainText(value, ARROW_LABEL_TEXT_COLOR));
            fontFamily = normalizeFontFamily(arrow.labelFontFamily || DEFAULT_FONT_FAMILY);
            const normalizedPosition = clampArrowLabelPosition(arrow.labelPosition);
            const normalizedSide = arrowLabelSide(arrow);
            if (normalizedPosition !== arrow.labelPosition || normalizedSide !== arrow.labelSide) {
                dispatch({ type: 'UPDATE_ELEMENT', id: arrow.id, update: element => {
                    if (element.type === 'arrow' || element.type === 'connector') { element.labelPosition = normalizedPosition; element.labelSide = normalizedSide; }
                } });
            }
            layout = getArrowLabelLayout(arrow, getArrowRenderPoints(arrow), getArrowLabelCollisionBounds(arrow.id));
            if (!layout) {
                const h = fontSize * 1.25 + ARROW_LABEL_PAD_Y * 2, loc = arrowPathLocationAtPoints(getArrowRenderPoints(arrow), normalizedPosition, false), side = normalizedSide, center = { x: loc.point.x + loc.normal.x * side * (ARROW_LABEL_GAP + h / 2), y: loc.point.y + loc.normal.y * side * (ARROW_LABEL_GAP + h / 2) };
                anchor = { x: center.x - width / 2, y: center.y - h / 2 };
            }
        }
        if (layout) {
            width = layout.textWidth + ARROW_LABEL_PAD_X * 2;
            anchor = { x: layout.textX - ARROW_LABEL_PAD_X, y: layout.box.y };
        }
    }
    const shell = document.createElement('div');
    dispatch({ type: 'SET_EDITOR', patch: { textEditor: shell } });
    shell.className = 'text-editor-shell';
    shell.dataset.anchorX = String(anchor.x);
    shell.dataset.anchorY = String(anchor.y);
    shell.dataset.kind = existing?.type || 'text';
    shell.dataset.width = String(width);
    shell.dataset.verticalAlign = verticalAlign;
    if (shapeBounds) {
        shell.dataset.shapeX = String(shapeBounds.x);
        shell.dataset.shapeY = String(shapeBounds.y);
        shell.dataset.shapeWidth = String(shapeBounds.width);
        shell.dataset.shapeHeight = String(shapeBounds.height);
    }
    shell.dataset.editingId = existingId || '';
    appDiv.appendChild(shell);
    buildRichToolbar(shell);
    const editor = document.createElement('div');
    dispatch({ type: 'SET_EDITOR', patch: { textEditorContent: editor } });
    editor.className = 'text-editor';
    if (existing?.type === 'note')
        editor.classList.add('note-editor');
    else if (existing?.type === 'rectangle')
        editor.classList.add('rectangle-editor');
    editor.contentEditable = 'true';
    const isArrowEditor = !!existing && (existing.type === 'arrow' || existing.type === 'connector');
    const renderScale = isArrowEditor ? fontSize / DEFAULT_TEXT_FONT_SIZE : getTextScale(existing as any || { textScale: 1 });
    editor.dataset.baseFontSize = String(isArrowEditor ? fontSize : DEFAULT_TEXT_FONT_SIZE);
    editor.dataset.fontFamily = fontFamily;
    editor.dataset.editingId = existingId || '';
    editor.dataset.renderScale = String(renderScale);
    editor.style.color = isArrowEditor ? ARROW_LABEL_TEXT_COLOR : (existing && 'color' in existing ? existing.color : '#111827');
    editor.style.fontFamily = fontStack(fontFamily);
    editor.style.fontSize = `${isArrowEditor ? fontSize : DEFAULT_TEXT_FONT_SIZE * renderScale}px`;
    if (isArrowEditor) editor.style.lineHeight = String(RICH_TEXT_LINE_HEIGHT);
    editor.style.textAlign = align;
    editor.dataset.textAlign = align;
    editor.style.transformOrigin = 'top left';
    editor.style.transform = `scale(${getEditorScreenScale()})`;
    editor.spellcheck = false;
    editor.innerHTML = richHtml || '<div><br></div>';
    shell.appendChild(editor);
    normalizeEditorFontTags();
    editor.addEventListener('input', () => { saveEditorSelection(); normalizeEditorFontTags(); normalizeDecorationTags(); if (appState.textEditorContent?.querySelector('ul,ol'))
        normalizeEditorListStructure(); syncLiveTextEditorSize(); syncArrowLabelEditorPosition(); syncShapeTextEditorPosition(); positionTextEditor(); redraw(); });
    document.addEventListener('selectionchange', handleEditorSelectionChange);
    document.addEventListener('pointerdown', onEditorOutsidePointerDown, true);
    document.addEventListener('keydown', onEditorDocumentKeyDown, true);
    window.addEventListener('keydown', onEditorWindowKeyDown, true);
    editor.addEventListener('pointerdown', beginEditorPointerSelection, true);
    window.addEventListener('pointerup', finishEditorPointerSelection, true);
    window.addEventListener('pointercancel', finishEditorPointerSelection, true);
    editor.addEventListener('keydown', e => {
        // Capture the canonical selection before the browser performs its native
        // copy. This gives paste a same-app fallback without replacing the native
        // OS clipboard write (which is more compatible across Chrome/WebView/OSes).
        const primaryModifier = (e.ctrlKey || e.metaKey) && !e.altKey;
        const lowerKey = e.key.toLowerCase();
        if (primaryModifier && lowerKey === 'c') {
            rememberEditorSelectionForClipboard(editor);
        }
        if (primaryModifier && lowerKey === 'v') {
            const sequenceBeforePaste = editorPasteSequence;
            // Native paste normally fires immediately after keydown. If the host
            // browser/webview suppresses that event, replay the in-memory payload
            // on the next task instead of silently doing nothing. Never suppress
            // the native shortcut, so external clipboard paste still works.
            setTimeout(() => {
                if (appState.textEditorContent !== editor || editorPasteSequence !== sequenceBeforePaste || !internalEditorClipboard) return;
                const data = new DataTransfer();
                data.setData('text/plain', internalEditorClipboard.plain);
                data.setData('text/html', internalEditorClipboard.html);
                editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
            }, 0);
        }
        // Escape is handled at document capture level so it remains reliable even
        // if rich paste temporarily moves focus or invalidates the live Range.
        // Tab / Shift+Tab operate on real LI nodes instead of inserting whitespace.
        // Moving the DOM nodes keeps UL/OL structure intact, so numbering is always
        // recalculated correctly at each level and survives edit -> canvas commit.
        if (e.key === 'Tab' && handleEditorListTab(e))
            return;
        // Let contenteditable handle Enter naturally: one Enter = one block line.
        // Shift+Enter keeps the native <br> soft break behavior.
    });
    editor.addEventListener('keyup', updateRichToolbar);
    editor.addEventListener('mouseup', updateRichToolbar);
    editor.addEventListener('focus', updateRichToolbar);
    editor.addEventListener('blur', () => setTimeout(updateRichToolbar, 0));
    window.addEventListener('resize', scheduleRichToolbarPosition);
    window.addEventListener('scroll', scheduleRichToolbarPosition, true);
    editor.addEventListener('copy', e => {
        const payload = rememberEditorSelectionForClipboard(editor);
        if (!payload || !e.clipboardData) return;
        // Own the OS clipboard write. If Chromium performs its default
        // contenteditable copy after this handler it can overwrite our clean HTML,
        // drop OL/UL ancestry for partial list selections, and add a white editor
        // background. Cancelling the default makes the canonical payload the one
        // and only clipboard representation.
        e.preventDefault();
        try {
            e.clipboardData.setData('text/plain', payload.plain);
            e.clipboardData.setData('text/html', payload.html);
            e.clipboardData.setData('application/x-my-board-rich-text', JSON.stringify({ version: 1, plain: payload.plain, html: payload.html, doc: payload.doc }));
        } catch { }
    });
    editor.addEventListener('paste', e => {
        editorPasteSequence += 1;
        e.preventDefault();
        let rawText = e.clipboardData?.getData('text/plain') || '';
        let rawHtml = e.clipboardData?.getData('text/html') || '';
        // A same-app custom MIME payload is useful in browsers that preserve it,
        // but the in-memory fallback below works even when the OS strips custom
        // clipboard formats entirely.
        let customDoc: TextDocument | undefined;
        try {
            const custom = e.clipboardData?.getData('application/x-my-board-rich-text') || '';
            if (custom) {
                const parsed = JSON.parse(custom);
                if (!rawText && typeof parsed?.plain === 'string') rawText = parsed.plain;
                if (!rawHtml && typeof parsed?.html === 'string') rawHtml = parsed.html;
                if (parsed?.doc && Array.isArray(parsed.doc.lines)) customDoc = normalizeTextDocument(parsed.doc, parsed.plain || '', editor.style.color || '#111827');
            }
        } catch { }
        const resolvedClipboard = resolvePasteClipboardPayload(rawText, rawHtml, customDoc);
        const text = resolvedClipboard.text;
        const html = resolvedClipboard.html;
        let safeHtml = html ? sanitizeRichText(html) : '';
        safeHtml = repairOrphanClipboardListHtml(safeHtml, text);
        const hasListStructure = /<(?:ul|ol|li)\b/i.test(safeHtml);
        const plainTextHasList = clipboardTextHasListMarkers(text);
        const hasRichStructure = /<(?:ul|ol|li|strong|b|em|i|u|s|del|strike|mark|span)\b/i.test(safeHtml);

        // Prefer the canonical same-app selection document. For external HTML,
        // parse the sanitized fragment and use text/plain only to trim phantom
        // boundary lines that were not actually part of the selected range.
        let pasteDoc: TextDocument | undefined = resolvedClipboard.doc ? normalizeTextDocument(resolvedClipboard.doc, text, editor.style.color || '#111827') : undefined;
        if (!pasteDoc && (hasRichStructure || hasListStructure)) {
            pasteDoc = textDocumentFromHtml(safeHtml, editor.style.color || '#111827');
            if (text) pasteDoc = trimClipboardDocumentBoundaries(pasteDoc, text);
        } else if (!pasteDoc && plainTextHasList) {
            pasteDoc = textDocumentFromClipboardText(text, editor.style.color || '#111827');
        }
        const normalizedHtml = pasteDoc ? textDocumentToHtml(pasteDoc) : safeHtml;
        const richPaste = !!pasteDoc || hasRichStructure || hasListStructure || plainTextHasList;

        // Paste must never depend on the delayed requestAnimationFrame caret that
        // opens existing objects. A fast Ctrl/Cmd+V immediately after clicking a
        // Note/Rectangle/Text can arrive before that frame. Establish a valid live
        // range first, while preserving an existing real selection when present.
        ensureEditorFocusAndCaret(editor);

        let inserted = false;
        if (richPaste) {
            // For an untouched editor, replace the browser's <div><br></div>
            // placeholder outright. This is both more reliable across browsers and
            // prevents an orphan BR from becoming a phantom blank line after lists.
            inserted = replaceEmptyEditorWithHtml(editor, normalizedHtml);
            if (!inserted) {
                selectEmptyCaretBlock(editor);
                inserted = insertHtmlAtSelection(editor, normalizedHtml, text);
            }
        } else {
            inserted = insertPlainTextAtSelection(editor, text);
        }

        // If a clipboard/paste event temporarily invalidated Selection, retry once
        // at the logical end instead of silently dropping the paste operation.
        if (!inserted) {
            placeEditorCaretAtEnd(editor);
            inserted = richPaste
                ? insertHtmlAtSelection(editor, normalizedHtml, text)
                : insertPlainTextAtSelection(editor, text);
        }
        if (!inserted && text) {
            // Last-resort data-preserving fallback. Plain text is preferable to a
            // no-op paste and will still reconstruct visible list markers.
            placeEditorCaretAtEnd(editor);
            insertPlainTextAtSelection(editor, text);
        }

        // Inserting a UL/OL DocumentFragment can cause Chromium to repair the DOM
        // and leave the native selection anchored to a detached node. Reassert a
        // valid caret/focus after normalization so Escape and subsequent editing
        // remain available immediately after rich-list paste.
        normalizeEditorListStructure();
        ensureEditorFocusAndCaret(editor);
        syncLiveTextEditorSize();
        syncArrowLabelEditorPosition();
        syncShapeTextEditorPosition();
        positionTextEditor();
        updateRichToolbar();
        redraw();
    });
    shell.addEventListener('focusout', onEditorBlur);
    syncLiveTextEditorSize();
    syncArrowLabelEditorPosition();
    syncShapeTextEditorPosition();
    positionTextEditor();
    // Position and size the editor before the first canvas redraw so the live
    // selection frame is never calculated from the temporary (0,0) DOM layout.
    redraw();
    editor.focus();
    // Existing Text / Note / Rectangle objects should always begin editing at
    // the logical end of their current content. Defer one frame so the native
    // click/double-click sequence that opened the editor cannot move the caret
    // back to the start after focus is applied.
    if (existingId) {
        requestAnimationFrame(() => {
            if (appState.textEditorContent === editor && appState.editingTextId === existingId) {
                placeEditorCaretAtEnd(editor);
                updateRichToolbar();
            }
        });
    }
    setLegacyStyleWithCss(true);
    updateRichToolbar();
}
