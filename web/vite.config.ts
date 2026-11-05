import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const web = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: web,
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 65536,
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
