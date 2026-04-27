import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve('src/app.ts'),
      formats: ['es'],
      fileName: 'app',
    },
    outDir: resolve('dist'),
    emptyOutDir: true,
  },
});
