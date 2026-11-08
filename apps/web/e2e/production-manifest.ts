import { readFile } from 'node:fs/promises';

export async function productionManifest(
  entry: 'app' | 'auth' = 'app'
): Promise<Record<string, { file: string }>> {
  const dist = process.env['BARGHSA_BROWSER_COVERAGE_DIR'] ? 'dist-coverage' : 'dist';
  const directory = entry === 'auth' ? `${dist}/auth` : dist;
  return JSON.parse(
    await readFile(new URL(`../${directory}/.vite/manifest.json`, import.meta.url), 'utf8')
  );
}
