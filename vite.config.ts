import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    lib: {
      entry: resolve('src/web/client.ts'),
      formats: ['es'],
      fileName: 'client',
    },
    outDir: resolve('dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
      },
    },
  },
});
