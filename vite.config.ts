import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const tauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: tauri
        ? { main: resolve(import.meta.dirname, 'index.html'), overlay: resolve(import.meta.dirname, 'overlay.html') }
        : { main: resolve(import.meta.dirname, 'index.html') },
    },
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
