import type { ArrowLabelLayout, Bounds } from '../model/types';

const clampPathPosition = (value: number) => Math.max(.05, Math.min(.95, value));

function boundsOverlapArea(a: Bounds, b: Bounds): number {
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return width * height;
}

/**
 * Deterministically tries the authored label position/side first, then the
 * opposite side, then small symmetric shifts along the connector. The authored
 * values are not mutated; this is display geometry only.
 */
export function chooseCollisionAvoidedPathLabel(
    build: (position: number, side: -1 | 1) => ArrowLabelLayout,
    position: number,
    side: -1 | 1,
    obstacles: Bounds[],
): ArrowLabelLayout {
    const basePosition = clampPathPosition(position);
    const opposite: -1 | 1 = side === 1 ? -1 : 1;
    const candidates: Array<[number, -1 | 1]> = [[basePosition, side], [basePosition, opposite]];
    for (const shift of [.06, .12, .18]) {
        for (const nextPosition of [basePosition - shift, basePosition + shift]) {
            const clamped = clampPathPosition(nextPosition);
            candidates.push([clamped, side], [clamped, opposite]);
        }
    }
    let best = build(basePosition, side);
    let bestScore = Infinity;
    for (const [candidatePosition, candidateSide] of candidates) {
        const layout = build(candidatePosition, candidateSide);
        const score = obstacles.reduce((sum, obstacle) => sum + boundsOverlapArea(layout.box, obstacle), 0);
        if (score <= 0)
            return layout;
        if (score < bestScore) {
            best = layout;
            bestScore = score;
        }
    }
    return best;
}
