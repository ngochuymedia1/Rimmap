import { expect, test } from '@playwright/test';
import { openBoard } from './helpers';

async function showProperties(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.__MY_BOARD_TEST__!.addRectangle({ id: 'responsive-panel-rect', x: 360, y: 260, width: 220, height: 140 }));
  await page.mouse.click(420, 320);
  await expect(page.locator('#inspector-panel')).toBeVisible();
}

async function setDraggedPosition(
  page: import('@playwright/test').Page,
  selector: string,
  left: number,
  top: number,
) {
  await page.locator(selector).evaluate((panel, position) => {
    const element = panel as HTMLElement;
    const handle = element.querySelector<HTMLElement>('.panel-drag-handle');
    element.dataset.userPositioned = '1';
    element.style.setProperty('left', `${position.left}px`, 'important');
    element.style.setProperty('top', `${position.top}px`, 'important');
    element.style.setProperty('right', 'auto', 'important');
    element.style.setProperty('bottom', 'auto', 'important');
    handle?.classList.add('dragging');
    document.body.classList.add('panel-dragging');
    window.dispatchEvent(new PointerEvent('pointerup'));
    handle?.classList.remove('dragging');
    document.body.classList.remove('panel-dragging');
  }, { left, top });
  await page.waitForTimeout(30);
}

test('default floating panels keep their edge relationships', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openBoard(page);
  await showProperties(page);

  const layers = await page.locator('#all-layers-panel').boundingBox();
  const properties = await page.locator('#inspector-panel').boundingBox();
  expect(layers).toBeTruthy();
  expect(properties).toBeTruthy();
  expect(layers!.x).toBeCloseTo(18, 0);
  expect(layers!.y).toBeCloseTo(18, 0);
  expect(1200 - (properties!.x + properties!.width)).toBeCloseTo(18, 0);
  expect(properties!.y).toBeCloseTo(18, 0);

  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForTimeout(30);
  const resizedLayers = await page.locator('#all-layers-panel').boundingBox();
  const resizedProperties = await page.locator('#inspector-panel').boundingBox();
  expect(resizedLayers!.x).toBeCloseTo(18, 0);
  expect(resizedLayers!.y).toBeCloseTo(18, 0);
  expect(900 - (resizedProperties!.x + resizedProperties!.width)).toBeCloseTo(18, 0);
  expect(resizedProperties!.y).toBeCloseTo(18, 0);
});

test('dragged panels preserve their nearest edge offset through resize', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openBoard(page);
  await showProperties(page);

  const propertiesWidth = (await page.locator('#inspector-panel').boundingBox())!.width;
  await setDraggedPosition(page, '#inspector-panel', 1200 - propertiesWidth - 42, 74);
  await setDraggedPosition(page, '#all-layers-panel', 55, 96);

  await page.setViewportSize({ width: 920, height: 640 });
  await page.waitForTimeout(30);
  const properties = await page.locator('#inspector-panel').boundingBox();
  const layers = await page.locator('#all-layers-panel').boundingBox();
  expect(920 - (properties!.x + properties!.width)).toBeCloseTo(42, 0);
  expect(properties!.y).toBeCloseTo(74, 0);
  expect(layers!.x).toBeCloseTo(55, 0);
  expect(layers!.y).toBeCloseTo(96, 0);
});

test('temporary viewport clamping does not overwrite a dragged edge offset', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openBoard(page);
  await showProperties(page);

  const width = (await page.locator('#inspector-panel').boundingBox())!.width;
  await setDraggedPosition(page, '#inspector-panel', 1200 - width - 260, 90);

  await page.setViewportSize({ width: 520, height: 420 });
  await page.waitForTimeout(30);
  const clamped = await page.locator('#inspector-panel').boundingBox();
  expect(clamped!.x).toBeGreaterThanOrEqual(8);
  expect(clamped!.x + clamped!.width).toBeLessThanOrEqual(512);

  // An unrelated click while the panel is clamped must not redefine its saved
  // right-edge offset. Restoring the large viewport should restore 260px.
  await page.mouse.click(20, 300);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(30);
  const restored = await page.locator('#inspector-panel').boundingBox();
  expect(1200 - (restored!.x + restored!.width)).toBeCloseTo(260, 0);
  expect(restored!.y).toBeCloseTo(90, 0);
});

test('collapsed and expanded floating panels keep the same anchors', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await openBoard(page);
  await showProperties(page);

  const propertiesWidth = (await page.locator('#inspector-panel').boundingBox())!.width;
  await setDraggedPosition(page, '#inspector-panel', 1100 - propertiesWidth - 64, 88);
  await setDraggedPosition(page, '#all-layers-panel', 72, 66);

  await page.locator('#btn-inspector-collapse').click();
  await page.locator('#btn-all-layers-toggle').click();
  await page.waitForTimeout(30);
  let properties = await page.locator('#inspector-panel').boundingBox();
  let layers = await page.locator('#all-layers-panel').boundingBox();
  expect(1100 - (properties!.x + properties!.width)).toBeCloseTo(64, 0);
  expect(properties!.y).toBeCloseTo(88, 0);
  expect(layers!.x).toBeCloseTo(72, 0);
  expect(layers!.y).toBeCloseTo(66, 0);

  await page.locator('#btn-inspector-collapse').click();
  await page.locator('#btn-all-layers-toggle').click();
  await page.waitForTimeout(30);
  properties = await page.locator('#inspector-panel').boundingBox();
  layers = await page.locator('#all-layers-panel').boundingBox();
  expect(1100 - (properties!.x + properties!.width)).toBeCloseTo(64, 0);
  expect(properties!.y).toBeCloseTo(88, 0);
  expect(layers!.x).toBeCloseTo(72, 0);
  expect(layers!.y).toBeCloseTo(66, 0);
});

test('short viewports constrain panel height and scroll content instead of scaling controls', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 320 });
  await openBoard(page);
  const arrowId = await page.evaluate(() => window.__MY_BOARD_TEST__!.addArrow({
    id: 'responsive-arrow',
    start: { x: 200, y: 160 },
    control: { x: 360, y: 160 },
    controls: [{ x: 360, y: 160 }],
    end: { x: 520, y: 160 },
  }));
  await page.evaluate(id => window.__MY_BOARD_TEST__!.select([id]), arrowId);
  await expect(page.locator('#inspector-panel')).toBeVisible();
  await page.waitForTimeout(30);

  const panel = await page.locator('#inspector-panel').boundingBox();
  expect(panel).toBeTruthy();
  expect(panel!.height).toBeLessThanOrEqual(304);
  expect(panel!.y).toBeGreaterThanOrEqual(8);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(312);

  const contentMetrics = await page.locator('#inspector-panel .inspector-content').evaluate(element => {
    const style = getComputedStyle(element);
    const firstButton = element.querySelector('button');
    return {
      overflowY: style.overflowY,
      clientHeight: (element as HTMLElement).clientHeight,
      scrollHeight: (element as HTMLElement).scrollHeight,
      buttonHeight: firstButton ? firstButton.getBoundingClientRect().height : 0,
    };
  });
  expect(contentMetrics.overflowY).toBe('auto');
  expect(contentMetrics.scrollHeight).toBeGreaterThan(contentMetrics.clientHeight);
  expect(contentMetrics.buttonHeight).toBeGreaterThanOrEqual(25);
});
