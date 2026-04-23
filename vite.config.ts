import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  version: string;
};
const appChannel = process.env.APP_CHANNEL ?? 'dev';
const appBuildTime = process.env.APP_BUILD_TIME ?? new Date().toISOString();
const appVersion = process.env.APP_VERSION ?? packageJson.version;

export default defineConfig({
  base: './',
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
  },
  define: {
    __APP_CHANNEL__: JSON.stringify(appChannel),
    __APP_BUILD_TIME__: JSON.stringify(appBuildTime),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
    },
  },
});
