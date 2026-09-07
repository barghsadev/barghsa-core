import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
for (const path of ['@barghsa/ui', '@barghsa/ui/direction-provider']) {
  test(`${path} loads matching ESM and CommonJS exports`, async () => {
    assert.deepEqual(Object.keys(await import(path)).sort(), Object.keys(require(path)).sort());
  });
}
for (const format of ['import', 'require']) {
  test(`${format} components render with the consumer's React runtime`, async () => {
    const ui = format === 'import' ? await import('@barghsa/ui') : require('@barghsa/ui');
    assert.match(
      renderToStaticMarkup(createElement(ui.PageLoading, { label: 'Loading' })),
      /role="status"/
    );
    assert.match(
      renderToStaticMarkup(
        createElement(ui.EmptyState, {
          title: 'No invoices',
          description: 'Complete a purchase first.',
        })
      ),
      /No invoices/
    );
  });
}
test('ESM and CommonJS consumers resolve strict public prop types', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = mkdtempSync(join(root, '.distribution-'));
  try {
    const source = `
      import type { EmptyStateProps, ErrorBoundaryProps } from '@barghsa/ui';
      import { DirectionProvider } from '@barghsa/ui/direction-provider';
      const empty: EmptyStateProps = { title: 'None', description: 'Try a different filter.' };
      // @ts-expect-error Required guidance must remain typed.
      const invalid: EmptyStateProps = { title: 123 };
      const retry: ErrorBoundaryProps['onReset'] = () => {};
      void [empty, invalid, retry, DirectionProvider];
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
    for (const compiler of ['tsc', join(root, '../../node_modules/.bin/tsc')]) {
      const result = spawnSync(compiler, ['-p', join(scratch, 'tsconfig.json')], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
