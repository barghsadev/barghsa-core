import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { collectBrowserCoverage } from './collect-browser-coverage.mjs';
import { mergeBrowserCoverage } from './merge-browser-coverage.mjs';

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'barghsa-browser-coverage-')));
  try {
    const distDir = join(root, 'apps/web/dist-coverage');
    const rawDir = join(root, 'raw');
    const output = join(root, 'mapped.json');
    const source = join(root, 'apps/web/src/sample.ts');
    const code = 'globalThis.fixture = 1;';
    await mkdir(join(distDir, 'assets'), { recursive: true });
    await mkdir(join(root, 'apps/web/src'), { recursive: true });
    await mkdir(rawDir);
    await writeFile(source, code);
    const asset = join(distDir, 'assets/sample.js');
    await writeFile(asset, code);
    await writeFile(
      asset + '.map',
      JSON.stringify({
        version: 3,
        file: 'sample.js',
        names: [],
        sources: ['../../src/sample.ts'],
        sourcesContent: [code],
        mappings: 'AAAA' + ',CAAC'.repeat(code.length - 1),
      })
    );
    const entries = [
      {
        url: 'http://127.0.0.1:1234/assets/sample.js',
        scriptId: '1',
        source: code,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    ];
    const raw = join(rawDir, 'test.json');
    await writeFile(join(root, '.gitignore'), 'raw/\nmapped.json\ncoverage/\n');
    const git = (...args) =>
      execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    git('init');
    git('config', 'user.name', 'Coverage fixture');
    git('config', 'user.email', 'coverage@example.invalid');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const record = {
      schema_version: 1,
      application_origin: 'http://127.0.0.1:1234',
      head_sha: git('rev-parse', 'HEAD'),
      working_tree_dirty: false,
      entries,
    };
    await writeFile(raw, JSON.stringify(record));
    await run({
      root,
      distDir,
      rawDir,
      output,
      source,
      asset,
      raw,
      entries,
      record,
      headSha: git('rev-parse', 'HEAD'),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('maps real V8 ranges and merges hits while retaining uncovered unit source', async () => {
  await fixture(async (options) => {
    const report = await collectBrowserCoverage(options);
    assert.equal(report.status, 'mapped');
    assert.equal(report.working_tree_dirty, false);
    assert.ok(Object.values(report.coverage[options.source].s).some((hit) => hit > 0));
    const unit = structuredClone(report.coverage);
    for (const entry of Object.values(unit))
      for (const key of Object.keys(entry.s)) entry.s[key] = 0;
    const untouched = join(options.root, 'apps/web/src/untouched.ts');
    unit[untouched] = { ...structuredClone(unit[options.source]), path: untouched };
    const target = join(options.root, 'apps/web/coverage/coverage-final.json');
    await mkdir(join(options.root, 'apps/web/coverage'));
    await writeFile(target, JSON.stringify(unit));
    assert.deepEqual(await mergeBrowserCoverage({ ...options, report }), ['apps/web']);
    const merged = JSON.parse(await readFile(target, 'utf8'));
    assert.ok(Object.values(merged[options.source].s).some((hit) => hit > 0));
    assert.ok(Object.values(merged[untouched].s).every((hit) => hit === 0));
  });
});

test('merges compiler end-column differences without duplicating branch denominators', async () => {
  await fixture(async (options) => {
    const report = await collectBrowserCoverage(options);
    const browser = report.coverage[options.source];
    const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } };
    browser.branchMap = {
      0: { type: 'if', loc, locations: [loc, { start: {}, end: {} }] },
    };
    browser.b = { 0: [2, 0] };
    const unit = structuredClone(browser);
    unit.branchMap[0].loc.end.column = null;
    unit.branchMap[0].locations[0].end.column = null;
    unit.b[0] = [0, 3];
    const target = join(options.root, 'apps/web/coverage/coverage-final.json');
    await mkdir(join(options.root, 'apps/web/coverage'));
    await writeFile(target, JSON.stringify({ [options.source]: unit }));
    await mergeBrowserCoverage({ ...options, report });
    const merged = JSON.parse(await readFile(target, 'utf8'))[options.source];
    assert.deepEqual(Object.values(merged.b), [[2, 3]]);
    assert.equal(Object.keys(merged.branchMap).length, 1);
    assert.deepEqual(browser.b[0], [2, 0]);
  });
});

test('missing maps, empty records and source mismatches invalidate previous output', async () => {
  for (const failure of ['asset', 'map', 'empty', 'mismatch', 'range', 'revision']) {
    await fixture(async (options) => {
      await collectBrowserCoverage(options);
      if (failure === 'asset') await rm(options.asset);
      if (failure === 'map') await rm(options.asset + '.map');
      if (failure === 'empty') await rm(options.raw);
      if (failure === 'mismatch') options.entries[0].source = 'different';
      if (failure === 'range') options.entries[0].functions[0].ranges[0].count = -1;
      if (failure === 'revision') options.record.head_sha = 'old-revision';
      if (failure === 'mismatch' || failure === 'range' || failure === 'revision')
        await writeFile(options.raw, JSON.stringify(options.record));
      await assert.rejects(collectBrowserCoverage(options));
      assert.equal(JSON.parse(await readFile(options.output, 'utf8')).status, 'invalid');
    });
  }
});

test('separate component servers are excluded from application coverage explicitly', async () => {
  await fixture(async (options) => {
    options.entries.push({
      ...options.entries[0],
      url: 'http://127.0.0.1:9999/assets/component-only.js',
    });
    await writeFile(options.raw, JSON.stringify(options.record));
    const report = await collectBrowserCoverage(options);
    assert.equal(report.asset_count, 1);
    assert.equal(report.ignored_non_application_scripts, 1);
  });
});

test('optional discarded source contributes no hits and is reported as unmeasured', async () => {
  await fixture(async (options) => {
    options.entries[0].functions[0].ranges[0].count = 0;
    const discarded = structuredClone(options.entries[0]);
    delete discarded.source;
    discarded.functions[0].ranges[0].count = 100;
    options.entries.push(discarded);
    await writeFile(options.raw, JSON.stringify(options.record));
    const report = await collectBrowserCoverage(options);
    assert.equal(report.unmeasured_missing_source_scripts, 1);
    assert.ok(Object.values(report.coverage[options.source].s).every((hit) => hit === 0));
  });
});

test('dirty or wrong revision and absent unit coverage fail without overwriting reports', async () => {
  await fixture(async (options) => {
    const report = await collectBrowserCoverage(options);
    for (const patch of [
      { working_tree_dirty: true },
      { head_sha: 'wrong' },
      { status: 'invalid' },
      { coverage: {} },
    ]) {
      await assert.rejects(mergeBrowserCoverage({ ...options, report: { ...report, ...patch } }));
    }
    await assert.rejects(mergeBrowserCoverage({ ...options, report }));
  });
});

test('requires a coverage record for every completed browser check', async () => {
  await fixture(async (options) => {
    await assert.rejects(collectBrowserCoverage({ ...options, minimumRecords: 2 }));
    assert.equal(JSON.parse(await readFile(options.output, 'utf8')).status, 'invalid');
    await assert.rejects(
      collectBrowserCoverage({
        ...options,
        resultsPath: join(options.root, 'missing-results.json'),
      })
    );
  });
});

test('rejects failed, flaky, skipped, empty or malformed browser summaries', async () => {
  await fixture(async (options) => {
    const resultsPath = join(options.rawDir, 'results-summary.txt');
    const passing = { expected: 1, unexpected: 0, flaky: 0, skipped: 0 };
    for (const stats of [
      { ...passing, unexpected: 1 },
      { ...passing, flaky: 1 },
      { ...passing, skipped: 1 },
      { ...passing, expected: 0 },
      { expected: 1 },
      { ...passing, expected: '1' },
    ]) {
      await writeFile(resultsPath, JSON.stringify({ stats, errors: [] }));
      await assert.rejects(collectBrowserCoverage({ ...options, resultsPath }));
      assert.equal(JSON.parse(await readFile(options.output, 'utf8')).status, 'invalid');
    }
    await writeFile(
      resultsPath,
      JSON.stringify({ stats: passing, errors: [{ message: 'setup failed' }] })
    );
    await assert.rejects(collectBrowserCoverage({ ...options, resultsPath }));
    await writeFile(resultsPath, JSON.stringify({ stats: passing, errors: [] }));
    assert.equal((await collectBrowserCoverage({ ...options, resultsPath })).status, 'mapped');
  });
});

test('chains workspace package maps to TypeScript and rejects missing intermediate maps', async () => {
  await fixture(async (options) => {
    const source = join(options.root, 'packages/i18n/src/sample.ts');
    const compiled = join(options.root, 'packages/i18n/dist/sample.js');
    await mkdir(join(options.root, 'packages/i18n/src'), { recursive: true });
    await mkdir(join(options.root, 'packages/i18n/dist'), { recursive: true });
    await writeFile(source, options.entries[0].source);
    await writeFile(compiled, options.entries[0].source);
    const map = JSON.parse(await readFile(options.asset + '.map', 'utf8'));
    await writeFile(compiled + '.map', JSON.stringify({ ...map, sources: ['../src/sample.ts'] }));
    await writeFile(
      options.asset + '.map',
      JSON.stringify({ ...map, sources: [pathToFileURL(compiled).href] })
    );
    const report = await collectBrowserCoverage(options);
    assert.ok(report.coverage[source]);
    assert.equal(report.coverage[compiled], undefined);
    await rm(compiled + '.map');
    await assert.rejects(collectBrowserCoverage(options));
    assert.equal(JSON.parse(await readFile(options.output, 'utf8')).status, 'invalid');
  });
});

async function componentFixture(options) {
  const directory = 'component-calendar-fixture';
  const build = join(options.rawDir, 'builds', directory);
  const asset = join(build, 'assets', 'component.js');
  await mkdir(join(build, 'assets'), { recursive: true });
  await writeFile(asset, options.entries[0].source);
  const map = JSON.parse(await readFile(options.asset + '.map', 'utf8'));
  map.sources = [pathToFileURL(options.source).href];
  await writeFile(asset + '.map', JSON.stringify(map));
  options.record.component_builds = [{ origin: 'http://127.0.0.1:9999', directory }];
  options.entries.push({
    ...structuredClone(options.entries[0]),
    url: 'http://127.0.0.1:9999/assets/component.js',
  });
  await writeFile(options.raw, JSON.stringify(options.record));
  return { asset, build };
}

test('counts registered component production assets only after exact source verification', async () => {
  await fixture(async (options) => {
    const baseline = await collectBrowserCoverage(options);
    const { asset } = await componentFixture(options);
    const report = await collectBrowserCoverage(options);
    assert.equal(report.asset_count, 2);
    assert.equal(report.component_asset_count, 1);
    assert.equal(report.ignored_non_application_scripts, 0);
    assert.ok(
      Object.values(report.coverage[options.source].s).reduce((a, b) => a + b, 0) >
        Object.values(baseline.coverage[options.source].s).reduce((a, b) => a + b, 0)
    );
    await writeFile(asset, 'mismatched build');
    await assert.rejects(collectBrowserCoverage(options), /differs from built asset/);
    assert.equal(JSON.parse(await readFile(options.output, 'utf8')).status, 'invalid');
  });
});

test('rejects malformed component registries, escaped paths, foreign origins and absent maps', async () => {
  for (const failure of [
    'registry',
    'directory',
    'origin',
    'duplicate',
    'missing',
    'map',
    'symlink',
  ]) {
    await fixture(async (options) => {
      const { asset, build } = await componentFixture(options);
      const registration = options.record.component_builds[0];
      if (failure === 'registry') options.record.component_builds = {};
      if (failure === 'directory') registration.directory = '../dist-coverage';
      if (failure === 'origin') registration.origin = 'https://example.com';
      if (failure === 'duplicate') registration.origin = options.record.application_origin;
      if (failure === 'missing') registration.directory = 'component-missing';
      if (failure === 'map') await rm(asset + '.map');
      if (failure === 'symlink') {
        await rm(build, { recursive: true });
        await symlink(options.distDir, build);
      }
      await writeFile(options.raw, JSON.stringify(options.record));
      await assert.rejects(collectBrowserCoverage(options));
      assert.equal(JSON.parse(await readFile(options.output, 'utf8')).status, 'invalid');
    });
  }
});
