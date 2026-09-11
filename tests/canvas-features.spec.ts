import { expect, test } from '@playwright/test';
import { openBoard, snapshot } from './helpers';

test.describe('high-DPI canvas', () => {
  test.use({ deviceScaleFactor: 2 });

  test('backing resolution follows DPR but stays capped at 2x', async ({ page }) => {
    await openBoard(page);
    const metrics = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      ratio: Number(canvas.dataset.pixelRatio || 1),
    }));
    expect(metrics.ratio).toBe(2);
    expect(metrics.width).toBe(Math.round(metrics.clientWidth * 2));
    expect(metrics.height).toBe(Math.round(metrics.clientHeight * 2));
  });
});

test('Arrow keys nudge by 1 unit and Shift+Arrow by 10', async ({ page }) => {
  await openBoard(page);
  const id = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 120, y: 120, width: 100, height: 80 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.select([id]), id);

  await page.keyboard.press('ArrowRight');
  let state = await snapshot(page);
  let note = state.elements.find((element: any) => element.id === id);
  expect(note.x).toBe(121);

  await page.keyboard.press('Shift+ArrowDown');
  state = await snapshot(page);
  note = state.elements.find((element: any) => element.id === id);
  expect(note.y).toBe(130);
});

test('move snapping gently snaps edges without visual guides', async ({ page }) => {
  await openBoard(page);
  const moving = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 100, y: 100, width: 100, height: 80 }));
  await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 300, y: 100, width: 100, height: 80 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.select([id]), moving);

  await page.mouse.move(150, 140);
  await page.mouse.down();
  await page.mouse.move(248, 140);
  const during = await snapshot(page);
  expect(during.activeMoveDelta.x).toBe(100);
  await page.mouse.up();

  const state = await snapshot(page);
  const note = state.elements.find((element: any) => element.id === moving);
  expect(note.x).toBe(200);
});

test('resize snapping aligns the active edge without drawing guides', async ({ page }) => {
  await openBoard(page);
  const resizing = await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 100, y: 100, width: 100, height: 80 }));
  await page.evaluate(() => window.__MY_BOARD_TEST__!.addNote({ x: 350, y: 100, width: 100, height: 80 }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.select([id]), resizing);

  await page.mouse.move(200, 180);
  await page.mouse.down();
  await page.mouse.move(348, 180);
  await page.mouse.up();

  const state = await snapshot(page);
  const note = state.elements.find((element: any) => element.id === resizing);
  expect(note.x + note.width).toBeCloseTo(350, 5);
});

test('Align submenu distributes centers and equal spacing', async ({ page }) => {
  await openBoard(page);
  const ids = await page.evaluate(() => [
    window.__MY_BOARD_TEST__!.addRectangle({ x: 100, y: 120, width: 50, height: 50 }),
    window.__MY_BOARD_TEST__!.addRectangle({ x: 230, y: 120, width: 80, height: 50 }),
    window.__MY_BOARD_TEST__!.addRectangle({ x: 500, y: 120, width: 50, height: 50 }),
  ]);
  await page.evaluate(ids => window.__MY_BOARD_TEST__!.select(ids), ids);

  await page.mouse.click(120, 140, { button: 'right' });
  await page.locator('#context-align-trigger').hover();
  await page.locator('[data-action="space-h"]').click();

  const state = await snapshot(page);
  const boxes = ids.map(id => state.elements.find((element: any) => element.id === id)).sort((a: any, b: any) => a.x - b.x);
  const gap1 = boxes[1].x - (boxes[0].x + boxes[0].width);
  const gap2 = boxes[2].x - (boxes[1].x + boxes[1].width);
  expect(gap1).toBeCloseTo(gap2, 5);
});

test('Layers visibility is independent from lock and hidden objects stay out of canvas selection/export', async ({ page }) => {
  await openBoard(page);
  const ids = await page.evaluate(() => [
    window.__MY_BOARD_TEST__!.addNote({ x: 120, y: 120, width: 120, height: 80, name: 'Visible note' }),
    window.__MY_BOARD_TEST__!.addNote({ x: 420, y: 120, width: 120, height: 80, name: 'Hide me' }),
  ]);
  const [visibleId, hiddenId] = ids;
  const originalOrder = (await snapshot(page)).elements.map((element: any) => element.id);
  await page.evaluate(id => window.__MY_BOARD_TEST__!.select([id]), hiddenId);

  const hiddenRow = page.locator(`.all-layer-row[data-layer-id="${hiddenId}"]`);
  await expect(hiddenRow).toBeVisible();
  await hiddenRow.locator('.all-layer-visibility').click();

  let state = await snapshot(page);
  let hidden = state.elements.find((element: any) => element.id === hiddenId);
  expect(hidden.hidden).toBe(true);
  expect(state.selectedIds).not.toContain(hiddenId);
  expect(state.elements.map((element: any) => element.id)).toEqual(originalOrder);
  await expect(hiddenRow).toHaveClass(/hidden/);

  const exportIds = await page.evaluate(() => window.__MY_BOARD_TEST__!.exportElementIds());
  expect(exportIds).toContain(visibleId);
  expect(exportIds).not.toContain(hiddenId);

  await page.mouse.click(480, 160);
  state = await snapshot(page);
  expect(state.selectedIds).not.toContain(hiddenId);

  await hiddenRow.locator('.all-layer-lock').click();
  state = await snapshot(page);
  hidden = state.elements.find((element: any) => element.id === hiddenId);
  expect(hidden.hidden).toBe(true);
  expect(hidden.locked).toBe(true);

  await hiddenRow.locator('.all-layer-visibility').click();
  state = await snapshot(page);
  hidden = state.elements.find((element: any) => element.id === hiddenId);
  expect(hidden.hidden).toBe(false);
  expect(hidden.locked).toBe(true);
  const exportIdsAfterShow = await page.evaluate(() => window.__MY_BOARD_TEST__!.exportElementIds());
  expect(exportIdsAfterShow).toContain(hiddenId);
});

test('Layers search appears only on large boards and filters by type or layer name', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => {
    for (let i = 1; i <= 19; i += 1) {
      window.__MY_BOARD_TEST__!.addNote({ x: 80 + i, y: 100 + i, name: `Customer note ${i}` });
    }
  });

  const search = page.locator('#all-layers-search');
  await expect(search).toBeHidden();

  await page.evaluate(() => {
    window.__MY_BOARD_TEST__!.addNote({ x: 520, y: 320, name: 'Launch Reference' });
  });
  await expect(search).toBeVisible();

  await page.locator('#tool-arrow').click();
  await page.mouse.move(300, 500);
  await page.mouse.down();
  await page.mouse.move(450, 550, { steps: 4 });
  await page.mouse.up();

  const input = page.locator('#all-layers-search-input');
  await input.fill('note');
  await expect(page.locator('.all-layer-row')).toHaveCount(20);

  await input.fill('arrow');
  await expect(page.locator('.all-layer-row')).toHaveCount(1);
  await expect(page.locator('.all-layer-row .all-layer-type')).toHaveText('Arrow');
  await expect(page.locator('.all-layer-reorder-handle')).toBeDisabled();

  await input.fill('launch reference');
  await expect(page.locator('.all-layer-row')).toHaveCount(1);
  await expect(page.locator('.all-layer-row .all-layer-name')).toHaveValue('Launch Reference');

  await input.fill('does-not-exist');
  await expect(page.locator('.all-layers-empty')).toHaveText('No matching layers');
});


test('real Layer groups render as a nested tree and can be drilled into from Layers', async ({ page }) => {
  await openBoard(page);
  const ids = await page.evaluate(() => [
    window.__MY_BOARD_TEST__!.addRectangle({ id: 'group-a', x: 100, y: 100, name: 'Alpha' }),
    window.__MY_BOARD_TEST__!.addRectangle({ id: 'outside', x: 300, y: 100, name: 'Outside' }),
    window.__MY_BOARD_TEST__!.addRectangle({ id: 'group-b', x: 500, y: 100, name: 'Beta' }),
    window.__MY_BOARD_TEST__!.addRectangle({ id: 'group-c', x: 700, y: 100, name: 'Gamma' }),
  ]);
  const [a, _outside, b, c] = ids;

  await page.evaluate(({ a, b }) => {
    window.__MY_BOARD_TEST__!.select([a, b]);
    window.__MY_BOARD_TEST__!.groupSelection({ id: 'g1', name: 'Inner Group' });
  }, { a, b });
  await page.evaluate(({ a, b, c }) => {
    window.__MY_BOARD_TEST__!.select([a, b, c]);
    window.__MY_BOARD_TEST__!.groupSelection({ id: 'g2', name: 'Outer Group' });
  }, { a, b, c });

  let state = await snapshot(page);
  expect(state.elements.map((element: any) => element.id)).toEqual(['group-a', 'outside', 'group-b', 'group-c']);
  expect(state.layerGroups.find((group: any) => group.id === 'g1').parentGroupId).toBe('g2');
  expect(state.elements.find((element: any) => element.id === c).parentGroupId).toBe('g2');

  const outer = page.locator('.all-layer-row.group[data-group-id="g2"]');
  const inner = page.locator('.all-layer-row.group[data-group-id="g1"]');
  const leafA = page.locator(`.all-layer-row.element[data-layer-id="${a}"]`);
  await expect(outer).toBeVisible();
  await expect(inner).toBeVisible();
  await expect(leafA).toBeVisible();

  await outer.locator('.all-layer-group-toggle').click();
  await expect(outer).toBeVisible();
  await expect(inner).toBeHidden();
  await expect(leafA).toBeHidden();
  await expect(page.locator('.all-layer-row.element[data-layer-id="outside"]')).toBeVisible();

  await outer.locator('.all-layer-group-toggle').click();
  await expect(inner).toBeVisible();
  await leafA.locator('.all-layer-main').click();
  state = await snapshot(page);
  expect(state.selectedIds).toEqual([a]);
  expect(state.selectedLayerGroupId).toBeNull();

  await inner.locator('.all-layer-main').click();
  state = await snapshot(page);
  expect(new Set(state.selectedIds)).toEqual(new Set([a, b]));
  expect(state.selectedLayerGroupId).toBe('g1');

  await inner.locator('.all-layer-visibility').click();
  state = await snapshot(page);
  expect(state.elements.find((element: any) => element.id === a).hidden).toBe(true);
  expect(state.elements.find((element: any) => element.id === b).hidden).toBe(true);
  expect(state.elements.find((element: any) => element.id === c).hidden).not.toBe(true);

  await inner.locator('.all-layer-name').dblclick();
  await inner.locator('.all-layer-name').fill('Renamed Inner');
  await inner.locator('.all-layer-name').press('Enter');
  await expect(inner.locator('.all-layer-name')).toHaveValue('Renamed Inner');
});

test('nested Layer-group hierarchy survives duplicate, clipboard paste, undo, and redo', async ({ page }) => {
  await openBoard(page);
  const [a, b, c] = await page.evaluate(() => [
    window.__MY_BOARD_TEST__!.addRectangle({ id: 'clone-a', x: 100, y: 260, name: 'Clone A' }),
    window.__MY_BOARD_TEST__!.addRectangle({ id: 'clone-b', x: 320, y: 260, name: 'Clone B' }),
    window.__MY_BOARD_TEST__!.addRectangle({ id: 'clone-c', x: 540, y: 260, name: 'Clone C' }),
  ]);

  await page.evaluate(({ a, b }) => {
    window.__MY_BOARD_TEST__!.select([a, b]);
    window.__MY_BOARD_TEST__!.groupSelection({ id: 'clone-inner', name: 'Clone Inner' });
  }, { a, b });
  await page.evaluate(({ a, b, c }) => {
    window.__MY_BOARD_TEST__!.select([a, b, c]);
    window.__MY_BOARD_TEST__!.groupSelection({ id: 'clone-outer', name: 'Clone Outer' });
  }, { a, b, c });

  // Hide one child, then explicitly select the real group node. Structural
  // duplicate/copy/delete must still include the hidden child.
  await page.locator(`.all-layer-row.element[data-layer-id="${a}"] .all-layer-visibility`).click();
  await page.locator('.all-layer-row.group[data-group-id="clone-outer"] .all-layer-main').click();

  await page.keyboard.press('Control+D');
  let state = await snapshot(page);
  expect(state.elements).toHaveLength(6);
  expect(state.layerGroups).toHaveLength(4);
  const duplicated = state.elements.slice(-3);
  expect(duplicated.filter((element: any) => element.hidden)).toHaveLength(1);
  const duplicatedOuterId = duplicated.find((element: any) => element.parentGroupId &&
    state.layerGroups.some((group: any) => group.id === element.parentGroupId && !group.parentGroupId))?.parentGroupId;
  expect(duplicatedOuterId).toBeTruthy();
  const duplicatedInner = state.layerGroups.find((group: any) => group.parentGroupId === duplicatedOuterId);
  expect(duplicatedInner).toBeTruthy();
  expect(duplicated.filter((element: any) => element.parentGroupId === duplicatedInner.id)).toHaveLength(2);
  expect(duplicated.filter((element: any) => element.parentGroupId === duplicatedOuterId)).toHaveLength(1);

  // Select the duplicated group as a structural node before copying it. The
  // hidden clone is not in selectedIds, but copySelection must still include it.
  await page.evaluate(({ ids, groupId }) => {
    const visibleIds = ids.filter((id: string) => {
      const element = window.__MY_BOARD_TEST__!.snapshot().elements.find((item: any) => item.id === id);
      return element && !element.hidden && !element.locked;
    });
    window.__MY_BOARD_TEST__!.select(visibleIds, groupId);
  }, { ids: duplicated.map((element: any) => element.id), groupId: duplicatedOuterId });
  await page.evaluate(async () => {
    await window.__MY_BOARD_TEST__!.copySelection();
    window.__MY_BOARD_TEST__!.pasteSelection();
  });
  state = await snapshot(page);
  expect(state.elements).toHaveLength(9);
  expect(state.layerGroups).toHaveLength(6);
  const pasted = state.elements.slice(-3);
  expect(pasted.filter((element: any) => element.hidden)).toHaveLength(1);
  expect(state.selectedIds).toEqual(pasted.filter((element: any) => !element.hidden && !element.locked).map((element: any) => element.id));
  const pastedParentIds = new Set(pasted.map((element: any) => element.parentGroupId).filter(Boolean));
  expect(pastedParentIds.size).toBe(2);
  const pastedGroups = state.layerGroups.filter((group: any) => pastedParentIds.has(group.id));
  const pastedOuter = pastedGroups.find((group: any) => !group.parentGroupId);
  const pastedInner = pastedGroups.find((group: any) => group.parentGroupId === pastedOuter?.id);
  expect(pastedOuter).toBeTruthy();
  expect(pastedInner).toBeTruthy();

  await page.locator('#btn-undo').click();
  state = await snapshot(page);
  expect(state.elements).toHaveLength(6);
  expect(state.layerGroups).toHaveLength(4);

  await page.locator('#btn-redo').click();
  state = await snapshot(page);
  expect(state.elements).toHaveLength(9);
  expect(state.layerGroups).toHaveLength(6);

  // Exact group deletion is structural too: it removes hidden descendants and
  // the now-empty cloned group nodes in one Undo/Redo transaction.
  const pastedIds = pasted.map((element: any) => element.id);
  await page.evaluate(({ ids, groupId }) => {
    const snapshot = window.__MY_BOARD_TEST__!.snapshot();
    const visibleIds = ids.filter((id: string) => {
      const element = snapshot.elements.find((item: any) => item.id === id);
      return element && !element.hidden && !element.locked;
    });
    window.__MY_BOARD_TEST__!.select(visibleIds, groupId);
  }, { ids: pastedIds, groupId: pastedOuter.id });
  await page.keyboard.press('Delete');
  state = await snapshot(page);
  expect(state.elements).toHaveLength(6);
  expect(state.layerGroups).toHaveLength(4);
  expect(state.elements.some((element: any) => pastedIds.includes(element.id))).toBe(false);

  await page.locator('#btn-undo').click();
  state = await snapshot(page);
  expect(state.elements).toHaveLength(9);
  expect(state.layerGroups).toHaveLength(6);
});

test('automatic connector routing is optional and routes around a rectangle', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ id: 'route-obstacle', x: 300, y: 150, width: 180, height: 100, name: 'Route obstacle' }));
  const arrowId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addArrow({ id: 'auto-arrow', start: { x: 120, y: 200 }, control: { x: 370, y: 200 }, controls: [{ x: 370, y: 200 }], end: { x: 660, y: 200 }, curveMode: 'sharp', routingMode: 'manual' }));
  await page.mouse.click(180, 200);
  await expect(page.locator('#arrow-style-panel')).toBeVisible();
  await page.locator('[data-arrow-routing-mode="auto"]').click();
  const result = await page.evaluate(id => ({
    state: window.__MY_BOARD_TEST__!.snapshot().elements.find((item: any) => item.id === id),
    first: window.__MY_BOARD_TEST__!.arrowRenderPoints(id),
    second: window.__MY_BOARD_TEST__!.arrowRenderPoints(id),
  }), arrowId);
  expect(result.state.routingMode).toBe('auto');
  expect(result.first.length).toBeGreaterThan(2);
  expect(result.first).toEqual(result.second);
  for (let i = 0; i < result.first.length - 1; i++) {
    const a = result.first[i], b = result.first[i + 1];
    const horizontal = Math.abs(a.y - b.y) < 0.001;
    const vertical = Math.abs(a.x - b.x) < 0.001;
    expect(horizontal || vertical).toBe(true);
  }
});

test('arrow label collision avoidance is deterministic around a rectangle', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ id: 'label-obstacle', x: 300, y: 168, width: 160, height: 42, name: 'Label obstacle' }));
  const arrowId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addArrow({ id: 'label-arrow', start: { x: 120, y: 220 }, control: { x: 380, y: 220 }, controls: [{ x: 380, y: 220 }], end: { x: 680, y: 220 }, curveMode: 'sharp', label: 'Collision label', labelPosition: .5, labelSide: -1 }));
  const boxes = await page.evaluate(id => [window.__MY_BOARD_TEST__!.arrowLabelBox(id), window.__MY_BOARD_TEST__!.arrowLabelBox(id)], arrowId);
  expect(boxes[0]).toEqual(boxes[1]);
  expect(boxes[0]).not.toBeNull();
  const obstacle = { x: 300, y: 168, width: 160, height: 42 };
  const box = boxes[0]!;
  const overlaps = box.x < obstacle.x + obstacle.width && box.x + box.width > obstacle.x && box.y < obstacle.y + obstacle.height && box.y + box.height > obstacle.y;
  expect(overlaps).toBe(false);
});

test('double-click adds an arrow waypoint and Alt-click removes it', async ({ page }) => {
  await openBoard(page);
  const arrowId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addArrow({ id: 'waypoint-arrow', start: { x: 120, y: 320 }, control: { x: 370, y: 320 }, controls: [{ x: 370, y: 320 }], end: { x: 660, y: 320 }, curveMode: 'sharp' }));
  await page.mouse.dblclick(245, 320);
  let arrow = (await snapshot(page)).elements.find((item: any) => item.id === arrowId);
  expect(arrow.controls).toHaveLength(2);
  const inserted = arrow.controls.find((point: any) => Math.abs(point.x - 245) < 4);
  expect(inserted).toBeTruthy();
  await page.mouse.click(inserted.x, inserted.y, { modifiers: ['Alt'] });
  arrow = (await snapshot(page)).elements.find((item: any) => item.id === arrowId);
  expect(arrow.controls).toHaveLength(1);
  expect(arrow.controls[0].x).toBeCloseTo(370, 3);
});


test('arrow trunk label uses the shared S M L XL XXL text-size presets', async ({ page }) => {
  await openBoard(page);
  const arrowId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addArrow({
    id: 'sized-label-arrow',
    start: { x: 120, y: 500 },
    control: { x: 390, y: 500 },
    controls: [{ x: 390, y: 500 }],
    end: { x: 700, y: 500 },
    curveMode: 'sharp',
    label: 'Sized arrow label',
    labelPosition: .5,
    labelSide: -1,
  }));

  await page.mouse.click(180, 500);
  await expect(page.locator('#arrow-style-panel')).toBeVisible();
  await expect(page.locator('[data-arrow-label-size]')).toHaveText(['S', 'M', 'L', 'XL', 'XXL']);

  await page.locator('[data-arrow-label-size="L"]').click();
  let state = await snapshot(page);
  expect(state.elements.find((item: any) => item.id === arrowId).labelFontSize).toBe(24);
  await expect(page.locator('[data-arrow-label-size="L"]')).toHaveClass(/active/);
  const largeBox = await page.evaluate(id => window.__MY_BOARD_TEST__!.arrowLabelBox(id), arrowId);

  await page.locator('[data-arrow-label-size="S"]').click();
  state = await snapshot(page);
  expect(state.elements.find((item: any) => item.id === arrowId).labelFontSize).toBe(16);
  const smallBox = await page.evaluate(id => window.__MY_BOARD_TEST__!.arrowLabelBox(id), arrowId);
  expect(largeBox!.height).toBeGreaterThan(smallBox!.height);

  await page.locator('[data-arrow-label-size="XXL"]').click();
  await page.mouse.dblclick(260, 500, { modifiers: ['Shift'] });
  await expect(page.locator('.text-editor')).toBeVisible();
  await expect(page.locator('.text-editor')).toHaveCSS('font-size', '34px');
  await page.keyboard.press('Escape');
  state = await snapshot(page);
  expect(state.elements.find((item: any) => item.id === arrowId).labelFontSize).toBe(34);
});

test('arrow label edit mode matches view layout and width scales with connector length', async ({ page }) => {
  await openBoard(page);
  const label = "I don't know why it's too short like this";
  const ids = await page.evaluate(text => {
    const api = window.__MY_BOARD_TEST__!;
    const shortId = api.addArrow({
      id: 'label-width-short',
      start: { x: 120, y: 220 },
      control: { x: 270, y: 220 },
      controls: [{ x: 270, y: 220 }],
      end: { x: 420, y: 220 },
      curveMode: 'sharp',
      label: text,
      labelFontSize: 34,
      labelPosition: .5,
      labelSide: -1,
    });
    const longId = api.addArrow({
      id: 'label-width-long',
      start: { x: 120, y: 440 },
      control: { x: 620, y: 440 },
      controls: [{ x: 620, y: 440 }],
      end: { x: 1120, y: 440 },
      curveMode: 'sharp',
      label: text,
      labelFontSize: 34,
      labelPosition: .5,
      labelSide: -1,
    });
    return { shortId, longId };
  }, label);

  const layouts = await page.evaluate(({ shortId, longId }) => ({
    short: window.__MY_BOARD_TEST__!.arrowLabelLayout(shortId),
    long: window.__MY_BOARD_TEST__!.arrowLabelLayout(longId),
  }), ids);
  expect(layouts.short).toBeTruthy();
  expect(layouts.long).toBeTruthy();
  expect(layouts.long!.textWidth).toBeGreaterThan(layouts.short!.textWidth);
  expect(layouts.long!.textWidth).toBeLessThanOrEqual(360);

  await page.evaluate(id => window.__MY_BOARD_TEST__!.editArrowLabel(id), ids.longId);
  const editor = page.locator('.text-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('font-size', '34px');
  const live = await editor.evaluate(el => {
    const node = el as HTMLElement;
    const style = getComputedStyle(node);
    return {
      width: parseFloat(node.style.width),
      height: parseFloat(node.style.height),
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    };
  });
  expect(live.width).toBeCloseTo(layouts.long!.textWidth + 10, 2);
  expect(live.height).toBeCloseTo(layouts.long!.textHeight + 6, 2);
  expect(live.fontSize).toBeCloseTo(34, 2);
  expect(live.lineHeight).toBeCloseTo(34 * 1.35, 1);
  expect(live.scrollHeight).toBeLessThanOrEqual(live.clientHeight + 2);

  await page.keyboard.press('Escape');
  const after = await page.evaluate(id => window.__MY_BOARD_TEST__!.arrowLabelLayout(id), ids.longId);
  expect(after!.textWidth).toBeCloseTo(layouts.long!.textWidth, 5);
  expect(after!.textHeight).toBeCloseTo(layouts.long!.textHeight, 5);
});

test('large boards use spatial candidates and reuse text layout measurements', async ({ page }) => {
  await openBoard(page);
  const result = await page.evaluate(() => {
    const api = window.__MY_BOARD_TEST__!;
    api.addRectangleGrid(240);
    api.resetPerformanceCaches();
    const candidates = api.sceneCandidateIds({ x: -10, y: -10, width: 140, height: 120 });
    const scene = api.performanceStats().scene;

    // Position/camera changes are intentionally absent from the layout key: two
    // identical measurements should reuse the same expensive canvas metrics.
    const lines = [{ runs: [{ text: 'Cached rich text measurement', bold: true }] }];
    api.measureLines(lines, 220, 20);
    api.measureLines(lines, 220, 20);
    const textLayout = api.performanceStats().textLayout;
    return { candidates, scene, textLayout };
  });

  expect(result.scene.enabled).toBe(true);
  expect(result.scene.lastQueryUsedIndex).toBe(true);
  expect(result.candidates).toContain('perf-rect-0');
  expect(result.candidates.length).toBeLessThan(20);
  expect(result.textLayout.hits).toBeGreaterThanOrEqual(1);
  expect(result.textLayout.misses).toBeGreaterThanOrEqual(1);
  expect(result.textLayout.size).toBeLessThanOrEqual(result.textLayout.capacity);
});

test('Properties panel returns on-screen after viewport shrink', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ id: 'panel-rect', x: 360, y: 260, width: 220, height: 140 }));
  await page.mouse.click(420, 320);
  await expect(page.locator('#inspector-panel')).toBeVisible();

  await page.locator('#inspector-panel').evaluate(panel => {
    (panel as HTMLElement).dataset.userPositioned = '1';
    (panel as HTMLElement).style.left = '1500px';
    (panel as HTMLElement).style.top = '900px';
    (panel as HTMLElement).style.right = 'auto';
  });
  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForTimeout(40);
  const rect = await page.locator('#inspector-panel').boundingBox();
  expect(rect).toBeTruthy();
  expect(rect!.x).toBeGreaterThanOrEqual(7);
  expect(rect!.y).toBeGreaterThanOrEqual(7);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(893);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(643);
});

test('dense-board connector binding survives duplication and spatial magnetism', async ({ page }) => {
  await openBoard(page);
  const ids = await page.evaluate(() => {
    const a = window.__MY_BOARD_TEST__!.addRectangle({ id: 'bind-a', x: 120, y: 160, width: 160, height: 100 });
    const b = window.__MY_BOARD_TEST__!.addRectangle({ id: 'bind-b', x: 520, y: 160, width: 160, height: 100 });
    const arrow = window.__MY_BOARD_TEST__!.addArrow({
      id: 'bind-arrow',
      start: { x: 280, y: 210 },
      control: { x: 400, y: 210 },
      controls: [{ x: 400, y: 210 }],
      end: { x: 520, y: 210 },
      startBinding: a,
      endBinding: b,
      startBindingPoint: 'right',
      endBindingPoint: 'left',
      routingMode: 'auto',
      curveMode: 'sharp',
    });
    window.__MY_BOARD_TEST__!.select([a, b, arrow]);
    return { a, b, arrow };
  });

  await page.keyboard.press('Control+D');
  let state = await snapshot(page);
  const clones = state.elements.slice(-3);
  const clonedArrow = clones.find((item: any) => item.type === 'arrow' || item.type === 'connector');
  const clonedShapes = clones.filter((item: any) => item.type === 'rectangle');
  expect(clonedArrow).toBeTruthy();
  expect(clonedShapes).toHaveLength(2);
  expect(new Set(clonedShapes.map((item: any) => item.id))).toEqual(new Set([clonedArrow.startBinding, clonedArrow.endBinding]));
  expect(clonedArrow.startBinding).not.toBe(ids.a);
  expect(clonedArrow.endBinding).not.toBe(ids.b);

  await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangleGrid(220, 20, 160, 120));
  const magnet = await page.evaluate(() => window.__MY_BOARD_TEST__!.connectionAt({ x: 3140, y: 1240 }));
  expect(magnet?.id).toBe('perf-rect-219');

  // The duplicated Auto connector must still resolve a finite route on a board
  // large enough to activate the spatial index.
  const route = await page.evaluate((id: string) => window.__MY_BOARD_TEST__!.arrowRenderPoints(id), clonedArrow.id);
  expect(route.length).toBeGreaterThanOrEqual(2);
  expect(route.every((point: any) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
});
