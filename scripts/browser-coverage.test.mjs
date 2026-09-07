import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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

test('missing maps, empty records and source mismatches invalidate previous output', async () => {
  for (const failure of ['map', 'empty', 'mismatch', 'range', 'revision']) {
    await fixture(async (options) => {
      await collectBrowserCoverage(options);
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
