import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';

export function isDesktopApp(): boolean {
  return isTauri();
}

export type DesktopFileDropEvent =
  | { type: 'enter'; paths: string[]; clientX: number; clientY: number }
  | { type: 'over'; clientX: number; clientY: number }
  | { type: 'drop'; paths: string[]; clientX: number; clientY: number }
  | { type: 'leave' };

/**
 * Tauri intercepts native OS file drops on Windows before HTML5 drag/drop sees
 * them. Bridge the native event back into Rimmap using CSS/logical pixels so
 * the existing board coordinate system can be reused unchanged.
 */
export async function installDesktopFileDrop(
  handler: (event: DesktopFileDropEvent) => void | Promise<void>,
): Promise<void> {
  if (!isDesktopApp()) return;

  const appWindow = getCurrentWindow();
  let scaleFactor = await appWindow.scaleFactor();
  await appWindow.onScaleChanged(({ payload }) => {
    scaleFactor = payload.scaleFactor;
  });

  await getCurrentWebview().onDragDropEvent(async event => {
    const payload = event.payload;
    if (payload.type === 'leave') {
      await handler({ type: 'leave' });
      return;
    }

    const logical = payload.position.toLogical(scaleFactor);
    if (payload.type === 'over') {
      await handler({ type: 'over', clientX: logical.x, clientY: logical.y });
      return;
    }

    await handler({
      type: payload.type,
      paths: payload.paths,
      clientX: logical.x,
      clientY: logical.y,
    });
  });
}

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || path;
}

export async function chooseProjectSavePath(defaultFileName: string): Promise<string | null> {
  if (!isDesktopApp()) return null;
  return save({
    title: 'Save Rimmap board',
    defaultPath: defaultFileName,
    filters: [{ name: 'Rimmap board', extensions: ['zip'] }],
  });
}

export async function chooseProjectOpenPath(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  const selected = await open({
    title: 'Open Rimmap board',
    multiple: false,
    directory: false,
    filters: [
      { name: 'Rimmap board', extensions: ['zip', 'board', 'json'] },
    ],
  });
  return typeof selected === 'string' ? selected : null;
}

export async function readDesktopFile(path: string): Promise<Uint8Array> {
  return readFile(path);
}

export async function writeDesktopFile(path: string, data: Uint8Array): Promise<void> {
  await writeFile(path, data);
}

export async function requestDesktopClose(): Promise<void> {
  if (!isDesktopApp()) return;
  await getCurrentWindow().close();
}

export async function installDesktopCloseGuard(
  hasUnsavedChanges: () => boolean,
  onUnsavedCloseRequested: () => Promise<'close' | 'cancel'>,
): Promise<void> {
  if (!isDesktopApp()) return;
  const window = getCurrentWindow();
  let closePromptOpen = false;
  await window.onCloseRequested(async event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    try {
      const result = await onUnsavedCloseRequested();
      if (result === 'close') await window.destroy();
    } finally {
      closePromptOpen = false;
    }
  });
}
