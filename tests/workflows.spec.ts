import { test, expect } from '@playwright/test';
import { createDefaultNote, openBoard, selectAllEditorText, snapshot } from './helpers';

test('Note → rich text → bound arrow → move → save → reload preserves geometry and text', async ({ page }) => {
  await openBoard(page);

  const note = await createDefaultNote(page, 260, 180);
  const editor = page.locator('.text-editor');
  await editor.pressSequentially('Customer insight');
  await selectAllEditorText(page);
  await page.locator('[data-cmd="bold"]').click();
  await editor.press('Escape');

  let state = await snapshot(page);
  let savedNote = state.elements.find((item: any) => item.id === note.id);
  expect(savedNote.text).toBe('Customer insight');
  expect(savedNote.textDoc.lines[0].runs[0].bold).toBe(true);

  // Start the connector from the note's right connection point.
  const startX = savedNote.x + savedNote.width;
  const startY = savedNote.y + savedNote.height / 2;
  await page.locator('#tool-arrow').click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 190, startY + 40, { steps: 6 });
  await page.mouse.up();

  state = await snapshot(page);
  const arrow = state.elements.find((item: any) => item.type === 'arrow' || item.type === 'connector');
  expect(arrow).toBeTruthy();
  expect(arrow.startBinding).toBe(note.id);
  const originalArrowStart = { ...arrow.start };
  const originalNotePosition = { x: savedNote.x, y: savedNote.y };

  // Move the note through the same pointer path users use.
  const moveFrom = { x: savedNote.x + 40, y: savedNote.y + 35 };
  const delta = { x: 70, y: 55 };
  await page.locator('#tool-select').click();
  await page.mouse.move(moveFrom.x, moveFrom.y);
  await page.mouse.down();
  await page.mouse.move(moveFrom.x + delta.x, moveFrom.y + delta.y, { steps: 6 });
  await page.mouse.up();

  state = await snapshot(page);
  savedNote = state.elements.find((item: any) => item.id === note.id);
  const movedArrow = state.elements.find((item: any) => item.id === arrow.id);
  expect(savedNote.x).toBeCloseTo(originalNotePosition.x + delta.x, 4);
  expect(savedNote.y).toBeCloseTo(originalNotePosition.y + delta.y, 4);
  expect(movedArrow.start.x).toBeCloseTo(originalArrowStart.x + delta.x, 4);
  expect(movedArrow.start.y).toBeCloseTo(originalArrowStart.y + delta.y, 4);

  await page.locator('#project-menu-trigger').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#project-save').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  // First prove normal reload/recovery keeps the board.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__MY_BOARD_TEST__?.ready()));
  state = await snapshot(page);
  let reloadedNote = state.elements.find((item: any) => item.id === note.id);
  let reloadedArrow = state.elements.find((item: any) => item.id === arrow.id);
  expect(reloadedNote.text).toBe('Customer insight');
  expect(reloadedNote.textDoc.lines[0].runs[0].bold).toBe(true);
  expect(reloadedNote.x).toBeCloseTo(savedNote.x, 4);
  expect(reloadedNote.y).toBeCloseTo(savedNote.y, 4);
  expect(reloadedArrow.startBinding).toBe(note.id);
  expect(reloadedArrow.start.x).toBeCloseTo(movedArrow.start.x, 4);
  expect(reloadedArrow.start.y).toBeCloseTo(movedArrow.start.y, 4);

  // Then explicitly reopen the downloaded project archive and assert again.
  await page.locator('#project-input').setInputFiles(downloadPath!);
  await page.waitForFunction(id => window.__MY_BOARD_TEST__?.snapshot().elements.some((el: any) => el.id === id), note.id);
  state = await snapshot(page);
  reloadedNote = state.elements.find((item: any) => item.id === note.id);
  reloadedArrow = state.elements.find((item: any) => item.id === arrow.id);
  expect(reloadedNote.text).toBe('Customer insight');
  expect(reloadedNote.textDoc.lines[0].runs[0].bold).toBe(true);
  expect(reloadedNote.x).toBeCloseTo(savedNote.x, 4);
  expect(reloadedNote.y).toBeCloseTo(savedNote.y, 4);
  expect(reloadedArrow.startBinding).toBe(note.id);
  expect(reloadedArrow.start.x).toBeCloseTo(movedArrow.start.x, 4);
  expect(reloadedArrow.start.y).toBeCloseTo(movedArrow.start.y, 4);
});

test('File menu uses Ctrl+N and unsaved New uses the Rimmap dialog', async ({ page }) => {
  await openBoard(page);

  await page.locator('#project-menu-trigger').click();
  await expect(page.locator('[data-shortcut-display="newProject"]')).toHaveText('Ctrl+N');
  await expect(page.locator('#project-status')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await createDefaultNote(page, 240, 180);
  await page.locator('.text-editor').pressSequentially('Keep this');
  await page.locator('.text-editor').press('Escape');

  await page.locator('#project-menu-trigger').click();
  await page.locator('#project-new').click();
  const dialog = page.locator('.rimmap-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.rimmap-dialog-title')).toHaveText('Create a new board?');
  await expect(dialog).toContainText('unsaved changes');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await snapshot(page)).elements.length).toBeGreaterThan(0);

  await page.locator('#project-menu-trigger').click();
  await page.locator('#project-new').click();
  await page.locator('.rimmap-dialog').getByRole('button', { name: 'Discard & create' }).click();
  await expect.poll(async () => (await snapshot(page)).elements.length).toBe(0);
});

test('File menu exposes Save As and keeps project name above the Rimmap mark', async ({ page }) => {
  await openBoard(page);
  await page.locator('#project-menu-trigger').click();

  await expect(page.locator('[data-shortcut-display="saveProjectAs"]')).toHaveText('Ctrl+Shift+S');
  const order = await page.locator('.project-menu-meta').evaluate(meta => Array.from(meta.children).map(child => child.className));
  expect(order[0]).toContain('project-name-wrap');
  expect(order[1]).toContain('project-brand');

  const nameStyle = await page.locator('#project-name').evaluate(el => {
    const style = getComputedStyle(el);
    return { textAlign: style.textAlign, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap };
  });
  expect(nameStyle.textAlign).toBe('center');
  expect(nameStyle.whiteSpace).toBe('normal');
  expect(nameStyle.overflowWrap).toBe('anywhere');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#project-save-as').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.board\.zip$/);
});

test('media can be dropped on the board and pasted from the image clipboard', async ({ page }) => {
  await openBoard(page);

  // Keep a stale internal object clipboard on purpose: a real image clipboard
  // payload must win instead of unexpectedly duplicating the old board object.
  await createDefaultNote(page, 220, 180);
  await page.locator('.text-editor').pressSequentially('Clipboard sentinel');
  await page.locator('.text-editor').press('Escape');
  await page.evaluate(() => window.__MY_BOARD_TEST__!.copySelection());

  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwS4WQAAAABJRU5ErkJggg==';
  await page.locator('#canvas').evaluate((canvas, base64) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const file = new File([bytes], 'dropped.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    canvas.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: 420,
      clientY: 280,
      dataTransfer: transfer,
    }));
  }, pngBase64);

  await expect.poll(async () => (await snapshot(page)).elements.filter((item: any) => item.type === 'media').length).toBe(1);
  let state = await snapshot(page);
  const dropped = state.elements.find((item: any) => item.type === 'media');
  expect(dropped.name).toBe('dropped.png');

  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const file = new File([bytes], 'clipboard.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    window.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
  }, pngBase64);

  await expect.poll(async () => (await snapshot(page)).elements.filter((item: any) => item.type === 'media').length).toBe(2);
  state = await snapshot(page);
  expect(state.elements.some((item: any) => item.type === 'media' && item.name === 'clipboard.png')).toBe(true);
  expect(state.elements.filter((item: any) => item.type === 'note').length).toBe(1);
});
