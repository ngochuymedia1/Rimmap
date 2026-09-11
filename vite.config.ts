import { defineConfig } from 'vite';

export default defineConfig({
  // Keep Tauri's Rust tree out of Vite's file watcher. The frontend remains a
  // normal Vite app in the browser and is reused unchanged inside Tauri.
  server: {
    host: '127.0.0.1',
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  // Release builds are static assets embedded by Tauri. Keep source maps only
  // for debug builds so the client-facing package stays compact.
  build: {
    sourcemap: process.env.TAURI_ENV_DEBUG === 'true',
    minify: process.env.TAURI_ENV_DEBUG === 'true' ? false : 'esbuild',
  },
});
