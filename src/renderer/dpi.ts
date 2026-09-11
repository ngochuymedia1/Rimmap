const MAX_DEVICE_PIXEL_RATIO = 2;

export function getRenderPixelRatio(): number {
  const ratio = Number(window.devicePixelRatio) || 1;
  return Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, ratio));
}

export function getCanvasPixelRatio(canvas: HTMLCanvasElement): number {
  const stored = Number(canvas.dataset.pixelRatio);
  return Number.isFinite(stored) && stored > 0 ? stored : 1;
}

export function getCanvasCssSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width || window.innerWidth || 1),
    height: Math.max(1, rect.height || window.innerHeight || 1),
  };
}

export function resizeCanvasForHighDpi(canvas: HTMLCanvasElement): boolean {
  const { width, height } = getCanvasCssSize(canvas);
  const ratio = getRenderPixelRatio();
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  const changed = canvas.width !== pixelWidth || canvas.height !== pixelHeight || getCanvasPixelRatio(canvas) !== ratio;
  if (!changed) return false;

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  canvas.dataset.pixelRatio = String(ratio);
  return true;
}

export function resetContextToCssPixels(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  const ratio = getCanvasPixelRatio(canvas);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
