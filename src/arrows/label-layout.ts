/**
 * Pure sizing policy for floating path labels.
 *
 * The editable/wrapping area is derived from connector length, not from the
 * longest currently wrapped line.  This keeps the width stable while typing
 * and makes short/long connectors receive proportionate label space.
 */
export const ARROW_LABEL_PATH_WIDTH_RATIO = 0.34;
export const ARROW_LABEL_MAX_WIDTH = 360;
export const ARROW_LABEL_MIN_PATH_WIDTH = 72;

export function arrowLabelWidthLimit(pathLength: number, fontSize: number): number {
    const length = Number.isFinite(pathLength) ? Math.max(0, pathLength) : 0;
    const size = Number.isFinite(fontSize) ? Math.max(1, fontSize) : 14;
    // Larger text needs enough room for a few words even on short connectors;
    // longer connectors expand naturally but stop before the label becomes a banner.
    const fontFloor = Math.max(ARROW_LABEL_MIN_PATH_WIDTH, size * 4.25);
    return Math.max(24, Math.min(ARROW_LABEL_MAX_WIDTH, Math.max(fontFloor, length * ARROW_LABEL_PATH_WIDTH_RATIO)));
}
