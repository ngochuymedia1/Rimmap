import { expect, Page } from '@playwright/test';

export async function openBoard(page: Page) {
  await page.goto('/?test=1');
  await page.waitForFunction(() => Boolean(window.__MY_BOARD_TEST__?.ready()));
  await expect(page.locator('#canvas')).toBeVisible();
}

export async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() => window.__MY_BOARD_TEST__!.snapshot());
}

export async function createDefaultNote(page: Page, x = 260, y = 180) {
  await page.locator('#tool-note').click();
  await page.mouse.click(x, y);
  await expect(page.locator('.text-editor')).toBeVisible();
  const state = await snapshot(page);
  const note = state.elements.find((item: any) => item.type === 'note');
  expect(note).toBeTruthy();
  return note;
}

export async function selectAllEditorText(page: Page) {
  const editor = page.locator('.text-editor');
  await editor.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
}

export async function placeCaretInListItem(page: Page, index: number, atEnd = true) {
  await page.locator('.text-editor').evaluate((editor, args) => {
    const items = Array.from(editor.querySelectorAll('li'));
    const li = items[args.index] as HTMLElement | undefined;
    if (!li) throw new Error(`Missing list item ${args.index}`);
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode() || li.appendChild(document.createTextNode(''));
    const range = document.createRange();
    const offset = args.atEnd ? (text.textContent || '').length : 0;
    range.setStart(text, offset);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    (editor as HTMLElement).focus();
    document.dispatchEvent(new Event('selectionchange'));
  }, { index, atEnd });
}

export async function selectEditorTextDirection(page: Page, backward: boolean) {
  await page.locator('.text-editor').evaluate((editor, isBackward) => {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) if (node.textContent) textNodes.push(node as Text);
    if (textNodes.length < 2) throw new Error('Need at least two text nodes for direction test');
    const first = textNodes[0];
    const last = textNodes[textNodes.length - 1];
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    if (isBackward) selection.setBaseAndExtent(last, last.data.length, first, 0);
    else selection.setBaseAndExtent(first, 0, last, last.data.length);
    (editor as HTMLElement).dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
  }, backward);
  await page.waitForTimeout(50);
}
