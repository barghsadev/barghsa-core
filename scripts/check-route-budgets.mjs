import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Count each emitted file once, including the bootstrap, layout, and every
// static dependency. Explicit interaction entries have their own enforced
// budgets. Static imports of those entries still count against the page.
export async function measureRoute(
  dist,
  manifest,
  roots,
  { includeBootstrap = true, deferredEntries = [] } = {}
) {
  const deferred = new Set(deferredEntries);
  const seen = new Set(),
    files = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Missing manifest entry: ${key}`);
    seen.add(key);
    files.add(entry.file);
    for (const dependency of entry.imports ?? []) visit(dependency);
    if (key !== 'index.html')
      for (const dependency of entry.dynamicImports ?? []) {
        if (
          dependency !== 'src/components/RegistrationTermsDialog.tsx' &&
          !deferred.has(dependency)
        )
          visit(dependency);
      }
  }
  for (const root of [...(includeBootstrap ? ['index.html'] : []), ...roots]) visit(root);
  let bytes = 0;
  for (const file of files) {
    if (!file.endsWith('.js')) throw new Error(`Expected JavaScript entry: ${file}`);
    bytes += gzipSync(await readFile(resolve(dist, file))).length;
  }
  return { bytes, files: [...files].sort() };
}

export async function checkBudgets(dist, config) {
  if (!Array.isArray(config) || !config.length) throw new Error('No route budgets configured');
  for (const rule of config) {
    if (rule.phase !== undefined && !['initial', 'interaction'].includes(rule.phase))
      throw new Error(`Invalid budget phase: ${rule.name}`);
    if (rule.phase === 'interaction' && rule.routePrefix)
      throw new Error(`Interaction budgets require explicit entries: ${rule.name}`);
  }
  const interactionEntries = config
    .filter((rule) => rule.phase === 'interaction')
    .flatMap((rule) => rule.entries);
  const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8'));
  const results = [];
  const rules = config.flatMap((rule) => {
    if (!rule.routePrefix) return [rule];
    const routes = Object.keys(manifest).filter(
      (key) => key.startsWith(rule.routePrefix) && key.endsWith('?tsr-split=component')
    );
    if (!routes.length) throw new Error(`No routes match: ${rule.routePrefix}`);
    return routes.map((route) => {
      const parents = [];
      let path = route.split('.tsx?')[0];
      while (path.includes('/')) {
        path = path.slice(0, path.lastIndexOf('/'));
        const parent = path + '.tsx?tsr-split=component';
        if (manifest[parent]) parents.push(parent);
      }
      return {
        ...rule,
        name: `${rule.name}: ${route}`,
        entries: [...rule.entries, ...parents, route],
      };
    });
  });
  for (const rule of rules) {
    const measured = await measureRoute(dist, manifest, rule.entries, {
      includeBootstrap: rule.phase !== 'interaction',
      deferredEntries: rule.phase === 'interaction' ? [] : interactionEntries,
    });
    const limit = rule.limitKB * 1000;
    if (!Number.isFinite(limit) || limit <= 0) throw new Error(`Invalid budget: ${rule.name}`);
    results.push({ name: rule.name, ...measured, limit, pass: measured.bytes < limit });
  }
  return results;
}

// Feed the complete manifest-resolved payload to the required Size Limit CLI.
// Keep the existing default-gzip check too: Size Limit uses level 9, so it must
// not weaken the current gate by granting credit for stronger compression.
export async function verifyWithSizeLimit(dist, results) {
  if (!results.length) throw new Error('No route budgets to verify with Size Limit');
  const assets = new Set(
    results.flatMap((result) => result.files.map((file) => resolve(dist, file)))
  );
  for (const asset of assets) {
    const info = await stat(asset).catch(() => null);
    if (!info?.isFile()) throw new Error(`Unavailable Size Limit asset: ${asset}`);
  }
  const temporary = await mkdtemp(resolve(tmpdir(), 'barghsa-size-limit-'));
  try {
    const config = results.map((result) => ({
      name: result.name,
      path: result.files.map((file) => resolve(dist, file)),
      limit: `${result.limit} B`,
      gzip: true,
    }));
    const configPath = resolve(temporary, '.size-limit.json');
    await writeFile(configPath, JSON.stringify(config));
    const cli = fileURLToPath(new URL('./bin.js', import.meta.resolve('size-limit/package.json')));
    try {
      await promisify(execFile)(process.execPath, [cli, '--config', configPath, '--json'], {
        maxBuffer: 2 * 1024 * 1024,
        timeout: 60_000,
      });
    } catch (error) {
      throw new Error(
        `Size Limit rejected route budgets: ${error.stdout?.trim() || error.stderr?.trim() || error.message}`
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(await readFile('.size-limit.json', 'utf8'));
    const results = await checkBudgets('apps/web/dist', config);
    for (const result of results) {
      console.log(
        `${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${(result.bytes / 1000).toFixed(2)} KB gzip / ${result.limit / 1000} KB (${result.files.length} files)`
      );
    }
    await verifyWithSizeLimit('apps/web/dist', results);
    console.log(`PASS Size Limit: ${results.length} route and interaction gzip budgets`);
    if (results.some((result) => !result.pass)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
