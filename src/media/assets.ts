import { get, set } from 'idb-keyval';
import { generateId } from '../model/ids';
import type { CanvasElement, MediaElement, ProjectAssetManifest } from '../model/types';
import { mediaMimeFromName } from './formats';

export const ASSET_STORAGE_PREFIX = 'my-board-v6-asset:';

type StoredAsset = ProjectAssetManifest & { blob: Blob };

const records = new Map<string, ProjectAssetManifest>();
const blobs = new Map<string, Blob>();
const objectUrls = new Map<string, string>();
const images = new Map<string, HTMLImageElement>();
const dataUrls = new Map<string, string>();

function safeAssetId(id: string): string {
    const clean = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
    return clean || `asset-${generateId()}`;
}

function inferredMime(name: string, declared = ''): string {
    if (declared) return declared;
    return mediaMimeFromName(name);
}

function extensionFromMime(mime: string, name = ''): string {
    const lowerMime = (mime || '').toLowerCase();
    const known: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/avif': 'avif',
    };
    if (known[lowerMime]) return known[lowerMime];
    const match = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    return match?.[1] || 'bin';
}

export function assetPathFor(id: string, mime: string, name = ''): string {
    return `assets/${safeAssetId(id)}.${extensionFromMime(mime, name)}`;
}

function assetStorageKey(id: string): string {
    return `${ASSET_STORAGE_PREFIX}${id}`;
}

export function createAssetId(): string {
    return `asset-${generateId()}`;
}

export function seedAssetManifest(manifest: ProjectAssetManifest[] = []) {
    for (const raw of manifest) {
        if (!raw?.id) continue;
        const record: ProjectAssetManifest = {
            id: String(raw.id),
            path: typeof raw.path === 'string' && raw.path ? raw.path : assetPathFor(String(raw.id), raw.mime || 'application/octet-stream', raw.name || ''),
            mime: typeof raw.mime === 'string' && raw.mime ? raw.mime : 'application/octet-stream',
            name: typeof raw.name === 'string' && raw.name ? raw.name : String(raw.id),
            size: Number.isFinite(Number(raw.size)) ? Math.max(0, Number(raw.size)) : 0,
        };
        records.set(record.id, record);
    }
}

export function clearMediaRuntime() {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
    images.clear();
    dataUrls.clear();
}

export function resetAssetMemory() {
    clearMediaRuntime();
    records.clear();
    blobs.clear();
}

export async function putAssetBlob(
    blob: Blob,
    meta: { id?: string; name?: string; mime?: string; path?: string },
): Promise<ProjectAssetManifest> {
    const id = safeAssetId(meta.id || createAssetId());
    const mime = inferredMime(meta.name || '', meta.mime || blob.type || '');
    const name = meta.name || id;
    const record: ProjectAssetManifest = {
        id,
        path: meta.path || assetPathFor(id, mime, name),
        mime,
        name,
        size: blob.size,
    };
    records.set(id, record);
    blobs.set(id, blob);
    dataUrls.delete(id);
    await set(assetStorageKey(id), { ...record, blob } satisfies StoredAsset);
    return record;
}

export async function importAssetFile(file: File): Promise<ProjectAssetManifest> {
    return putAssetBlob(file, { name: file.name, mime: inferredMime(file.name, file.type) });
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
    const cached = blobs.get(assetId);
    if (cached) return cached;
    const stored = await get<StoredAsset | Blob>(assetStorageKey(assetId));
    if (!stored) return null;
    if (stored instanceof Blob) {
        blobs.set(assetId, stored);
        const existing = records.get(assetId);
        if (!existing) records.set(assetId, {
            id: assetId,
            path: assetPathFor(assetId, stored.type || 'application/octet-stream'),
            mime: stored.type || 'application/octet-stream',
            name: assetId,
            size: stored.size,
        });
        return stored;
    }
    if (!(stored.blob instanceof Blob)) return null;
    const record: ProjectAssetManifest = {
        id: stored.id || assetId,
        path: stored.path || assetPathFor(assetId, stored.mime, stored.name),
        mime: stored.mime || stored.blob.type || 'application/octet-stream',
        name: stored.name || assetId,
        size: stored.blob.size,
    };
    records.set(assetId, record);
    blobs.set(assetId, stored.blob);
    return stored.blob;
}

export function getAssetRecord(assetId: string): ProjectAssetManifest | undefined {
    const record = records.get(assetId);
    return record ? { ...record } : undefined;
}

export function manifestForElements(elements: readonly CanvasElement[]): ProjectAssetManifest[] {
    const seen = new Set<string>();
    const out: ProjectAssetManifest[] = [];
    for (const element of elements) {
        if (element.type !== 'media' || !element.assetId || seen.has(element.assetId)) continue;
        seen.add(element.assetId);
        const record = records.get(element.assetId);
        out.push(record ? { ...record } : {
            id: element.assetId,
            path: assetPathFor(element.assetId, element.mime, element.name),
            mime: element.mime || 'application/octet-stream',
            name: element.name || element.assetId,
            size: 0,
        });
    }
    return out;
}

function objectUrlFor(assetId: string, blob: Blob): string {
    let url = objectUrls.get(assetId);
    if (!url) {
        url = URL.createObjectURL(blob);
        objectUrls.set(assetId, url);
    }
    return url;
}

export async function hydrateAsset(assetId: string, onReady?: () => void): Promise<HTMLImageElement | null> {
    const record = records.get(assetId);
    const blob = await getAssetBlob(assetId);
    if (!blob) return null;
    const url = objectUrlFor(assetId, blob);

    const cached = images.get(assetId);
    if (cached) return cached;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Could not decode media asset ${assetId}`));
        img.src = url;
    });
    images.set(assetId, image);
    onReady?.();
    return image;
}

export async function hydrateMediaElements(elements: readonly CanvasElement[], onReady?: () => void) {
    const ids = [...new Set(elements.filter((element): element is MediaElement => element.type === 'media').map(element => element.assetId).filter(Boolean))];
    await Promise.all(ids.map(async id => {
        try { await hydrateAsset(id, onReady); } catch { /* missing/corrupt assets render as placeholders */ }
    }));
}

export function getMediaImage(assetId: string): HTMLImageElement | undefined {
    return images.get(assetId);
}

export async function getAssetDataUrl(assetId: string): Promise<string | null> {
    const cached = dataUrls.get(assetId);
    if (cached) return cached;
    const blob = await getAssetBlob(assetId);
    if (!blob) return null;
    const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Could not encode asset'));
        reader.readAsDataURL(blob);
    });
    dataUrls.set(assetId, value);
    return value;
}

export async function sourceToBlob(source: string, mime = 'application/octet-stream'): Promise<Blob> {
    if (source.startsWith('data:')) {
        const response = await fetch(source);
        return response.blob();
    }
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not load legacy media asset (${response.status})`);
    const blob = await response.blob();
    return blob.type ? blob : new Blob([blob], { type: mime });
}
