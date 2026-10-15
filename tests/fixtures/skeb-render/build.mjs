import { build } from 'astro';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = process.argv[2];
await build({
  root: dir, configFile: false, integrations: [react()],
  srcDir: fileURLToPath(new URL('./', import.meta.url)),
  outDir: join(dir, 'dist'), cacheDir: join(dir, 'cache'), publicDir: join(dir, 'public'),
  build: { inlineStylesheets: 'always' }, logLevel: 'silent',
});
