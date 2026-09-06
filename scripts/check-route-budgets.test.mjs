import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { checkBudgets, measureRoute } from './check-route-budgets.mjs';

test('common dependencies count once, an oversized common chunk fails, and missing routes fail closed', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'barghsa-budget-'));
  try {
    await mkdir(join(dist, '.vite'));
    const manifest = {
      'index.html': { file: 'entry.js', imports: ['common'] },
      login: { file: 'login.js', imports: ['common', 'index.html'] },
      common: { file: 'common.js' },
    };
    const contents = {
      'entry.js': 'export const entry=1;',
      'login.js': 'export const login=1;',
      'common.js': 'export const common=1;',
    };
    for (const [file, content] of Object.entries(contents))
      await writeFile(join(dist, file), content);
    await writeFile(join(dist, '.vite/manifest.json'), JSON.stringify(manifest));
    const measured = await measureRoute(dist, manifest, ['login']);
    assert.equal(
      measured.bytes,
      Object.values(contents).reduce((sum, content) => sum + gzipSync(content).length, 0)
    );
    const rules = [{ name: 'login', entries: ['login'], limitKB: 1 }];
    assert.equal((await checkBudgets(dist, rules))[0].pass, true);
    await writeFile(join(dist, 'common.js'), randomBytes(3000));
    assert.equal((await checkBudgets(dist, rules))[0].pass, false);
    await assert.rejects(measureRoute(dist, manifest, ['missing']), /Missing manifest entry/);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});
