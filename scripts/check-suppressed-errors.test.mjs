import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkSuppressedErrors } from './check-suppressed-errors.mjs';

async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'barghsa-suppressions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['apps', 'packages']) await mkdir(join(root, name));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

for (const directive of ['ignore', 'expect-error', 'nocheck']) {
  test(`rejects ${directive} in production files, including spaces in paths`, async (t) => {
    const root = await fixture(t, {
      'apps/my app/src/file.tsx': `// @ts-${directive}\nexport {};`,
    });
    assert.deepEqual(await checkSuppressedErrors(root), [
      `apps/my app/src/file.tsx:1: @ts-${directive}`,
    ]);
  });
}

test('does not scan test fixtures or build outputs', async (t) => {
  const files = Object.fromEntries(
    [
      'apps/a/src/unit.test.ts',
      'apps/a/src/unit.spec.tsx',
      'packages/a/types.test-d.ts',
      'apps/a/test/fixture.ts',
      'packages/a/__tests__/fixture.ts',
      'apps/a/dist/index.ts',
      'packages/a/node_modules/lib/index.ts',
    ].map((name) => [name, '// @ts-nocheck'])
  );
  const root = await fixture(t, files);
  assert.deepEqual(await checkSuppressedErrors(root), []);
});

test('limits generated exemption to nocheck in the exact router file', async (t) => {
  const root = await fixture(t, {
    'apps/web/src/routeTree.gen.ts': '// @ts-nocheck\n// @ts-ignore',
    'apps/web/src/other.gen.ts': '// @ts-nocheck',
  });
  assert.deepEqual(await checkSuppressedErrors(root), [
    'apps/web/src/other.gen.ts:1: @ts-nocheck',
    'apps/web/src/routeTree.gen.ts:2: @ts-ignore',
  ]);
});

test('fails when an expected scan root is missing', async (t) => {
  const root = await fixture(t);
  await rm(join(root, 'packages'), { recursive: true });
  await assert.rejects(checkSuppressedErrors(root), /ENOENT/);
});

test('fails on broken source links instead of silently omitting them', async (t) => {
  const root = await fixture(t);
  await symlink(join(root, 'missing'), join(root, 'apps', 'source.ts'));
  await assert.rejects(checkSuppressedErrors(root), /Cannot inspect symbolic link/);
});

test('scans module source variants and preserves line numbers', async (t) => {
  const root = await fixture(t, {
    'packages/a/source.mts': '\r\n/* @ts-ignore */\r\n// @ts-nocheck',
  });
  assert.deepEqual(await checkSuppressedErrors(root), [
    'packages/a/source.mts:2: @ts-ignore',
    'packages/a/source.mts:3: @ts-nocheck',
  ]);
});
