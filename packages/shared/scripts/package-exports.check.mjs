import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

for (const subpath of Object.keys(pkg.exports).filter((path) => path !== './package.json')) {
  const specifier = pkg.name + (subpath === '.' ? '' : subpath.slice(1));
  test(`${specifier} loads through import and require with matching exports`, async () => {
    const esm = await import(specifier);
    const cjs = require(specifier);
    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
  });
}

test('root and subpath imports share module state within each format', async () => {
  const esm = await import('@barghsa/shared');
  const esmErrors = await import('@barghsa/shared/errors');
  const cjs = require('@barghsa/shared');
  const cjsErrors = require('@barghsa/shared/errors');
  assert.equal(esm.ErrorCodes, esmErrors.ErrorCodes);
  assert.equal(cjs.ErrorCodes, cjsErrors.ErrorCodes);
  assert.equal(esm.validatePostalCode('1234567890'), true);
  assert.equal(cjs.validatePostalCode('0123456789'), false);
});

test('TypeScript resolves ESM and CommonJS declarations with strict checking', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = mkdtempSync(join(root, '.build-cjs-types-'));
  try {
    const source = `
      import { validatePostalCode } from '@barghsa/shared';
      import { ErrorCodes } from '@barghsa/shared/errors';
      const valid: boolean = validatePostalCode('1234567890');
      const code: string = ErrorCodes.AUTHZ_FORBIDDEN.code;
      // @ts-expect-error Exported functions must not degrade to any.
      const invalid: number = validatePostalCode('1234567890');
      void [valid, code, invalid];
    `;
    for (const extension of ['mts', 'cts'])
      writeFileSync(join(scratch, `consumer.${extension}`), source);
    writeFileSync(
      join(scratch, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
        include: ['consumer.mts', 'consumer.cts'],
      })
    );
    const result = spawnSync('tsc', ['-p', join(scratch, 'tsconfig.json')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
