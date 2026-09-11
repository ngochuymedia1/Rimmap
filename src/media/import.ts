import { fileNameFromPath, readDesktopFile } from '../desktop/index';
import { requestLayersPanelRefresh } from '../layers/index';
import type { Point } from '../model/types';
import { generateId } from '../model/ids';
import { saveToLocal } from '../persistence/index';
import { redraw } from '../renderer/index';
import { beginHistoryTransaction, commitHistory } from '../state/history';
import { dispatch } from '../state/store';
import { showToast } from '../ui/dialogs';
import { hydrateAsset, importAssetFile } from './assets';
import { isSupportedMediaName, mediaKindFromName, mediaMimeFromName, supportedMediaSummary, unsupportedMotionSummary } from './formats';

export function isSupportedMediaPath(path: string): boolean {
  return isSupportedMediaName(fileNameFromPath(path));
}

export async function mediaFilesFromDesktopPaths(paths: string[]): Promise<File[]> {
  const files: File[] = [];
  for (const path of paths) {
    if (!isSupportedMediaPath(path)) continue;
    try {
      const bytes = await readDesktopFile(path);
      const name = fileNameFromPath(path);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      files.push(new File([buffer], name, { type: mediaMimeFromName(name), lastModified: Date.now() }));
    } catch (error) {
      console.error('Could not read dropped desktop media file', path, error);
    }
  }
  return files;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') && !['image/gif', 'image/apng'].includes(file.type)
    || mediaKindFromName(file.name) === 'image';
}

export function isSupportedMediaFile(file: File): boolean {
  return isImageFile(file);
}

function clipboardImageName(file: File, index: number): string {
  if (file.name && !/^image\.(png|jpe?g)$/i.test(file.name)) return file.name;
  const ext = file.type === 'image/jpeg' ? 'jpg'
    : file.type === 'image/webp' ? 'webp'
    : file.type === 'image/svg+xml' ? 'svg'
    : file.type === 'image/avif' ? 'avif'
    : 'png';
  return `Clipboard Image${index > 0 ? ` ${index + 1}` : ''}.${ext}`;
}


export function countUnsupportedMediaFiles(files: Iterable<File>): number {
  let count = 0;
  for (const file of files) if (!isSupportedMediaFile(file)) count++;
  return count;
}

export function clipboardHasMediaPayload(data: DataTransfer | null): boolean {
  if (!data) return false;
  if (Array.from(data.files || []).length > 0) return true;
  return Array.from(data.items || []).some(item => item.kind === 'file' && /^(image|video|audio)\//i.test(item.type || ''));
}

export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<File>();
  for (const file of Array.from(data.files || [])) {
    if (!isImageFile(file) || seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  if (!files.length) {
    for (const item of Array.from(data.items || [])) {
      if (item.kind !== 'file' || !item.type.startsWith('image/') || ['image/gif', 'image/apng'].includes(item.type)) continue;
      const file = item.getAsFile();
      if (file && !seen.has(file) && isImageFile(file)) {
        seen.add(file);
        files.push(file);
      }
    }
  }
  return files.map((file, index) => file.name
    ? file
    : new File([file], clipboardImageName(file, index), { type: file.type || 'image/png', lastModified: Date.now() }));
}

function fileNameFromUrl(url: string, mime: string): string {
  try {
    const pathname = new URL(url).pathname;
    const raw = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    if (raw && /\.[a-z0-9]{2,8}$/i.test(raw)) return raw;
  } catch { }
  const ext = mime === 'image/jpeg' ? 'jpg'
    : mime === 'image/webp' ? 'webp'
    : mime === 'image/svg+xml' ? 'svg'
    : mime === 'image/avif' ? 'avif'
    : 'png';
  return `Dropped Image.${ext}`;
}

function imageUrlFromTransfer(data: DataTransfer): string | null {
  const uri = data.getData('text/uri-list').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
  if (uri && /^(https?:|data:image\/)/i.test(uri)) return uri;

  const html = data.getData('text/html');
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const src = doc.querySelector('img')?.getAttribute('src')?.trim();
      if (src && /^(https?:|data:image\/)/i.test(src)) return src;
    } catch { }
  }

  const plain = data.getData('text/plain').trim();
  return /^(https?:|data:image\/)/i.test(plain) ? plain : null;
}

/**
 * Returns local dropped still-image/vector files first. If a browser drag
 * exposes only an image URL, try to materialize that URL as a File.
 */
export async function mediaFilesFromDrop(data: DataTransfer): Promise<File[]> {
  const local = Array.from(data.files || []).filter(isSupportedMediaFile);
  if (local.length) return local;

  const url = imageUrlFromTransfer(data);
  if (!url) return [];
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || ['image/gif', 'image/apng'].includes(blob.type)) return [];
    return [new File([blob], fileNameFromUrl(url, blob.type), { type: blob.type, lastModified: Date.now() })];
  } catch {
    return [];
  }
}

export async function insertMediaFiles(files: File[], anchor: Point): Promise<number> {
  const supported = files.filter(isSupportedMediaFile);
  if (!supported.length) return 0;

  const before = beginHistoryTransaction();
  let inserted = 0;
  for (const file of supported) {
    try {
      const asset = await importAssetFile(file);
      const image = await hydrateAsset(asset.id, redraw);
      const mediaId = generateId();
      const w = Math.max(120, Math.min(520, image?.naturalWidth || 240));
      const h = Math.max(90, Math.min(420, image?.naturalHeight || 160));
      dispatch({
        type: 'ADD_ELEMENT',
        element: {
          id: mediaId,
          type: 'media',
          x: anchor.x - w / 2,
          y: anchor.y - h / 2,
          width: w,
          height: h,
          assetId: asset.id,
          mime: asset.mime,
          name: file.name || 'Image',
          color: '#111827',
          thickness: 1,
        },
      });
      inserted++;
    } catch (error) {
      console.error('Media import failed', error);
    }
  }

  if (!inserted) return 0;
  saveToLocal();
  commitHistory(before);
  redraw();
  requestLayersPanelRefresh();
  return inserted;
}

export function unsupportedMediaMessage(): string {
  return `Rimmap supports still images and vector files only (${supportedMediaSummary()}). ${unsupportedMotionSummary()}`;
}

export function showMediaImportFailure(source: 'drop' | 'clipboard' | 'picker'): void {
  const message = source === 'clipboard'
    ? `Rimmap could not import that clipboard media. ${unsupportedMediaMessage()}`
    : unsupportedMediaMessage();
  showToast(message, 'default', 3800);
}

export function showUnsupportedMediaWarning(count = 1): void {
  const prefix = count > 1 ? `${count} unsupported files were skipped.` : 'That file format is not supported.';
  showToast(`${prefix} ${unsupportedMediaMessage()}`, 'default', 4200);
}
