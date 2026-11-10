import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { compressStaticAssets } from './compress-static-assets.mjs';
import { writeHistoryPreloads } from './history-preloads.mjs';

// Build the application first: its clean output directory contains the auth build.
await build({ mode: 'production' });
await build({ mode: 'auth' });
if (process.env['BARGHSA_BROWSER_COVERAGE'] !== '1') {
  const distDir = fileURLToPath(new URL('./dist/', import.meta.url));
  await writeHistoryPreloads(distDir);
  await compressStaticAssets(distDir);
}
