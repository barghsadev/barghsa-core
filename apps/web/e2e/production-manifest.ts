import { readFile } from 'node:fs/promises';

export async function productionManifest(): Promise<Record<string, { file: string }>> {
  const dist = process.env['BARGHSA_BROWSER_COVERAGE_DIR'] ? 'dist-coverage' : 'dist';
  return JSON.parse(
    await readFile(new URL(`../${dist}/.vite/manifest.json`, import.meta.url), 'utf8')
  );
}
