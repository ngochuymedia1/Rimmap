// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import '../ui/dom';
import { Bounds, NoteElement, RectangleElement, ShapeStrokeStyle } from '../model/types';
import { roundedRectPath } from './index';

// Soft card palette inspired by the reference board: low-saturation colors that
// remain readable behind dark text and do not compete with the dotted canvas.
const LEGACY_NOTE_DEFAULT_FILL = '#FFF9E8';
export const NOTE_DEFAULT_FILL = '#FFF4C7';
const RECTANGLE_PAPER_FILL = '#FFF9E8';

export const RECTANGLE_FILL_COLORS = [
    { name: 'Paper', value: RECTANGLE_PAPER_FILL },
    { name: 'Blush', value: '#F7D1CF' },
    { name: 'Peach', value: '#F5DECB' },
    { name: 'Butter', value: '#F5EDBC' },
    { name: 'Sage', value: '#DDE9CB' },
    { name: 'Mint', value: '#CFE9DE' },
    { name: 'Aqua', value: '#C7E8E1' },
    { name: 'Sky', value: '#D8E7F4' },
    { name: 'Lilac', value: '#E4DDF2' },
] as const;

// Notes use a complete 10-color 5×2 palette. It includes every Rectangle
// pastel plus one soft neutral so the panel stays visually balanced.
export const NOTE_FILL_COLORS = [
    { name: 'Paper', value: NOTE_DEFAULT_FILL },
    ...RECTANGLE_FILL_COLORS.slice(1),
    { name: 'Mist', value: '#E8E9EC' },
] as const;

// Eight evenly balanced, low-saturation outline colors. Black remains the
// default and the seven accents move evenly from warm to cool hues.
export const SOFT_STROKE_COLORS = [
    { name: 'Black', value: '#111111' },
    { name: 'Rose', value: '#A96F70' },
    { name: 'Terracotta', value: '#AD8068' },
    { name: 'Ochre', value: '#9B8B57' },
    { name: 'Sage', value: '#6F927E' },
    { name: 'Teal', value: '#6C9692' },
    { name: 'Slate blue', value: '#7187A5' },
    { name: 'Lilac', value: '#81749B' },
] as const;

export function getNoteFill(el: NoteElement): string {
    const fill = el.fillColor || NOTE_DEFAULT_FILL;
    // Old default-paper notes adopt the refreshed sticky-note paper color while
    // every user-selected/custom fill remains untouched.
    return fill.toUpperCase() === LEGACY_NOTE_DEFAULT_FILL ? NOTE_DEFAULT_FILL : fill;
}

export function getRectangleFill(el: RectangleElement): string | null { return el.fillColor || null; }

export function getRectangleStrokeColor(el: RectangleElement): string { return el.strokeColor || '#111111'; }

export function rectangleStrokeEnabled(el: RectangleElement): boolean { return el.strokeEnabled !== false; }

export function getRectangleStrokeStyle(el: RectangleElement): ShapeStrokeStyle { return el.strokeStyle === 'dotted' || el.strokeStyle === 'dashed' ? el.strokeStyle : 'solid'; }

export function getRectanglePatternSpacing(el: RectangleElement): number {
    const n = Number(el.strokePatternSpacing ?? 1);
    return Number.isFinite(n) ? Math.max(.55, Math.min(2, n)) : 1;
}

export function noteCornerRadius(_el: NoteElement): number {
    // Reference sticky notes are nearly square; retain only a tiny anti-aliased
    // corner so the card reads crisp at every zoom level.
    return 1;
}

export function applyRectangleDash(c: CanvasRenderingContext2D, el: RectangleElement) {
    const style = getRectangleStrokeStyle(el);
    const spacing = getRectanglePatternSpacing(el);
    if (style === 'dotted') {
        // Keep each dot visually round while varying only the gap/frequency.
        c.setLineDash([Math.max(1, el.thickness * .7), Math.max(2, el.thickness * 2.4 * spacing)]);
        c.lineCap = 'round';
    }
    else if (style === 'dashed') {
        // Dash length remains readable; spacing controls how frequent the pattern is.
        c.setLineDash([Math.max(5, el.thickness * 3.2), Math.max(2.5, el.thickness * 2.2 * spacing)]);
        c.lineCap = 'butt';
    }
    else {
        c.setLineDash([]);
        c.lineCap = 'butt';
    }
}

export function drawNoteSurface(c: CanvasRenderingContext2D, el: NoteElement, b: Bounds) {
    const radius = noteCornerRadius(el);
    c.save();
    // Classic sticky-note treatment from the supplied reference: warm paper,
    // a thin dark outline, almost-square corners, and one crisp offset shadow.
    // There is deliberately no blur/filter here so moving/resizing Notes stays
    // cheap even on large boards.
    c.fillStyle = 'rgba(48, 47, 42, .88)';
    c.beginPath();
    roundedRectPath(c, b.x + 5, b.y + 5, b.width, b.height, radius);
    c.fill();

    c.fillStyle = getNoteFill(el);
    c.strokeStyle = '#3F3D36';
    c.lineWidth = 1.25;
    c.beginPath();
    roundedRectPath(c, b.x, b.y, b.width, b.height, radius);
    c.fill();
    c.stroke();
    c.restore();
}

export function drawRectangleSurface(c: CanvasRenderingContext2D, el: RectangleElement, b: Bounds) {
    c.save();
    const fill = getRectangleFill(el);
    // Rectangles stay flat even when filled; Notes keep the strong offset shadow.
    c.beginPath();
    roundedRectPath(c, b.x, b.y, b.width, b.height, el.borderRadius);
    if (fill) {
        c.fillStyle = fill;
        c.fill();
    }
    if (rectangleStrokeEnabled(el)) {
        c.strokeStyle = getRectangleStrokeColor(el);
        c.lineWidth = el.thickness;
        applyRectangleDash(c, el);
        c.stroke();
    }
    c.setLineDash([]);
    c.restore();
}
