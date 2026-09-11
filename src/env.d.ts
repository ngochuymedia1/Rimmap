declare module '*.css';
declare module 'idb-keyval' {
  export function get<T = any>(key: IDBValidKey, store?: any): Promise<T | undefined>;
  export function set(key: IDBValidKey, value: any, store?: any): Promise<void>;
  export function del(key: IDBValidKey, store?: any): Promise<void>;
  export function keys(store?: any): Promise<IDBValidKey[]>;
}

declare module '@tauri-apps/api/core' {
  export function isTauri(): boolean;
}

declare module '@tauri-apps/api/window' {
  export type UnlistenFn = () => void;
  export interface CloseRequestedEvent {
    preventDefault(): void;
  }
  export interface AppWindow {
    close(): Promise<void>;
    destroy(): Promise<void>;
    scaleFactor(): Promise<number>;
    onCloseRequested(handler: (event: CloseRequestedEvent) => void | Promise<void>): Promise<UnlistenFn>;
    onScaleChanged(handler: (event: { payload: { scaleFactor: number } }) => void | Promise<void>): Promise<UnlistenFn>;
  }
  export function getCurrentWindow(): AppWindow;
}


declare module '@tauri-apps/api/webview' {
  export type UnlistenFn = () => void;
  export interface PhysicalPosition {
    x: number;
    y: number;
    toLogical(scaleFactor: number): { x: number; y: number };
  }
  export type DragDropEvent =
    | { type: 'enter'; paths: string[]; position: PhysicalPosition }
    | { type: 'over'; position: PhysicalPosition }
    | { type: 'drop'; paths: string[]; position: PhysicalPosition }
    | { type: 'leave' };
  export interface AppWebview {
    onDragDropEvent(handler: (event: { payload: DragDropEvent }) => void | Promise<void>): Promise<UnlistenFn>;
  }
  export function getCurrentWebview(): AppWebview;
}

declare module '@tauri-apps/plugin-dialog' {
  export type DialogFilter = { name: string; extensions: string[] };
  export function save(options?: { title?: string; defaultPath?: string; filters?: DialogFilter[] }): Promise<string | null>;
  export function open(options?: { title?: string; multiple?: boolean; directory?: boolean; filters?: DialogFilter[] }): Promise<string | string[] | null>;
}

declare module '@tauri-apps/plugin-fs' {
  export function readFile(path: string | URL): Promise<Uint8Array>;
  export function writeFile(path: string | URL, data: Uint8Array | ReadableStream<Uint8Array>): Promise<void>;
}
