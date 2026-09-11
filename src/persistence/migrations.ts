import type { CanvasElement, LayerGroupNode, ProjectAssetManifest, ProjectFile, ProjectSettings } from '../model/types';
import { normalizeTextDocument, textDocumentFromLegacy, textDocumentPlainText } from '../model/text-document';

export const CURRENT_SCHEMA_VERSION = 12 as const;
export type SupportedSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

const DEFAULT_FONT_FAMILY = 'Montserrat';
const DEFAULT_TEXT_FONT_SIZE = 20;
const MIN_TEXT_SCALE = 0.35;
const NOTE_DEFAULT_FILL = '#FFF9E8';
const ARROW_LABEL_FONT_SIZE = 14;

export type EmbeddedAssetSource = {
    id: string;
    path: string;
    mime: string;
    name: string;
    source: string;
};

export type MigrationResult = {
    project: ProjectFile;
    fromVersion: SupportedSchemaVersion;
    migrated: boolean;
    /** Legacy v1-v5 JSON media payloads that must be materialized into Blob assets once. */
    embeddedAssets: EmbeddedAssetSource[];
};

type MutableProject = {
    format: 'my-board-project';
    schemaVersion: SupportedSchemaVersion;
    name: string;
    savedAt: string;
    elements: any[];
    layerGroups?: any[];
    settings: ProjectSettings;
    assets?: any[];
    archiveVersion?: number;
    __embeddedAssets?: EmbeddedAssetSource[];
    [key: string]: unknown;
};

type Migration = (project: MutableProject) => MutableProject;

function finiteNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function isPoint(value: unknown): value is { x: number; y: number } {
    return !!value && typeof value === 'object' && Number.isFinite(Number((value as any).x)) && Number.isFinite(Number((value as any).y));
}

function point(value: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
    if (!isPoint(value)) return { ...fallback };
    return { x: Number((value as any).x), y: Number((value as any).y) };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function normalizeArrowStyle(value: unknown): 'line' | 'dots' | 'arrow' | 'double' | 'dotted' | 'dashed' {
    if (value === 'line' || value === 'dots' || value === 'arrow' || value === 'double' || value === 'dotted' || value === 'dashed') return value;
    if (value === 'solid') return 'arrow';
    if (value === 'plain') return 'line';
    return 'line';
}

function elementTypeLabel(element: any): string {
    switch (element?.type) {
        case 'note': return 'Note';
        case 'rectangle': return 'Rectangle';
        case 'arrow': return 'Arrow';
        case 'connector': return 'Connector';
        case 'text': return 'Text';
        case 'freehand': return 'Brush';
        case 'media': return 'Image';
        default: return 'Object';
    }
}

function ensureStableLayerNames(elements: any[]): void {
    const counters = new Map<string, number>();
    for (const element of elements) {
        const label = elementTypeLabel(element);
        const current = typeof element?.name === 'string' ? element.name.trim() : '';
        if (current) {
            const match = current.match(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`, 'i'));
            if (match) counters.set(label, Math.max(counters.get(label) ?? 0, Number(match[1])));
            continue;
        }
        const next = (counters.get(label) ?? 0) + 1;
        counters.set(label, next);
        element.name = `${label} ${next}`;
    }
}


/**
 * Produces a current-schema element payload with browser/editor-only legacy
 * caches removed. This is used both when accepting already-current files and
 * when creating a new save, so stray richText/richLines fields cannot leak
 * back into current archives.
 */
export function currentSchemaElements(elements: CanvasElement[] | any[]): CanvasElement[] {
    return structuredClone(elements).map((raw: any) => {
        const item = raw as any;
        const stripText = (target: any, prefix = '') => {
            const richTextKey = prefix ? `${prefix}RichText` : 'richText';
            const richLinesKey = prefix ? `${prefix}RichLines` : 'richLines';
            delete target[richTextKey];
            delete target[richLinesKey];
        };
        if (item.type === 'text' || item.type === 'note' || item.type === 'rectangle') stripText(item);
        if (item.type === 'arrow' || item.type === 'connector') {
            stripText(item, 'label');
            stripText(item, 'startLabel');
            stripText(item, 'endLabel');
            if (Array.isArray(item.branches)) item.branches.forEach((branch: any) => stripText(branch, 'label'));
            item.routingMode = item.arrowMode === 'branches' ? 'manual' : item.routingMode === 'auto' ? 'auto' : 'manual';
        }
        if (item.type === 'media') delete item.src;
        item.hidden = !!item.hidden;
        if (typeof item.parentGroupId !== 'string' || !item.parentGroupId.trim()) delete item.parentGroupId;
        else item.parentGroupId = item.parentGroupId.trim();
        delete item.groupId;
        return item as CanvasElement;
    });
}

export function currentSchemaLayerGroups(rawGroups: LayerGroupNode[] | any[], elements: CanvasElement[]): LayerGroupNode[] {
    const groups: LayerGroupNode[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(rawGroups) ? rawGroups : []) {
        const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        groups.push({
            id,
            name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Group',
            ...(typeof raw.parentGroupId === 'string' && raw.parentGroupId.trim() ? { parentGroupId: raw.parentGroupId.trim() } : {}),
        });
    }
    const ids = new Set(groups.map(group => group.id));
    const byId = new Map(groups.map(group => [group.id, group]));
    const safeParent = (id: string, candidate?: string): string | undefined => {
        if (!candidate || candidate === id || !ids.has(candidate)) return undefined;
        const visited = new Set([id]);
        let current: string | undefined = candidate;
        while (current) {
            if (visited.has(current)) return undefined;
            visited.add(current);
            current = byId.get(current)?.parentGroupId;
        }
        return candidate;
    };
    const normalized = groups.map(group => ({ ...group, parentGroupId: safeParent(group.id, group.parentGroupId) }));
    const valid = new Set(normalized.map(group => group.id));
    for (const element of elements) {
        if (element.parentGroupId && !valid.has(element.parentGroupId)) element.parentGroupId = undefined;
    }
    // Remove empty nodes bottom-up. Empty groups are not meaningful document content.
    let next = normalized;
    let changed = true;
    while (changed) {
        changed = false;
        const currentIds = new Set(next.map(group => group.id));
        const nonEmpty = new Set<string>();
        for (const element of elements) if (element.parentGroupId && currentIds.has(element.parentGroupId)) nonEmpty.add(element.parentGroupId);
        for (const group of next) if (group.parentGroupId && currentIds.has(group.parentGroupId)) nonEmpty.add(group.parentGroupId);
        const filtered = next.filter(group => nonEmpty.has(group.id));
        if (filtered.length !== next.length) {
            const kept = new Set(filtered.map(group => group.id));
            next = filtered.map(group => group.parentGroupId && !kept.has(group.parentGroupId) ? { ...group, parentGroupId: undefined } : group);
            changed = true;
        }
    }
    return next;
}

function defaultSettings(settings: unknown): ProjectSettings {
    const raw = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
    // v1-v6 used a global currentColor preference. Preserve its only useful
    // legacy meaning once by seeding brushColor when no brush-specific color exists.
    const legacyCurrentColor = typeof raw.currentColor === 'string' && raw.currentColor ? raw.currentColor : '';
    return {
        brushColor: typeof raw.brushColor === 'string' && raw.brushColor ? raw.brushColor : legacyCurrentColor || '#111827',
        currentThickness: clamp(raw.currentThickness, 1, 12, 3),
        arrowStyle: normalizeArrowStyle(raw.arrowStyle),
        arrowColor: typeof raw.arrowColor === 'string' && raw.arrowColor ? raw.arrowColor : '#111827',
        camera: raw.camera && typeof raw.camera === 'object' ? {
            x: finiteNumber((raw.camera as any).x, 0),
            y: finiteNumber((raw.camera as any).y, 0),
            zoom: clamp((raw.camera as any).zoom, 0.1, 5, 1),
        } : { x: 0, y: 0, zoom: 1 },
        exportPngScale: clamp(raw.exportPngScale, 1, 6, 4),
    };
}

function extensionFromMime(mime: string, name = ''): string {
    const known: Record<string, string> = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
        'image/svg+xml': 'svg', 'image/avif': 'avif', 'video/mp4': 'mp4',
        'video/webm': 'webm', 'video/quicktime': 'mov',
    };
    const normalized = String(mime || '').toLowerCase();
    if (known[normalized]) return known[normalized];
    return String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] || 'bin';
}

function assetPath(id: string, mime: string, name = ''): string {
    const safe = String(id || 'asset').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
    return `assets/${safe}.${extensionFromMime(mime, name)}`;
}

function normalizedAssetManifest(raw: unknown): ProjectAssetManifest[] {
    if (!Array.isArray(raw)) return [];
    const out: ProjectAssetManifest[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const id = typeof (item as any).id === 'string' ? (item as any).id.trim() : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const mime = typeof (item as any).mime === 'string' && (item as any).mime ? (item as any).mime : 'application/octet-stream';
        const name = typeof (item as any).name === 'string' && (item as any).name ? (item as any).name : id;
        out.push({
            id,
            path: typeof (item as any).path === 'string' && (item as any).path ? (item as any).path : assetPath(id, mime, name),
            mime,
            name,
            size: Number.isFinite(Number((item as any).size)) ? Math.max(0, Number((item as any).size)) : 0,
        });
    }
    return out;
}

function normalizeEnvelope(raw: unknown, fallbackName: string): MutableProject {
    const now = new Date().toISOString();
    if (Array.isArray(raw)) {
        return {
            format: 'my-board-project',
            schemaVersion: 1,
            name: fallbackName || 'Untitled Board',
            savedAt: now,
            elements: structuredClone(raw),
            settings: defaultSettings(undefined),
            assets: [],
        };
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).elements)) {
        throw new Error('Invalid project file: expected a project object with an elements array.');
    }

    const source = raw as Record<string, unknown>;
    const explicitSchemaVersion = Number(source.schemaVersion);
    const legacyVersion = Number(source.version);
    let schemaVersion: number;
    if (Number.isInteger(explicitSchemaVersion) && explicitSchemaVersion > 0) schemaVersion = explicitSchemaVersion;
    else if (Number.isInteger(legacyVersion) && legacyVersion > 0) schemaVersion = legacyVersion;
    else schemaVersion = 1;

    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(`Project schema v${schemaVersion} is newer than this build supports (v${CURRENT_SCHEMA_VERSION}).`);
    }
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(schemaVersion)) {
        throw new Error(`Unsupported project schema version: ${schemaVersion}.`);
    }

    return {
        ...structuredClone(source),
        format: 'my-board-project',
        schemaVersion: schemaVersion as SupportedSchemaVersion,
        name: typeof source.name === 'string' && source.name.trim() ? source.name : fallbackName || 'Untitled Board',
        savedAt: typeof source.savedAt === 'string' && source.savedAt ? source.savedAt : now,
        elements: structuredClone(source.elements as any[]),
        layerGroups: Array.isArray(source.layerGroups) ? structuredClone(source.layerGroups as any[]) : [],
        settings: defaultSettings(source.settings),
        assets: normalizedAssetManifest(source.assets),
        archiveVersion: Number(source.archiveVersion) || undefined,
    };
}

export const migrateV1ToV2: Migration = project => ({
    ...project,
    schemaVersion: 2,
    settings: defaultSettings(project.settings),
});

export const migrateV2ToV3: Migration = project => ({
    ...project,
    schemaVersion: 3,
    settings: defaultSettings(project.settings),
});

/**
 * v4 makes layer metadata and text/shape presentation explicit instead of
 * depending on renderer fallbacks. The conversion is idempotent after the
 * schemaVersion advances, so fontSize is folded into textScale exactly once.
 */
export const migrateV3ToV4: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 4;
    next.settings = defaultSettings(next.settings);
    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        item.locked = !!item.locked;

        if (item.type === 'text' || item.type === 'note' || item.type === 'rectangle') {
            const rawSize = finiteNumber(item.fontSize, DEFAULT_TEXT_FONT_SIZE);
            const oldScale = Math.max(MIN_TEXT_SCALE, finiteNumber(item.textScale, 1));
            item.textScale = Math.max(MIN_TEXT_SCALE, oldScale * rawSize / DEFAULT_TEXT_FONT_SIZE);
            item.fontSize = DEFAULT_TEXT_FONT_SIZE;
            item.fontFamily = typeof item.fontFamily === 'string' && item.fontFamily ? item.fontFamily : DEFAULT_FONT_FAMILY;
            item.textAlign = item.textAlign === 'center' || item.textAlign === 'right' ? item.textAlign : 'left';
        }

        if (item.type === 'note') {
            item.fillColor = typeof item.fillColor === 'string' && item.fillColor ? item.fillColor : NOTE_DEFAULT_FILL;
            item.borderRadius = finiteNumber(item.borderRadius, 3);
        }
        if (item.type === 'rectangle') {
            item.strokeEnabled = item.strokeEnabled !== false;
            item.strokeStyle = item.strokeStyle === 'dotted' || item.strokeStyle === 'dashed' ? item.strokeStyle : 'solid';
            item.strokePatternSpacing = clamp(item.strokePatternSpacing, 0.55, 2, 1);
            item.strokeColor = typeof item.strokeColor === 'string' && item.strokeColor ? item.strokeColor : '#111111';
        }
        return item;
    });
    ensureStableLayerNames(next.elements);
    return next;
};

/**
 * v5 makes connector geometry/modes/label defaults explicit. Missing branch
 * IDs are generated deterministically from the owning arrow ID + branch index
 * so migration does not change data on repeated imports.
 */
export const migrateV4ToV5: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 5;
    next.settings = defaultSettings(next.settings);
    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        if (item.type !== 'arrow' && item.type !== 'connector') return item;

        const start = point(item.start, { x: 0, y: 0 });
        const end = point(item.end, start);
        const control = point(item.control, midpoint(start, end));
        item.start = start;
        item.end = end;
        item.control = control;
        item.style = normalizeArrowStyle(item.style);
        item.curveMode = item.curveMode === 'sharp' ? 'sharp' : 'smooth';
        item.arrowMode = item.arrowMode === 'branches' ? 'branches' : 'connection';
        item.opacity = clamp(item.opacity, 0.15, 1, 1);
        item.pointCount = item.pointCount === 5 ? 5 : 3;

        const controls = Array.isArray(item.controls) ? item.controls.filter(isPoint).map((p: any) => point(p, control)) : [];
        if (controls.length === 1 || controls.length === 3) item.controls = controls;
        else if (item.pointCount === 5) item.controls = [midpoint(start, control), control, midpoint(control, end)];
        else item.controls = [control];

        item.labelFontSize = ARROW_LABEL_FONT_SIZE;
        item.labelFontFamily = typeof item.labelFontFamily === 'string' && item.labelFontFamily ? item.labelFontFamily : DEFAULT_FONT_FAMILY;
        item.labelPosition = clamp(item.labelPosition, 0.05, 0.95, 0.5);
        item.labelSide = item.labelSide === 1 ? 1 : -1;
        item.startLabelFontFamily = typeof item.startLabelFontFamily === 'string' && item.startLabelFontFamily ? item.startLabelFontFamily : DEFAULT_FONT_FAMILY;
        item.endLabelFontFamily = typeof item.endLabelFontFamily === 'string' && item.endLabelFontFamily ? item.endLabelFontFamily : DEFAULT_FONT_FAMILY;

        item.branches = Array.isArray(item.branches) ? item.branches.map((branch: any, index: number) => {
            const migrated = structuredClone(branch) as any;
            migrated.id = typeof migrated.id === 'string' && migrated.id ? migrated.id : `${item.id || 'arrow'}-branch-${index + 1}`;
            migrated.root = migrated.root === 'start' ? 'start' : 'end';
            const root = migrated.root === 'start' ? start : end;
            migrated.end = point(migrated.end, root);
            migrated.pointCount = migrated.pointCount === 5 ? 5 : 3;
            const branchControls = Array.isArray(migrated.controls) ? migrated.controls.filter(isPoint).map((p: any) => point(p, root)) : [];
            if (branchControls.length === 1 || branchControls.length === 3) migrated.controls = branchControls;
            else if (migrated.pointCount === 5) {
                const branchControl = midpoint(root, migrated.end);
                migrated.controls = [midpoint(root, branchControl), branchControl, midpoint(branchControl, migrated.end)];
            } else migrated.controls = [midpoint(root, migrated.end)];
            migrated.labelPosition = clamp(migrated.labelPosition, 0.05, 0.95, 0.5);
            migrated.labelSide = migrated.labelSide === 1 ? 1 : -1;
            migrated.labelFontFamily = typeof migrated.labelFontFamily === 'string' && migrated.labelFontFamily ? migrated.labelFontFamily : DEFAULT_FONT_FAMILY;
            return migrated;
        }) : [];

        return item;
    });
    ensureStableLayerNames(next.elements);
    return next;
};

/**
 * v6 removes Base64/blob payloads from MediaElement. Media elements keep only
 * assetId + display metadata; project.json carries an asset manifest and the
 * ZIP container carries the binary bytes under assets/.
 */
export const migrateV5ToV6: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 6;
    next.archiveVersion = 1;
    next.settings = defaultSettings(next.settings);
    const manifests = new Map(normalizedAssetManifest(next.assets).map(asset => [asset.id, asset]));
    const embedded: EmbeddedAssetSource[] = Array.isArray(next.__embeddedAssets) ? [...next.__embeddedAssets] : [];

    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        if (item.type !== 'media') return item;
        const id = typeof item.assetId === 'string' && item.assetId ? item.assetId : `asset-${String(item.id || 'media')}`;
        const mime = typeof item.mime === 'string' && item.mime ? item.mime : 'application/octet-stream';
        const name = typeof item.name === 'string' && item.name ? item.name : id;
        const path = manifests.get(id)?.path || assetPath(id, mime, name);
        const source = typeof item.src === 'string' && item.src ? item.src : '';
        if (source) embedded.push({ id, path, mime, name, source });
        manifests.set(id, manifests.get(id) || { id, path, mime, name, size: 0 });
        item.assetId = id;
        item.mime = mime;
        item.name = name;
        delete item.src;
        return item;
    });

    next.assets = [...manifests.values()];
    next.__embeddedAssets = embedded;
    return next;
};

/**
 * v7 removes the obsolete standalone Color-panel preferences. Brush and Arrow
 * retain their independent colors; legacy currentColor seeds brushColor once.
 */
export const migrateV6ToV7: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 7;
    next.settings = defaultSettings(next.settings);
    return next;
};


/**
 * v8 makes the structured TextDocument the only persisted rich-text source of
 * truth. contenteditable HTML and the old richLines cache are migration inputs
 * only and are removed after conversion.
 */
export const migrateV7ToV8: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 8;
    next.settings = defaultSettings(next.settings);
    const arrowTextColor = '#27272a';
    const migrateText = (item: any, textKey: string, docKey: string, richTextKey: string, richLinesKey: string, baseColor: string) => {
        const plain = typeof item[textKey] === 'string' ? item[textKey] : '';
        if (!plain && !item[richTextKey] && !item[richLinesKey]) {
            delete item[docKey];
            delete item[richTextKey];
            delete item[richLinesKey];
            return;
        }
        const doc = textDocumentFromLegacy({ text: plain, richText: item[richTextKey], richLines: item[richLinesKey] }, baseColor);
        item[docKey] = doc;
        item[textKey] = textDocumentPlainText(doc);
        delete item[richTextKey];
        delete item[richLinesKey];
    };
    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        if (item.type === 'text' || item.type === 'note' || item.type === 'rectangle') {
            migrateText(item, 'text', 'textDoc', 'richText', 'richLines', typeof item.color === 'string' && item.color ? item.color : '#111827');
            if (item.type === 'rectangle' && !item.text) delete item.textDoc;
        }
        if (item.type === 'arrow' || item.type === 'connector') {
            migrateText(item, 'label', 'labelDoc', 'labelRichText', 'labelRichLines', arrowTextColor);
            migrateText(item, 'startLabel', 'startLabelDoc', 'startLabelRichText', 'startLabelRichLines', arrowTextColor);
            migrateText(item, 'endLabel', 'endLabelDoc', 'endLabelRichText', 'endLabelRichLines', arrowTextColor);
            if (Array.isArray(item.branches)) item.branches = item.branches.map((branch: any) => {
                const nextBranch = structuredClone(branch);
                migrateText(nextBranch, 'label', 'labelDoc', 'labelRichText', 'labelRichLines', arrowTextColor);
                return nextBranch;
            });
        }
        return item;
    });
    return next;
};


/**
 * v9 makes Note/Rectangle text positioning explicit and repairs ordered-list
 * numbering from structure. Older editor DOM could leave stale <li value>
 * metadata after Tab/Shift+Tab; canonical numbering is now derived from the
 * structured list hierarchy instead of those transient browser attributes.
 */
export const migrateV8ToV9: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 9;
    next.settings = defaultSettings(next.settings);
    const arrowTextColor = '#27272a';
    const normalizeDoc = (item: any, textKey: string, docKey: string, color: string) => {
        if (!item[docKey] && !item[textKey]) return;
        const doc = normalizeTextDocument(item[docKey], typeof item[textKey] === 'string' ? item[textKey] : '', color);
        item[docKey] = doc;
        item[textKey] = textDocumentPlainText(doc);
    };
    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        if (item.type === 'text' || item.type === 'note' || item.type === 'rectangle') {
            normalizeDoc(item, 'text', 'textDoc', typeof item.color === 'string' && item.color ? item.color : '#111827');
            if (item.type === 'note' || item.type === 'rectangle') {
                item.textVerticalAlign = item.textVerticalAlign === 'middle' ? 'middle' : 'top';
            }
        }
        if (item.type === 'arrow' || item.type === 'connector') {
            normalizeDoc(item, 'label', 'labelDoc', arrowTextColor);
            normalizeDoc(item, 'startLabel', 'startLabelDoc', arrowTextColor);
            normalizeDoc(item, 'endLabel', 'endLabelDoc', arrowTextColor);
            if (Array.isArray(item.branches)) item.branches = item.branches.map((branch: any) => {
                const nextBranch = structuredClone(branch);
                normalizeDoc(nextBranch, 'label', 'labelDoc', arrowTextColor);
                return nextBranch;
            });
        }
        return item;
    });
    return next;
};


/**
 * v10 persists element visibility explicitly. Older projects did not have a
 * visibility flag, so every migrated element starts visible.
 */
export const migrateV9ToV10: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 10;
    next.settings = defaultSettings(next.settings);
    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        item.hidden = !!item.hidden;
        return item;
    });
    return next;
};

/**
 * v11 replaces the legacy flat groupId tag with first-class Layer-group nodes.
 * Element z-order is intentionally unchanged so old projects keep identical rendering.
 */
export const migrateV10ToV11: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 11;
    next.settings = defaultSettings(next.settings);
    const groups: LayerGroupNode[] = [];
    const seen = new Set<string>();
    let autoIndex = 1;
    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        const legacyGroupId = typeof item.groupId === 'string' ? item.groupId.trim() : '';
        if (legacyGroupId) {
            item.parentGroupId = legacyGroupId;
            if (!seen.has(legacyGroupId)) {
                seen.add(legacyGroupId);
                groups.push({ id: legacyGroupId, name: `Group ${autoIndex++}` });
            }
        }
        delete item.groupId;
        return item;
    });
    next.layerGroups = groups;
    return next;
};

/**
 * v12 makes connector routing explicit. Existing connectors remain Manual so
 * migration never changes the visual geometry of an older board.
 */
export const migrateV11ToV12: Migration = project => {
    const next = structuredClone(project) as MutableProject;
    next.schemaVersion = 12;
    next.settings = defaultSettings(next.settings);
    next.elements = next.elements.map(element => {
        const item = structuredClone(element) as any;
        if (item.type === 'arrow' || item.type === 'connector') item.routingMode = 'manual';
        return item;
    });
    return next;
};

const MIGRATIONS: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11, Migration> = {
    1: migrateV1ToV2,
    2: migrateV2ToV3,
    3: migrateV3ToV4,
    4: migrateV4ToV5,
    5: migrateV5ToV6,
    6: migrateV6ToV7,
    7: migrateV7ToV8,
    8: migrateV8ToV9,
    9: migrateV9ToV10,
    10: migrateV10ToV11,
    11: migrateV11ToV12,
};

export function migrateProjectFile(raw: unknown, fallbackName = 'Untitled Board'): MigrationResult {
    let project = normalizeEnvelope(raw, fallbackName);
    const fromVersion = project.schemaVersion;
    while (project.schemaVersion < CURRENT_SCHEMA_VERSION) {
        const migrate = MIGRATIONS[project.schemaVersion as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11];
        if (!migrate) throw new Error(`No migration registered for project schema v${project.schemaVersion}.`);
        project = migrate(project);
    }

    const elements = currentSchemaElements(project.elements);
    const layerGroups = currentSchemaLayerGroups(project.layerGroups || [], elements);
    const validGroupIds = new Set(layerGroups.map(group => group.id));
    for (const element of elements as any[]) {
        if (element.parentGroupId && !validGroupIds.has(element.parentGroupId)) delete element.parentGroupId;
        if (element.type === 'media' && (!element.assetId || typeof element.assetId !== 'string')) {
            throw new Error(`Project schema v${CURRENT_SCHEMA_VERSION} media element ${element.id || '<unknown>'} is missing assetId.`);
        }
        if (element.type === 'media') delete element.src;
    }
    const current: ProjectFile = {
        format: 'my-board-project',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        archiveVersion: 1,
        name: project.name || fallbackName || 'Untitled Board',
        savedAt: project.savedAt || new Date().toISOString(),
        elements,
        layerGroups,
        assets: normalizedAssetManifest(project.assets),
        settings: defaultSettings(project.settings),
    };
    return {
        project: current,
        fromVersion,
        migrated: fromVersion !== CURRENT_SCHEMA_VERSION,
        embeddedAssets: Array.isArray(project.__embeddedAssets) ? structuredClone(project.__embeddedAssets) : [],
    };
}
