import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** Compress the hashed JS and CSS produced by the two Vite builds. */
export async function compressStaticAssets(distDir) {
  for (const directory of [join(distDir, 'assets'), join(distDir, 'auth', 'assets')]) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || !/-[a-zA-Z0-9_-]{8,}\.(js|css)$/.test(file.name)) continue;
      const path = join(directory, file.name);
      const original = await readFile(path);
      for (const [suffix, bytes] of [
        ['gz', gzipSync(original, { level: 9 })],
        [
          'br',
          brotliCompressSync(original, {
            params: {
              [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
              [constants.BROTLI_PARAM_QUALITY]: 8,
            },
          }),
        ],
      ]) {
        if (bytes.length < original.length) await writeFile(`${path}.${suffix}`, bytes);
      }
    }
  }
}
