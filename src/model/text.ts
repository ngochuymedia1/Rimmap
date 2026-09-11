// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { appState } from '../state/store';

export const DEFAULT_TEXT_FONT_SIZE = 20;

/** Shared object/label size presets used by Text, Note, Rectangle, and arrow trunk labels. */
export const TEXT_SIZE_PRESETS = { S: 16, M: 20, L: 24, XL: 28, XXL: 34 } as const;

export type TextSizePreset = keyof typeof TEXT_SIZE_PRESETS;

export const DEFAULT_FONT_FAMILY = 'Montserrat';

export const FONT_OPTIONS = [
    { name: 'Montserrat', value: 'Montserrat' },
    { name: 'Inter', value: 'Inter' },
    { name: 'DM Sans', value: 'DM Sans' },
    { name: 'Space Grotesk', value: 'Space Grotesk' },
];

export function normalizeFontSize(_px?: number): number { return DEFAULT_TEXT_FONT_SIZE; }

export function normalizeFontFamily(value?: string): string { return value && FONT_OPTIONS.some(f => f.value === value) ? value : DEFAULT_FONT_FAMILY; }

export function fontStack(family?: string): string { return `'${normalizeFontFamily(family)}', sans-serif`; }

// Note/Rectangle text gets a deliberate inset so glyphs and list markers never
// sit against the shape border. Plain Text elements do not use these paddings.
export const TEXT_PAD_X = 10;

export const TEXT_PAD_Y = 8;

export const MIN_TEXT_SCALE = 0.35;

export const TEXT_BBOX_PAD = 5;

export function getTextScale(el: {
    textScale?: number;
}): number {
    const scale = Number(el.textScale ?? 1);
    return Number.isFinite(scale) ? Math.max(MIN_TEXT_SCALE, scale) : 1;
}

// The HTML editor is rendered in screen space, while the canvas is rendered
// in world space and then multiplied by camera.zoom. Scale only the edit
// surface by the camera zoom so it stays visually matched to the canvas.
// This does NOT touch the object's textScale/fontSize data.
export function getEditorScreenScale(): number {
    return Math.max(0.25, Math.min(5, Number.isFinite(appState.camera.zoom) ? appState.camera.zoom : 1));
}

export const TEXT_COLOR_PALETTE = [
    { name: 'Default', value: '#111827' },
    { name: 'Gray', value: '#6b7280' },
    { name: 'Red', value: '#dc2626' },
    { name: 'Orange', value: '#ea580c' },
    { name: 'Amber', value: '#d97706' },
    { name: 'Green', value: '#16a34a' },
    { name: 'Teal', value: '#0f766e' },
    { name: 'Blue', value: '#0284c7' },
    { name: 'Royal blue', value: '#2563eb' },
    { name: 'Purple', value: '#7c3aed' },
    { name: 'Pink', value: '#db2777' },
    { name: 'Brown', value: '#92400e' },
] as const;
