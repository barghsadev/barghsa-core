import { readFile, readdir, mkdir, writeFile, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, sep, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';
import { mergeProcessCovs } from '@bcoe/v8-coverage';
import { convert } from 'ast-v8-to-istanbul';
import coverageLibrary from 'istanbul-lib-coverage';
import remapping from '@jridgewell/remapping';

const sourcePattern = /^(apps\/web|packages\/(ui|i18n|shared))\/src\//;

export async function collectBrowserCoverage({
  root,
  distDir,
  rawDir,
  output,
  minimumRecords = 0,
  resultsPath,
}) {
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify({ schema_version: 1, status: 'invalid' }) + '\n');
  if (resultsPath) {
    const results = JSON.parse(await readFile(resultsPath, 'utf8'));
    const stats = results.stats;
    if (
      !stats ||
      !Number.isSafeInteger(stats.expected) ||
      stats.expected <= 0 ||
      stats.unexpected !== 0 ||
      stats.flaky !== 0 ||
      stats.skipped !== 0 ||
      !Array.isArray(results.errors) ||
      results.errors.length !== 0
    )
      throw new Error('Browser coverage requires a complete passing test run');
    minimumRecords = stats.expected;
  }
  const files = (await readdir(rawDir)).filter((name) => name.endsWith('.json'));
  if (!files.length) throw new Error('No browser coverage records');
  if (!Number.isSafeInteger(minimumRecords) || minimumRecords < 0 || files.length < minimumRecords)
    throw new Error('Missing coverage records for completed browser tests');
  const scripts = new Map();
  const headSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  let recordedDirty = false;
  let ignoredScripts = 0;
  let missingSources = 0;
  const componentAssets = new Set();
  let merged = { result: [] };
  for (const name of files) {
    const record = JSON.parse(await readFile(join(rawDir, name), 'utf8'));
    if (
      record.schema_version !== 1 ||
      record.head_sha !== headSha ||
      typeof record.working_tree_dirty !== 'boolean'
    )
      throw new Error('Browser records belong to an unknown or different revision');
    if (
      typeof record.application_origin !== 'string' ||
      new URL(record.application_origin).origin !== record.application_origin
    )
      throw new Error('Missing application origin');
    const roots = new Map([[record.application_origin, distDir]]);
    if (record.component_builds !== undefined && !Array.isArray(record.component_builds))
      throw new Error('Invalid component build registry');
    for (const build of record.component_builds ?? []) {
      if (
        !build ||
        typeof build.origin !== 'string' ||
        typeof build.directory !== 'string' ||
        !/^component-[a-zA-Z0-9_-]+$/.test(build.directory)
      )
        throw new Error('Invalid component build');
      const origin = new URL(build.origin);
      if (
        origin.origin !== build.origin ||
        origin.protocol !== 'http:' ||
        origin.hostname !== '127.0.0.1' ||
        !origin.port ||
        roots.has(build.origin)
      )
        throw new Error('Invalid component origin');
      const directory = resolve(rawDir, 'builds', build.directory);
      if ((await realpath(directory)) !== directory)
        throw new Error('Invalid component build path');
      roots.set(build.origin, directory);
    }
    recordedDirty ||= record.working_tree_dirty;
    const entries = record.entries;
    if (!Array.isArray(entries)) throw new Error('Invalid browser coverage records');
    const result = [];
    for (const entry of entries) {
      const url = new URL(entry.url);
      const assetRoot = roots.get(url.origin);
      if (!assetRoot) {
        ignoredScripts++;
        continue;
      }
      if (!url.pathname.startsWith('/assets/') || !url.pathname.endsWith('.js')) continue;
      const filename = resolve(assetRoot, '.' + decodeURIComponent(url.pathname));
      if (!filename.startsWith(resolve(assetRoot) + sep)) throw new Error('Invalid asset path');
      const code = await readFile(filename, 'utf8');
      // Chromium may discard source text after navigation. Such ranges cannot
      // prove execution against this build, so they contribute no coverage.
      if (entry.source === undefined) {
        missingSources++;
        continue;
      }
      if (entry.source !== code)
        throw new Error(`Browser source differs from built asset: ${filename}`);
      if (!Array.isArray(entry.functions)) throw new Error('Missing V8 functions');
      for (const fn of entry.functions) {
        if (!Array.isArray(fn.ranges) || !fn.ranges.length) throw new Error('Missing V8 ranges');
        for (const range of fn.ranges) {
          if (
            ![range.startOffset, range.endOffset, range.count].every(Number.isSafeInteger) ||
            range.count < 0 ||
            range.startOffset < 0 ||
            range.endOffset < range.startOffset ||
            range.endOffset > code.length
          )
            throw new Error('Invalid V8 range');
        }
      }
      const scriptUrl = pathToFileURL(filename).href;
      if (url.origin !== record.application_origin) componentAssets.add(scriptUrl);
      scripts.set(scriptUrl, code);
      result.push({ ...entry, url: scriptUrl });
    }
    merged = mergeProcessCovs([merged, { result }]);
  }
  if (!merged.result.length) throw new Error('No application assets in browser coverage');
  const coverage = coverageLibrary.createCoverageMap({});
  for (const entry of merged.result) {
    const filename = fileURLToPath(entry.url);
    const code = scripts.get(entry.url);
    const sourceMap = JSON.parse(await readFile(filename + '.map', 'utf8'));
    if (sourceMap.version !== 3 || !Array.isArray(sourceMap.sources))
      throw new Error('Invalid asset source map');
    sourceMap.sources = sourceMap.sources.map((source) => {
      const url = new URL(source, entry.url);
      // Split route modules map back to their canonical source file.
      url.search = '';
      return url.href;
    });
    const chainedMap = remapping(sourceMap, (source, context) => {
      const path = fileURLToPath(source);
      if (!path.startsWith(resolve(root) + sep)) return null;
      const relative = path.slice(resolve(root).length + 1);
      if (/^packages\/(i18n|shared)\/dist\/.+\.js$/.test(relative))
        return JSON.parse(readFileSync(path + '.map', 'utf8'));
      if (sourcePattern.test(relative) && context.content == null)
        context.content = readFileSync(path, 'utf8');
      return null;
    });
    coverage.merge(
      await convert({
        code,
        sourceMap: chainedMap,
        coverage: entry,
        ast: parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true }),
      })
    );
  }
  coverage.filter(
    (filename) =>
      sourcePattern.test(filename.slice(resolve(root).length + 1)) &&
      filename.startsWith(resolve(root) + sep)
  );
  if (!coverage.files().length) throw new Error('No workspace source mapped from browser coverage');
  const report = {
    schema_version: 1,
    status: 'mapped',
    head_sha: headSha,
    working_tree_dirty:
      recordedDirty ||
      execFileSync('git', ['-C', root, 'status', '--porcelain'], {
        encoding: 'utf8',
      }).trim() !== '',
    browser_record_count: files.length,
    asset_count: merged.result.length,
    component_asset_count: componentAssets.size,
    ignored_non_application_scripts: ignoredScripts,
    unmeasured_missing_source_scripts: missingSources,
    coverage: JSON.parse(JSON.stringify(coverage.toJSON())),
  };
  await writeFile(output, JSON.stringify(report) + '\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const report = await collectBrowserCoverage({
    root,
    distDir: resolve(root, 'apps/web/dist-coverage'),
    rawDir: resolve(root, 'apps/web/test-results/v8-coverage'),
    output: process.argv[2] || resolve(root, 'apps/web/test-results/browser-coverage.json'),
    resultsPath: resolve(root, 'apps/web/test-results/results.json'),
  });
  console.log(
    `Mapped ${report.browser_record_count} browser records to ${Object.keys(report.coverage).length} source files`
  );
}
