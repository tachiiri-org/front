import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve('src/web/client.ts'),
      formats: ['es'],
      fileName: 'client',
    },
    outDir: resolve('dist'),
    emptyOutDir: true,
  },
});
