import { test, expect } from '@playwright/test';
import { createDefaultNote, openBoard, placeCaretInListItem, selectAllEditorText, selectEditorTextDirection, snapshot } from './helpers';

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('new empty Note opens a visible editable surface', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  const box = await editor.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(20);

  const state = await snapshot(page);
  expect(state.elements.some((item: any) => item.id === note.id)).toBe(true);
  await editor.press('Escape');
});

test('Enter creates one canonical logical line per line break', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('Alpha');
  await editor.press('Enter');
  await editor.pressSequentially('Beta');
  await editor.press('Escape');

  const state = await snapshot(page);
  const saved = state.elements.find((item: any) => item.id === note.id);
  expect(saved.text).toBe('Alpha\nBeta');
  expect(saved.textDoc.lines).toHaveLength(2);
  expect(saved.textDoc.lines.map((line: any) => line.runs.map((run: any) => run.text).join(''))).toEqual(['Alpha', 'Beta']);
});

test('long words wrap instead of overflowing the available canvas width', async ({ page }) => {
  const lines = [{ runs: [{ text: 'supercalifragilisticexpialidocioussupercalifragilisticexpialidocious', color: '#111827' }] }];
  const layout = await page.evaluate(({ lines }) => window.__MY_BOARD_TEST__!.measureLines(lines, 90), { lines });
  expect(layout.lines.length).toBeGreaterThan(1);
  expect(layout.width).toBeLessThanOrEqual(90.5);
  expect(layout.lines.every((line: any) => line.runs.map((run: any) => run.text).join('').length > 0)).toBe(true);
});

test('numbered lists survive editor commit as structured list metadata', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('One');
  await editor.press('Enter');
  await editor.pressSequentially('Two');
  await selectAllEditorText(page);
  await page.locator('#rich-number').click();
  await editor.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === note.id);
  expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['number', 'number']);
  expect(saved.textDoc.lines.map((line: any) => line.listIndex)).toEqual([1, 2]);
  expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [2]]);
});

test('bullet lists survive editor commit as structured list metadata', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('Alpha');
  await editor.press('Enter');
  await editor.pressSequentially('Beta');
  await selectAllEditorText(page);
  await page.locator('#rich-bullet').click();
  await editor.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === note.id);
  expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['bullet', 'bullet']);
});

test('nested lists preserve indent and numbering paths', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('Parent');
  await editor.press('Enter');
  await editor.pressSequentially('Child');
  await editor.press('Enter');
  await editor.pressSequentially('Sibling');
  await selectAllEditorText(page);
  await page.locator('#rich-number').click();
  await placeCaretInListItem(page, 1);
  await editor.press('Tab');
  await editor.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === note.id);
  expect(saved.textDoc.lines[0].numberPath).toEqual([1]);
  expect(saved.textDoc.lines[1].indent).toBe(1);
  expect(saved.textDoc.lines[1].numberPath).toEqual([1, 1]);
});

test('Tab indents and Shift+Tab outdents the active list item', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('One');
  await editor.press('Enter');
  await editor.pressSequentially('Two');
  await selectAllEditorText(page);
  await page.locator('#rich-bullet').click();
  await placeCaretInListItem(page, 1);
  await editor.press('Tab');
  expect(await editor.locator('ul ul li').count()).toBe(1);
  await editor.press('Shift+Tab');
  // Chromium may wrap a root UL/OL in a DIV when execCommand creates the list.
  // The editor DOM is only an editing projection, so assert semantic nesting
  // rather than requiring the browser list container to be a direct child.
  expect(await editor.locator('ul ul li, ol ol li, ul ol li, ol ul li').count()).toBe(0);
  expect(await editor.locator('li').count()).toBe(2);
  await editor.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === note.id);
  expect(saved.textDoc.lines.map((line: any) => line.indent || 0)).toEqual([0, 0]);
});

test('forward and backward selections produce the same stable toolbar anchor', async ({ page }) => {
  await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('First line');
  await editor.press('Enter');
  await editor.pressSequentially('Second line');

  await selectEditorTextDirection(page, false);
  await expect(page.locator('.rich-toolbar')).toHaveClass(/visible/);
  const forward = await page.locator('.rich-toolbar').evaluate(el => ({ left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top }));

  await selectEditorTextDirection(page, true);
  await expect(page.locator('.rich-toolbar')).toHaveClass(/visible/);
  const backward = await page.locator('.rich-toolbar').evaluate(el => ({ left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top }));

  expect(Math.abs(forward.left - backward.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(forward.top - backward.top)).toBeLessThanOrEqual(1);
});

test('toolbar positioning stays inside the viewport and avoids the selected text', async ({ page }) => {
  const id = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 12, y: 10, width: 240, height: 100, text: 'Near the top edge\nSecond line' }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), id);
  await expect(page.locator('.text-editor')).toBeVisible();
  await selectEditorTextDirection(page, false);

  const geometry = await page.locator('.rich-toolbar').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(7);
  expect(geometry.top).toBeGreaterThanOrEqual(7);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width - 7);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height - 7);
});

test('Esc commits the current editor contents and exits editing', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('Committed with Escape');
  await editor.press('Escape');

  await expect(page.locator('.text-editor')).toHaveCount(0);
  const state = await snapshot(page);
  const saved = state.elements.find((item: any) => item.id === note.id);
  expect(saved.text).toBe('Committed with Escape');
  expect(state.activeTool).toBe('select');
});

test('save/open preserves structured formatting', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('Bold item');
  await selectAllEditorText(page);
  await page.locator('[data-cmd="bold"]').click();
  await page.locator('#rich-bullet').click();
  await editor.press('Escape');

  await page.locator('#project-menu-trigger').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#project-save').click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();

  await page.locator('#project-input').setInputFiles(path!);
  await page.waitForFunction(id => {
    const item = window.__MY_BOARD_TEST__?.snapshot().elements.find((el: any) => el.id === id) as any;
    return item?.textDoc?.lines?.[0]?.runs?.[0]?.bold === true && item?.textDoc?.lines?.[0]?.listType === 'bullet';
  }, note.id);

  const reopened = (await snapshot(page)).elements.find((item: any) => item.id === note.id);
  expect(reopened.textDoc.lines[0].runs[0].bold).toBe(true);
  expect(reopened.textDoc.lines[0].listType).toBe('bullet');
});

test('Rectangle list nesting uses the same structural numbering as Note/Text', async ({ page }) => {
  const id = await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ x: 220, y: 150, width: 320, height: 220 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), id);
  const editor = page.locator('.text-editor');
  await expect(editor).toBeVisible();
  await editor.pressSequentially('One');
  await editor.press('Enter');
  await editor.pressSequentially('Two');
  await editor.press('Enter');
  await editor.pressSequentially('Three');
  await selectAllEditorText(page);
  await page.locator('#rich-number').click();
  await placeCaretInListItem(page, 1);
  await editor.press('Tab');
  await editor.press('Escape');

  let saved = (await snapshot(page)).elements.find((item: any) => item.id === id);
  expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [1, 1], [2]]);

  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), id);
  await placeCaretInListItem(page, 1);
  await page.locator('.text-editor').press('Shift+Tab');
  await page.locator('.text-editor').press('Escape');
  saved = (await snapshot(page)).elements.find((item: any) => item.id === id);
  expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [2], [3]]);
});

test('Note and Rectangle editors respect padded shape text bounds and center positioning', async ({ page }) => {
  const id = await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ x: 180, y: 140, width: 260, height: 160, text: 'Centered' }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), id);
  const editorBox = await page.locator('.text-editor').boundingBox();
  expect(editorBox).not.toBeNull();
  expect(editorBox!.x).toBeGreaterThanOrEqual(188);
  expect(editorBox!.y).toBeGreaterThanOrEqual(146);
  await page.locator('.text-editor').press('Escape');

  await page.locator('#tool-select').click();
  await page.mouse.click(240, 200);
  await page.locator('[data-shape-text-position="center"]').click();
  const saved = (await snapshot(page)).elements.find((item: any) => item.id === id);
  expect(saved.textAlign).toBe('center');
  expect(saved.textVerticalAlign).toBe('middle');
});

test('copy/paste preserves formatted list text and structure for text-bearing objects', async ({ page }) => {
  const factories = ['addNote', 'addRectangle', 'addText'] as const;
  for (const factory of factories) {
    const id = await page.evaluate(factory => (window.__MY_BOARD_TEST__ as any)[factory]({ x: 190, y: 150, width: 300, height: 180 }), factory);
    await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), id);
    const editor = page.locator('.text-editor');
    await editor.pressSequentially('Alpha');
    await editor.press('Enter');
    await editor.pressSequentially('Beta');
    await selectAllEditorText(page);
    await page.locator('#rich-bullet').click();
    await selectAllEditorText(page);

    const clipboard = await editor.evaluate(el => {
      const data = new DataTransfer();
      const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
      el.dispatchEvent(event);
      return { plain: data.getData('text/plain'), html: data.getData('text/html') };
    });
    expect(clipboard.plain).toContain('• Alpha');
    expect(clipboard.plain).toContain('• Beta');
    expect(clipboard.html).toMatch(/<ul>[\s\S]*<li>[\s\S]*Alpha[\s\S]*<\/li>/i);
    expect(clipboard.html).toContain('Beta');

    await editor.evaluate((el, payload) => {
      el.innerHTML = '<div><br></div>';
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const data = new DataTransfer();
      data.setData('text/plain', payload.plain);
      data.setData('text/html', payload.html);
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
      el.dispatchEvent(event);
    }, clipboard);
    await editor.press('Escape');

    const saved = (await snapshot(page)).elements.find((item: any) => item.id === id);
    expect(saved.textDoc.lines.map((line: any) => line.runs.map((run: any) => run.text).join(''))).toEqual(['Alpha', 'Beta']);
    expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['bullet', 'bullet']);
  }
});


test('pasted bulleted/numbered lists can exit edit mode with Esc or an outside click', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const noteId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 220, y: 170, width: 320, height: 220 }));

  const pasteWithSystemClipboard = async (html: string, plain: string) => {
    await page.evaluate(async ({ html, plain }) => {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    }, { html, plain });
    const editor = page.locator('.text-editor');
    await editor.focus();
    await page.keyboard.press('Control+V');
    await expect(editor.locator('li')).toHaveCount(2);
  };

  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), noteId);
  await pasteWithSystemClipboard('<ul><li>Alpha</li><li>Beta</li></ul>', '• Alpha\n• Beta');
  await page.keyboard.press('Escape');
  await expect(page.locator('.text-editor')).toHaveCount(0);

  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), noteId);
  const editor = page.locator('.text-editor');
  await editor.evaluate(el => { el.innerHTML = '<div><br></div>'; });
  await pasteWithSystemClipboard('<ol><li>First</li><li>Second</li></ol>', '1. First\n2. Second');
  await page.mouse.click(48, 48);
  await expect(page.locator('.text-editor')).toHaveCount(0);

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === noteId);
  expect(saved.textDoc.lines.map((line: any) => line.runs.map((run: any) => run.text).join(''))).toEqual(['First', 'Second']);
  expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['number', 'number']);
});


test('copying a list from one board object and pasting it into another never traps text edit mode', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const sourceId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 150, y: 140, width: 300, height: 220 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), sourceId);
  let editor = page.locator('.text-editor');
  await editor.pressSequentially('Source one');
  await editor.press('Enter');
  await editor.pressSequentially('Source two');
  await selectAllEditorText(page);
  await page.locator('#rich-number').click();
  await selectAllEditorText(page);
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);

  const targetId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 560, y: 140, width: 300, height: 220 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), targetId);
  editor = page.locator('.text-editor');
  await editor.focus();
  await page.keyboard.press('Control+V');
  await expect(editor.locator('li')).toHaveCount(2);

  // The pasted editor must remain physically bounded by its Note so it cannot
  // create a transparent hit area over the canvas.
  const editorBox = await editor.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(editorBox!.height).toBeLessThanOrEqual(220);

  // Window-level Escape is the non-negotiable escape hatch after rich paste.
  await page.keyboard.press('Escape');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  expect((await snapshot(page)).activeTool).toBe('select');

  // Repeat with an outside click; the next canvas interaction must also work.
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), targetId);
  editor = page.locator('.text-editor');
  await selectAllEditorText(page);
  await page.keyboard.press('Control+V');
  await expect(editor.locator('li')).toHaveCount(2);
  await page.mouse.click(40, 40);
  await expect(page.locator('.text-editor')).toHaveCount(0);
  await page.locator('#tool-select').click();
  expect((await snapshot(page)).activeTool).toBe('select');
});

test('copying only selected list items preserves the OL/UL container on paste', async ({ page }) => {
  const sourceId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 120, y: 120, width: 320, height: 240 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), sourceId);
  let editor = page.locator('.text-editor');
  await editor.pressSequentially('Ignore this line');
  await editor.press('Enter');
  await editor.pressSequentially('First');
  await editor.press('Enter');
  await editor.pressSequentially('Second');
  await editor.press('Enter');
  await editor.pressSequentially('Third');

  // Turn only the last three logical lines into a numbered list, leaving plain
  // text above it. This reproduces the real-world case where the user drags
  // across list items instead of selecting the entire editor.
  await editor.evaluate(el => {
    const blocks = Array.from(el.children) as HTMLElement[];
    const range = document.createRange();
    range.setStartBefore(blocks[1]);
    range.setEndAfter(blocks[3]);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('#rich-number').click();

  const clipboard = await editor.evaluate(el => {
    const items = Array.from(el.querySelectorAll('li'));
    const firstText = items[0].firstChild!;
    const lastText = items[items.length - 1].firstChild!;
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(lastText, (lastText.textContent || '').length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return { plain: data.getData('text/plain'), html: data.getData('text/html') };
  });
  expect(clipboard.plain).toContain('1. First');
  expect(clipboard.plain).toContain('3. Third');
  expect(clipboard.html).toMatch(/<ol>[\s\S]*<li>[\s\S]*First/i);

  await editor.press('Escape');
  const targetId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 520, y: 120, width: 320, height: 240 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), targetId);
  editor = page.locator('.text-editor');
  await editor.evaluate((el, payload) => {
    const data = new DataTransfer();
    data.setData('text/plain', payload.plain);
    data.setData('text/html', payload.html);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, clipboard);
  await expect(editor.locator('ol > li')).toHaveCount(3);
  await editor.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === targetId);
  expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['number', 'number', 'number']);
  expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [2], [3]]);
  expect(saved.textDoc.lines.map((line: any) => line.runs.map((run: any) => run.text).join(''))).toEqual(['First', 'Second', 'Third']);
});

test('numbered-list clipboard preserves visible numbering and structured HTML', async ({ page }) => {
  const note = await createDefaultNote(page);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('First');
  await editor.press('Enter');
  await editor.pressSequentially('Second');
  await selectAllEditorText(page);
  await page.locator('#rich-number').click();
  await selectAllEditorText(page);

  const clipboard = await editor.evaluate(el => {
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
    el.dispatchEvent(event);
    return { plain: data.getData('text/plain'), html: data.getData('text/html') };
  });
  expect(clipboard.plain).toContain('1. First');
  expect(clipboard.plain).toContain('2. Second');
  expect(clipboard.html).toMatch(/<ol>[\s\S]*<li>[\s\S]*First[\s\S]*<\/li>/i);
  expect(clipboard.html).toContain('Second');

  await editor.press('Escape');
  const saved = (await snapshot(page)).elements.find((item: any) => item.id === note.id);
  expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [2]]);
});


test('untouched empty Note reopens on the first logical line', async ({ page }) => {
  const noteId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 210, y: 150, width: 260, height: 220 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), noteId);
  let editor = page.locator('.text-editor');
  await expect(editor).toBeVisible();
  await editor.press('Escape');

  let saved = (await snapshot(page)).elements.find((item: any) => item.id === noteId);
  expect(saved.text).toBe('');

  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), noteId);
  editor = page.locator('.text-editor');
  await expect(editor).toBeVisible();
  expect(await editor.evaluate(el => el.innerHTML)).toBe('<div><br></div>');
  const caret = await editor.evaluate(el => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    return {
      inside: !!range && el.contains(range.commonAncestorContainer),
      topBlocks: el.children.length,
    };
  });
  expect(caret.inside).toBe(true);
  expect(caret.topBlocks).toBe(1);
  await editor.press('Escape');
});

test('numbered list paste works immediately in Note, Rectangle, and Text without waiting for a deferred caret', async ({ page }) => {
  const payload = {
    plain: '1. One\n2. Two\n3. Three',
    html: '<ol><li>One</li><li>Two</li><li>Three</li></ol>',
  };
  const targets = [
    ['addNote', { x: 120, y: 120, width: 260, height: 220 }],
    ['addRectangle', { x: 450, y: 120, width: 280, height: 220, fillColor: '#ffffff' }],
    ['addText', { x: 820, y: 160 }],
  ] as const;

  for (const [factory, args] of targets) {
    const id = await page.evaluate(([factory, args]) => (window.__MY_BOARD_TEST__ as any)[factory](args), [factory, args]);
    await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), id);
    const editor = page.locator('.text-editor');
    // Deliberately dispatch paste immediately. The product must establish a valid
    // caret itself instead of depending on the next requestAnimationFrame.
    await editor.evaluate((el, payload) => {
      const data = new DataTransfer();
      data.setData('text/plain', payload.plain);
      data.setData('text/html', payload.html);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, payload);
    await expect(editor.locator('ol > li')).toHaveCount(3);
    await editor.press('Escape');

    const saved = (await snapshot(page)).elements.find((item: any) => item.id === id);
    expect(saved.text).toBe('One\nTwo\nThree');
    expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['number', 'number', 'number']);
    expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [2], [3]]);
  }
});



test('same-app list paste survives a clipboard that drops HTML and visible list markers', async ({ page }) => {
  const sourceId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 130, y: 120, width: 300, height: 220 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), sourceId);
  let editor = page.locator('.text-editor');
  await editor.pressSequentially('First');
  await editor.press('Enter');
  await editor.pressSequentially('Second');
  await editor.press('Enter');
  await editor.pressSequentially('Third');
  await selectAllEditorText(page);
  await page.locator('#rich-number').click();
  await selectAllEditorText(page);

  // Populate the editor's canonical in-memory clipboard, but simulate a host
  // environment that exposes only markerless text/plain on paste.
  await editor.evaluate(el => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await editor.press('Escape');

  const targetId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 520, y: 120, width: 300, height: 220 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), targetId);
  editor = page.locator('.text-editor');
  await editor.evaluate(el => {
    const data = new DataTransfer();
    data.setData('text/plain', 'First\nSecond\nThird');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(editor.locator('ol > li')).toHaveCount(3);
  await editor.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === targetId);
  expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['number', 'number', 'number']);
  expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [2], [3]]);
});

test('same-app Ctrl+V fallback works when the host suppresses the native paste event', async ({ page }) => {
  const sourceId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 130, y: 120, width: 300, height: 220 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), sourceId);
  let editor = page.locator('.text-editor');
  await editor.pressSequentially('Alpha');
  await editor.press('Enter');
  await editor.pressSequentially('Beta');
  await selectAllEditorText(page);
  await page.locator('#rich-bullet').click();
  await selectAllEditorText(page);
  await editor.evaluate(el => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await editor.press('Escape');

  const targetId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ x: 520, y: 120, width: 320, height: 220, fillColor: '#ffffff' }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), targetId);
  editor = page.locator('.text-editor');

  // dispatchEvent has no browser default action, so no native paste event will
  // follow this keydown. The editor fallback must replay the internal payload.
  await editor.evaluate(el => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(30);
  await expect(editor.locator('ul > li')).toHaveCount(2);
  await editor.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === targetId);
  expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['bullet', 'bullet']);
});


test('real Ctrl+C/Ctrl+V preserves list structure and does not paste editor-surface background', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const sourceId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 110, y: 110, width: 320, height: 260 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), sourceId);
  let editor = page.locator('.text-editor');
  await editor.pressSequentially('some text is not important');
  await editor.press('Enter');
  await editor.pressSequentially('some text is not important');
  await editor.press('Enter');
  await editor.pressSequentially('the number 1');
  await editor.press('Enter');
  await editor.pressSequentially('the number 2');
  await editor.press('Enter');
  await editor.pressSequentially('the number 3');

  // Number only the final three logical blocks.
  await editor.evaluate(el => {
    const blocks = Array.from(el.children) as HTMLElement[];
    const range = document.createRange();
    range.setStartBefore(blocks[2]);
    range.setEndAfter(blocks[4]);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('#rich-number').click();

  // Select only the list content, reproducing the user's copy workflow.
  await editor.evaluate(el => {
    const items = Array.from(el.querySelectorAll('li'));
    const range = document.createRange();
    range.setStart(items[0].firstChild!, 0);
    const last = items[items.length - 1].firstChild!;
    range.setEnd(last, (last.textContent || '').length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Escape');

  const targetId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 520, y: 110, width: 320, height: 260 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), targetId);
  editor = page.locator('.text-editor');
  await editor.focus();
  await page.keyboard.press('Control+V');
  await expect(editor.locator('ol > li')).toHaveCount(3);
  // Native contenteditable copy used to leak a white background into colored Notes.
  await expect(editor.locator('[style*="background-color: rgb(255, 255, 255)"], [style*="background-color:#fff"], [style*="background-color: white"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const saved = (await snapshot(page)).elements.find((item: any) => item.id === targetId);
  expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['number', 'number', 'number']);
  expect(saved.textDoc.lines.map((line: any) => line.numberPath)).toEqual([[1], [2], [3]]);
  expect(saved.textDoc.lines.map((line: any) => line.runs.map((run: any) => run.text).join(''))).toEqual(['the number 1', 'the number 2', 'the number 3']);
  expect(saved.textDoc.lines.some((line: any) => line.runs.some((run: any) => /(?:white|255\s*,\s*255\s*,\s*255|#fff)/i.test(run.highlight || '')))).toBe(false);
});

test('Properties omits arrow opacity and renders explicit Dots/Double SVG icons', async ({ page }) => {
  await page.locator('#tool-arrow').click();
  await page.mouse.move(240, 220);
  await page.mouse.down();
  await page.mouse.move(420, 220);
  await page.mouse.up();
  await page.locator('#tool-select').click();
  await page.mouse.click(330, 220);

  await expect(page.locator('#arrow-style-panel')).toBeVisible();
  await expect(page.locator('#arrow-style-panel')).not.toContainText(/opacity/i);
  await expect(page.locator('[data-selected-arrow-style="dots"] svg circle')).toHaveCount(2);
  await expect(page.locator('[data-selected-arrow-style="double"] svg path')).toHaveCount(1);
});

test('clipboard respects the exact selected range without phantom boundary lines', async ({ page }) => {
  const sourceId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 120, y: 120, width: 320, height: 240 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), sourceId);
  let editor = page.locator('.text-editor');
  await editor.evaluate(el => {
    el.innerHTML = '<div><br></div><div><strong>Alpha</strong></div><div>Beta</div><div><br></div>';
    const blocks = Array.from(el.children) as HTMLElement[];
    const first = blocks[1].querySelector('strong')!.firstChild!;
    const last = blocks[2].firstChild!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, (last.textContent || '').length);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  const clipboard = await editor.evaluate(el => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return { plain: data.getData('text/plain'), html: data.getData('text/html'), custom: data.getData('application/x-my-board-rich-text') };
  });
  expect(clipboard.plain).toBe('Alpha\nBeta');
  expect(clipboard.html).not.toMatch(/^\s*<div><br><\/div>/i);
  expect(clipboard.html).not.toMatch(/<div><br><\/div>\s*$/i);

  await editor.press('Escape');
  const targetId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ x: 520, y: 120, width: 320, height: 240, fillColor: '#fff' }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), targetId);
  editor = page.locator('.text-editor');
  await editor.evaluate((el, payload) => {
    const data = new DataTransfer();
    data.setData('text/plain', payload.plain);
    data.setData('text/html', payload.html);
    if (payload.custom) data.setData('application/x-my-board-rich-text', payload.custom);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, clipboard);
  await editor.press('Escape');
  const saved = (await snapshot(page)).elements.find((item: any) => item.id === targetId);
  expect(saved.text).toBe('Alpha\nBeta');
  expect(saved.textDoc.lines).toHaveLength(2);
  expect(saved.textDoc.lines[0].runs.some((run: any) => run.bold)).toBe(true);
});

test('list clipboard survives wrapped HTML and pastes across Text, Rectangle, and Note', async ({ page }) => {
  const targets = [
    ['addText', { x: 120, y: 120 }],
    ['addRectangle', { x: 420, y: 120, width: 300, height: 220, fillColor: '#fff' }],
    ['addNote', { x: 760, y: 120, width: 300, height: 220 }],
  ] as const;
  const payload = {
    plain: '1. First\n  1.1. Nested\n2. Second',
    html: '<html><body><section style="background-color:white"><ol><li><strong>First</strong><ol><li><em>Nested</em></li></ol></li><li>Second</li></ol></section></body></html>',
  };
  for (const [factory, args] of targets) {
    const id = await page.evaluate(([factory, args]) => (window.__MY_BOARD_TEST__ as any)[factory](args), [factory, args]);
    await page.evaluate(id => window.__MY_BOARD_TEST__!.editElement(id), id);
    const editor = page.locator('.text-editor');
    await editor.evaluate((el, payload) => {
      const data = new DataTransfer();
      data.setData('text/plain', payload.plain);
      data.setData('text/html', payload.html);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, payload);
    await expect(editor.locator('ol li')).toHaveCount(3);
    await editor.press('Escape');
    const saved = (await snapshot(page)).elements.find((item: any) => item.id === id);
    expect(saved.textDoc.lines.map((line: any) => line.listType)).toEqual(['number', 'number', 'number']);
    expect(saved.textDoc.lines.map((line: any) => line.indent || 0)).toEqual([0, 1, 0]);
    expect(saved.textDoc.lines.map((line: any) => line.runs.map((run: any) => run.text).join(''))).toEqual(['First', 'Nested', 'Second']);
    expect(saved.textDoc.lines[0].runs[0].bold).toBe(true);
    expect(saved.textDoc.lines[1].runs[0].italic).toBe(true);
  }
});
