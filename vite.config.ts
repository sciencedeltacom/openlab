import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/** Port the Tauri shell points at (`devUrl` in src-tauri/tauri.conf.json). */
const DEV_PORT = 1420;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // Tauri prints the Rust compiler output; clearing the screen would hide it.
  clearScreen: false,
  server: {
    port: DEV_PORT,
    // Tauri fails with a clear error if the port moves, so never fall back.
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // The Tauri webviews are the floor: macOS WKWebView, WebView2, WebKitGTK.
    target: ['es2022', 'chrome105', 'safari15'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
