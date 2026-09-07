import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Copied source assets need exact byte identity; compiled modules still require maps. */
export async function readProcessCoverageSource(filename, root, copiedSources = {}) {
  const code = await readFile(filename, 'utf8');
  for (const [output, source] of Object.entries(copiedSources)) {
    if (filename !== resolve(root, output)) continue;
    const original = resolve(root, source);
    if (code !== (await readFile(original, 'utf8')))
      throw new Error(`Copied process asset differs from source: ${filename}`);
    return { url: pathToFileURL(original).href, code, map: undefined };
  }
  const url = pathToFileURL(filename).href;
  const map = JSON.parse(await readFile(filename + '.map', 'utf8'));
  map.sources = map.sources.map((source) => new URL(source, url).href);
  return { url, code, map };
}
