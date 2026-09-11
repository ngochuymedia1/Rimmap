import { getRenderPixelRatio, resizeCanvasForHighDpi } from '../src/renderer/dpi';

const fakeWindow = { devicePixelRatio: 3, innerWidth: 800, innerHeight: 600 };
(globalThis as any).window = fakeWindow;

if (getRenderPixelRatio() !== 2) throw new Error('devicePixelRatio must be capped at 2');

const canvas: any = {
  width: 0,
  height: 0,
  dataset: {},
  getBoundingClientRect: () => ({ width: 500, height: 300 }),
};
if (!resizeCanvasForHighDpi(canvas)) throw new Error('first resize should update backing store');
if (canvas.width !== 1000 || canvas.height !== 600 || canvas.dataset.pixelRatio !== '2') {
  throw new Error(`unexpected backing size ${canvas.width}x${canvas.height} @ ${canvas.dataset.pixelRatio}`);
}
if (resizeCanvasForHighDpi(canvas)) throw new Error('identical resize should be a no-op');

fakeWindow.devicePixelRatio = 1.25;
if (!resizeCanvasForHighDpi(canvas)) throw new Error('DPR change should resize backing store');
if (canvas.width !== 625 || canvas.height !== 375 || canvas.dataset.pixelRatio !== '1.25') {
  throw new Error('fractional DPR should be preserved below the cap');
}
console.log('OK: high-DPI backing store uses CSS size × capped devicePixelRatio.');
