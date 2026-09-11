import { RichLine, RichRun, TextDocument } from './types';

export const TEXT_DOCUMENT_VERSION = 1 as const;
export const RICH_TEXT_LINE_HEIGHT = 1.35;
export const LIST_CONTENT_INDENT = 32;
export const CHECK_CONTENT_INDENT = 26;
export const LIST_MARKER_GAP = 6;
export const LIST_NUMBER_SCALE = 1.05;
export const LIST_BULLET_SCALE = 1.14;

export function richLineContentIndent(line: RichLine): number {
  if (line.listType === 'check') return CHECK_CONTENT_INDENT;
  if (line.listType === 'bullet' || line.listType === 'number') return LIST_CONTENT_INDENT * ((line.indent || 0) + 1);
  return 0;
}

export function richLineListMarker(line: RichLine): string {
  if (line.listType === 'bullet') return '•';
  if (line.listType === 'check') return line.checked ? '☑' : '☐';
  if (line.listType === 'number') {
    const path = line.numberPath?.filter(n => Number.isFinite(n) && n > 0);
    return `${path?.length ? path.join('.') : (line.listIndex || 1)}.`;
  }
  return '';
}

export function cloneRichLines(lines: RichLine[] = []): RichLine[] {
  return lines.map(line => ({
    listType: line.listType,
    listIndex: line.listIndex,
    numberPath: line.numberPath ? [...line.numberPath] : undefined,
    indent: line.indent,
    checked: line.checked,
    listContinuation: line.listContinuation,
    runs: line.runs.map(run => ({
      text: run.text,
      bold: run.bold,
      italic: run.italic,
      underline: run.underline,
      strike: run.strike,
      color: run.color,
      highlight: run.highlight,
    })),
  }));
}


export function normalizeStructuredListNumbering(lines: RichLine[]): RichLine[] {
  const out = cloneRichLines(lines);
  let counters: number[] = [];
  let previousNumberIndent = -1;
  let previousWasNumber = false;
  let previousPath: number[] | undefined;

  for (const line of out) {
    if (line.listType !== 'number') {
      counters = [];
      previousNumberIndent = -1;
      previousWasNumber = false;
      previousPath = undefined;
      continue;
    }

    const indent = Math.max(0, Math.floor(line.indent || 0));
    line.indent = indent || undefined;
    if (line.listContinuation && previousPath) {
      line.numberPath = [...previousPath];
      line.listIndex = previousPath[previousPath.length - 1] || 1;
      continue;
    }

    if (!previousWasNumber) {
      counters = Array.from({ length: indent + 1 }, () => 1);
    } else if (indent > previousNumberIndent) {
      while (counters.length < indent + 1) counters.push(1);
      counters[indent] = 1;
      counters.length = indent + 1;
    } else if (indent === previousNumberIndent) {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] || 0) + 1;
    } else {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] || 0) + 1;
    }

    line.listIndex = counters[indent] || 1;
    line.numberPath = counters.slice(0, indent + 1);
    previousNumberIndent = indent;
    previousWasNumber = true;
    previousPath = [...line.numberPath];
  }
  return out;
}

export function cloneTextDocument(doc: TextDocument | undefined): TextDocument | undefined {
  return doc ? { version: TEXT_DOCUMENT_VERSION, lines: cloneRichLines(doc.lines) } : undefined;
}

export function textDocumentFromLines(lines: RichLine[]): TextDocument {
  return { version: TEXT_DOCUMENT_VERSION, lines: normalizeStructuredListNumbering(lines) };
}

export function textDocumentFromPlainText(text: string, baseColor = '#111827'): TextDocument {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').map(value => ({ runs: [{ text: value, color: baseColor }] } as RichLine));
  return { version: TEXT_DOCUMENT_VERSION, lines: lines.length ? lines : [{ runs: [{ text: '', color: baseColor }] }] };
}

export function textDocumentPlainText(doc: TextDocument | undefined): string {
  if (!doc) return '';
  return doc.lines.map(line => line.runs.map(run => run.text).join('')).join('\n').replace(/\u00a0/g, ' ');
}

/**
 * Plain-text clipboard projection. Unlike the persisted convenience `text` field,
 * this keeps visible list markers so copying a formatted list into an app that
 * ignores text/html never turns the list into blank indentation.
 */
export function textDocumentClipboardText(doc: TextDocument | undefined): string {
  if (!doc) return '';
  const normalized = normalizeTextDocument(doc, '');
  return normalized.lines.map(line => {
    const text = line.runs.map(run => run.text).join('').replace(/\u00a0/g, ' ');
    const depth = Math.max(0, line.indent || 0);
    if (!line.listType) return text;
    if (line.listContinuation) return `${'  '.repeat(depth + 1)}${text}`;
    return `${'  '.repeat(depth)}${richLineListMarker(line)} ${text}`.trimEnd();
  }).join('\n');
}

/**
 * Parse clipboard plain text back into the canonical model when rich HTML is
 * unavailable or has lost its UL/OL wrapper. This is deliberately conservative:
 * only explicit bullet markers or numeric markers at the start of a line become
 * list metadata; ordinary text remains ordinary text.
 */
export function textDocumentFromClipboardText(text: string, baseColor = '#111827'): TextDocument {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const sourceLines = normalized.split('\n');
  const lines: RichLine[] = sourceLines.map(raw => {
    const number = raw.match(/^(\s*)((?:\d+\.)+)\s+(.*)$/);
    if (number) {
      const numberPath = number[2].split('.').filter(Boolean).map(value => Math.max(1, Number(value) || 1));
      const indentFromMarker = Math.max(0, numberPath.length - 1);
      const indentFromWhitespace = Math.max(0, Math.floor(number[1].replace(/\t/g, '  ').length / 2));
      const indent = Math.max(indentFromMarker, indentFromWhitespace);
      return {
        runs: [{ text: number[3], color: baseColor }],
        listType: 'number',
        listIndex: numberPath[numberPath.length - 1] || 1,
        numberPath,
        indent: indent || undefined,
      };
    }

    const bullet = raw.match(/^(\s*)[•●◦▪*-]\s+(.*)$/);
    if (bullet) {
      const indent = Math.max(0, Math.floor(bullet[1].replace(/\t/g, '  ').length / 2));
      return {
        runs: [{ text: bullet[2], color: baseColor }],
        listType: 'bullet',
        indent: indent || undefined,
      };
    }

    return { runs: [{ text: raw, color: baseColor }] };
  });
  return { version: TEXT_DOCUMENT_VERSION, lines: normalizeStructuredListNumbering(lines.length ? lines : [{ runs: [{ text: '', color: baseColor }] }]) };
}

export function clipboardTextHasListMarkers(text: string): boolean {
  return String(text ?? '').split(/\r?\n/).some(line => /^(?:\s*(?:[•●◦▪*-]|(?:\d+\.)+)\s+)/.test(line));
}

function sameRunStyle(a: RichRun | undefined, b: RichRun): boolean {
  if (!a) return false;
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.strike === !!b.strike && (a.color || '') === (b.color || '') && (a.highlight || '') === (b.highlight || '');
}

function normalizeRuns(runs: RichRun[], baseColor: string): RichRun[] {
  const out: RichRun[] = [];
  for (const raw of runs) {
    const run: RichRun = {
      text: String(raw.text ?? ''),
      bold: !!raw.bold || undefined,
      italic: !!raw.italic || undefined,
      underline: !!raw.underline || undefined,
      strike: !!raw.strike || undefined,
      color: raw.color || baseColor,
      highlight: raw.highlight || undefined,
    };
    if (sameRunStyle(out[out.length - 1], run)) out[out.length - 1].text += run.text;
    else out.push(run);
  }
  return out.length ? out : [{ text: '', color: baseColor }];
}

export function normalizeTextDocument(doc: TextDocument | undefined, plainText = '', baseColor = '#111827'): TextDocument {
  if (!doc || doc.version !== TEXT_DOCUMENT_VERSION || !Array.isArray(doc.lines)) return textDocumentFromPlainText(plainText, baseColor);
  const lines = doc.lines.map(line => ({
    runs: normalizeRuns(Array.isArray(line.runs) ? line.runs : [], baseColor),
    listType: line.listType === 'bullet' || line.listType === 'number' || line.listType === 'check' ? line.listType : undefined,
    listIndex: Number.isFinite(line.listIndex) ? Math.max(1, Math.floor(line.listIndex!)) : undefined,
    numberPath: Array.isArray(line.numberPath) ? line.numberPath.filter(n => Number.isFinite(n) && n > 0).map(n => Math.floor(n)) : undefined,
    indent: Number.isFinite(line.indent) ? Math.max(0, Math.floor(line.indent!)) : undefined,
    checked: line.listType === 'check' ? !!line.checked : undefined,
    listContinuation: !!line.listContinuation || undefined,
  }));
  const normalizedLines = lines.length ? normalizeStructuredListNumbering(lines) : textDocumentFromPlainText('', baseColor).lines;
  return { version: TEXT_DOCUMENT_VERSION, lines: normalizedLines };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runToHtml(run: RichRun): string {
  let body = escapeHtml(run.text).replace(/\n/g, '<br>') || '';
  if (run.bold) body = `<strong>${body}</strong>`;
  if (run.italic) body = `<em>${body}</em>`;
  if (run.underline || run.strike || run.color || run.highlight) {
    const styles: string[] = [];
    const decorations = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    if (decorations) styles.push(`text-decoration:${decorations}`);
    if (run.color) styles.push(`color:${run.color}`);
    if (run.highlight) styles.push(`background-color:${run.highlight}`);
    body = `<span${styles.length ? ` style="${styles.join(';')}"` : ''}>${body}</span>`;
  }
  return body;
}

function runsToHtml(runs: RichRun[]): string {
  // A visually empty canonical line must become a browser-native editable
  // placeholder. An empty styled <span> looks equivalent, but Chromium keeps
  // it as a separate empty block when the user starts typing/presses Enter,
  // which creates a phantom logical line on commit. Styling an empty run has no
  // visible meaning, so use <br> until the line contains actual text.
  if (!runs.some(run => run.text.length > 0)) return '<br>';
  const html = runs.map(runToHtml).join('');
  return html || '<br>';
}

/**
 * Converts the canonical model into a contenteditable representation.
 * This HTML is ephemeral UI state; it is never the persisted source of truth.
 */
export function textDocumentToHtml(doc: TextDocument | undefined): string {
  const normalized = normalizeTextDocument(doc, '');
  if (typeof document === 'undefined') {
    return normalized.lines.map(line => `<div>${runsToHtml(line.runs)}</div>`).join('');
  }

  const root = document.createElement('div');
  type ListFrame = { type: 'bullet' | 'number'; list: HTMLUListElement | HTMLOListElement; lastLi: HTMLLIElement | null };
  const stack: ListFrame[] = [];

  const closeTo = (depth: number) => { while (stack.length > depth) stack.pop(); };
  const hostForDepth = (depth: number): HTMLElement => {
    if (depth <= 0 || !stack.length) return root;
    return stack[Math.min(depth, stack.length) - 1].lastLi || stack[Math.min(depth, stack.length) - 1].list;
  };
  const ensureList = (type: 'bullet' | 'number', depth: number, line: RichLine): ListFrame => {
    closeTo(depth + 1);
    const existing = stack[depth];
    if (existing && existing.type === type) return existing;
    // Replace only this depth while preserving its parent list frame.
    stack.length = depth;
    const list = document.createElement(type === 'number' ? 'ol' : 'ul') as HTMLUListElement | HTMLOListElement;
    const parent = depth === 0 ? root : (stack[depth - 1]?.lastLi || stack[depth - 1]?.list || root);
    parent.appendChild(list);
    const frame: ListFrame = { type, list, lastLi: null };
    stack[depth] = frame;
    stack.length = depth + 1;
    return frame;
  };

  for (const line of normalized.lines) {
    if (line.listType === 'bullet' || line.listType === 'number') {
      const depth = Math.max(0, line.indent || 0);
      const frame = ensureList(line.listType, depth, line);
      if (line.listContinuation && frame.lastLi) {
        const div = document.createElement('div');
        div.innerHTML = runsToHtml(line.runs);
        frame.lastLi.appendChild(div);
        continue;
      }
      const li = document.createElement('li');
      li.innerHTML = runsToHtml(line.runs);
      frame.list.appendChild(li);
      frame.lastLi = li;
      closeTo(depth + 1);
      continue;
    }

    closeTo(0);
    const div = document.createElement('div');
    if (line.listType === 'check') {
      div.dataset.checklist = 'true';
      div.dataset.checked = String(!!line.checked);
    }
    div.innerHTML = runsToHtml(line.runs);
    root.appendChild(div);
  }
  return root.innerHTML || '<div><br></div>';
}

/** Parse the editor DOM into the canonical text document. */
export function textDocumentFromHtml(html: string | undefined, baseColor = '#111827'): TextDocument {
  if (typeof document === 'undefined') {
    // Node-side migrations should prefer stored structured lines. This fallback
    // intentionally preserves visible text instead of attempting browser DOM semantics.
    const plain = String(html || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(?:div|p|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
      .replace(/\n+$/g, '');
    return textDocumentFromPlainText(plain, baseColor);
  }

  const root = document.createElement('div');
  if (html) root.innerHTML = html;
  const lines: RichLine[] = [];
  const pushLine = (runs: RichRun[], meta?: Partial<RichLine>) => {
    lines.push({ runs: normalizeRuns(runs, baseColor), ...meta });
  };
  const mergeRun = (runs: RichRun[], text: string, style: any) => {
    if (!text) return;
    const run: RichRun = { text, bold: !!style.bold || undefined, italic: !!style.italic || undefined, underline: !!style.underline || undefined, strike: !!style.strike || undefined, color: style.color || baseColor, highlight: style.highlight || undefined };
    if (sameRunStyle(runs[runs.length - 1], run)) runs[runs.length - 1].text += text;
    else runs.push(run);
  };
  const styleFrom = (node: Element, parent: any): any => {
    const style: any = { ...parent };
    const css = (node as HTMLElement).style;
    if (css.fontWeight) style.bold = css.fontWeight === 'bold' || Number(css.fontWeight) >= 600;
    if (css.fontStyle) style.italic = css.fontStyle === 'italic';
    if (css.textDecoration) {
      style.underline = css.textDecoration.includes('underline');
      style.strike = css.textDecoration.includes('line-through');
    }
    if (css.color) style.color = css.color;
    if (css.backgroundColor) style.highlight = css.backgroundColor;
    return style;
  };
  const processInline = (node: Node, style: any, runs: RichRun[], onBreak: () => void) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent || '').split(/\r?\n/);
      parts.forEach((part, index) => { mergeRun(runs, part, style); if (index < parts.length - 1) onBreak(); });
      return;
    }
    const el = node as HTMLElement;
    if (el.tagName === 'BR') { onBreak(); return; }
    let next = styleFrom(el, style);
    if (['STRONG', 'B'].includes(el.tagName)) next = { ...next, bold: true };
    if (['EM', 'I'].includes(el.tagName)) next = { ...next, italic: true };
    if (el.tagName === 'U') next = { ...next, underline: true };
    if (['S', 'DEL', 'STRIKE'].includes(el.tagName)) next = { ...next, strike: true };
    if (el.tagName === 'MARK') next = { ...next, highlight: el.style.backgroundColor || '#fff59d' };
    el.childNodes.forEach(child => processInline(child, next, runs, onBreak));
  };
  const cleanCheck = (text: string) => text.replace(/^\s*[☐☑]\s?/, '');
  let processList: (list: HTMLElement, type: 'bullet' | 'number', indent: number, parentNumberPath?: number[]) => void;
  const processBlockNode = (node: HTMLElement, meta?: Partial<RichLine>) => {
    let runs: RichRun[] = [];
    let lastWasBreak = false;
    let emitted = 0;
    const flush = () => { pushLine(runs, { ...meta, listContinuation: emitted > 0 ? true : meta?.listContinuation }); runs = []; lastWasBreak = true; emitted++; };
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((child as HTMLElement).tagName)) {
        if (runs.length) flush();
        const list = child as HTMLElement;
        processList(list, list.tagName === 'OL' ? 'number' : 'bullet', meta?.listType ? (meta.indent || 0) + 1 : (meta?.indent || 0), meta?.numberPath || []);
        emitted++; lastWasBreak = true; return;
      }
      if (child.nodeType === Node.ELEMENT_NODE && ['DIV', 'P'].includes((child as HTMLElement).tagName)) {
        if (runs.length) flush();
        processBlockNode(child as HTMLElement, { ...meta, listContinuation: emitted > 0 || meta?.listContinuation });
        emitted++; lastWasBreak = true; return;
      }
      processInline(child, { color: baseColor }, runs, flush);
      if (runs.length) lastWasBreak = false;
    });
    if (node.dataset.checklist === 'true') {
      const plain = cleanCheck(node.textContent || '');
      const existingHighlight = runs.some(r => r.highlight);
      if (!existingHighlight && runs.length <= 1) {
        runs = [];
        if (plain) mergeRun(runs, plain, { color: baseColor });
      }
      if (runs.length || !lastWasBreak) flush();
      const first = Math.max(0, lines.length - Math.max(1, emitted));
      for (let i = first; i < lines.length; i++) {
        lines[i].listType = 'check';
        lines[i].checked = node.dataset.checked === 'true' || (node.textContent || '').trimStart().startsWith('☑');
        if (i > first) lines[i].listContinuation = true;
      }
      return;
    }
    if (runs.length || !lastWasBreak) flush();
  };
  processList = (list: HTMLElement, type: 'bullet' | 'number', indent: number, parentNumberPath: number[] = []) => {
    let index = type === 'number' ? (Number(list.getAttribute('start')) || 1) : 1;
    Array.from(list.children).forEach(child => {
      if ((child as HTMLElement).tagName !== 'LI') return;
      const li = child as HTMLElement;
      // Browser list editing often leaves stale LI[value] attributes when an
      // item is indented/outdented. CSS counters display the structural order,
      // so parse that same structural order instead of trusting stale values.
      const currentNumberPath = type === 'number' ? [...parentNumberPath, index] : [...parentNumberPath];
      let runs: RichRun[] = [];
      let lastWasBreak = false;
      let emitted = 0;
      const flush = () => { pushLine(runs, { listType: type, listIndex: index, numberPath: type === 'number' ? currentNumberPath : undefined, indent, listContinuation: emitted > 0 }); runs = []; lastWasBreak = true; emitted++; };
      li.childNodes.forEach(childNode => {
        if (childNode.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((childNode as HTMLElement).tagName)) return;
        if (childNode.nodeType === Node.ELEMENT_NODE && ['DIV', 'P'].includes((childNode as HTMLElement).tagName)) {
          if (runs.length) flush();
          const beforeCount = lines.length;
          processBlockNode(childNode as HTMLElement, { listType: type, listIndex: index, numberPath: type === 'number' ? currentNumberPath : undefined, indent, listContinuation: emitted > 0 });
          const produced = Math.max(0, lines.length - beforeCount);
          if (produced) {
            for (let i = beforeCount; i < lines.length; i++) {
              if (!lines[i].listType) {
                lines[i].listType = type; lines[i].listIndex = index; lines[i].numberPath = type === 'number' ? [...currentNumberPath] : undefined; lines[i].indent = indent;
              }
              if (i > beforeCount || emitted > 0) lines[i].listContinuation = true;
            }
            emitted += produced;
          }
          lastWasBreak = true; return;
        }
        processInline(childNode, { color: baseColor }, runs, flush);
        if (runs.length) lastWasBreak = false;
      });
      if (runs.length || !lastWasBreak) flush();
      const nestedLists = Array.from(li.children).filter(c => ['UL', 'OL'].includes((c as HTMLElement).tagName)) as HTMLElement[];
      for (const nested of nestedLists) processList(nested, nested.tagName === 'OL' ? 'number' : 'bullet', indent + 1, currentNumberPath);
      index++;
    });
  };
  Array.from(root.childNodes).forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'UL' || el.tagName === 'OL') processList(el, el.tagName === 'OL' ? 'number' : 'bullet', 0);
      else if (['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName)) processBlockNode(el);
      else {
        let runs: RichRun[] = []; let lastWasBreak = false;
        const flush = () => { pushLine(runs); runs = []; lastWasBreak = true; };
        processInline(el, { color: baseColor }, runs, flush);
        if (runs.length || !lastWasBreak) pushLine(runs);
      }
    } else if (node.textContent) {
      let runs: RichRun[] = []; let lastWasBreak = false;
      const flush = () => { pushLine(runs); runs = []; lastWasBreak = true; };
      processInline(node, { color: baseColor }, runs, flush);
      if (runs.length || !lastWasBreak) pushLine(runs);
    }
  });
  if (!lines.length) lines.push({ runs: [{ text: '', color: baseColor }] });
  return { version: TEXT_DOCUMENT_VERSION, lines: normalizeStructuredListNumbering(lines) };
}

/**
 * Migration bridge for v7 and older fields. Structured richLines wins, then
 * legacy editor HTML, then plain text. New v8 saves never emit legacy HTML.
 */
export function textDocumentFromLegacy(value: { text?: string; richText?: string; richLines?: RichLine[] }, baseColor = '#111827'): TextDocument {
  if (Array.isArray(value.richLines) && value.richLines.length) return normalizeTextDocument({ version: 1, lines: value.richLines }, value.text || '', baseColor);
  if (value.richText) return textDocumentFromHtml(value.richText, baseColor);
  return textDocumentFromPlainText(value.text || '', baseColor);
}

export function scaleRichLines(lines: RichLine[], _scale: number): RichLine[] {
  return cloneRichLines(lines);
}

export function canonicalLines(value: { textDoc?: TextDocument; text?: string; richLines?: RichLine[]; richText?: string; color?: string }, renderScale = 1): RichLine[] {
  const doc = value.textDoc
    ? normalizeTextDocument(value.textDoc, value.text || '', value.color || '#111827')
    : textDocumentFromLegacy({ text: value.text, richLines: value.richLines, richText: value.richText }, value.color || '#111827');
  return renderScale === 1 ? cloneRichLines(doc.lines) : scaleRichLines(doc.lines, renderScale);
}
