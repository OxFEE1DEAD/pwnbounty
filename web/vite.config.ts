import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const web = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: web,
  publicDir: false,
  plugins: [react()],
  server: { proxy: { '/v1': 'http://127.0.0.1:8787' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: 'style.css',
        inlineDynamicImports: true,
      },
    },
  },
});
