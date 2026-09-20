import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readProcessCoverageSource } from './process-coverage-source.mjs';

test('maps explicitly registered copied code only when its source bytes match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'process-asset-'));
  try {
    await mkdir(join(root, 'dist'));
    await mkdir(join(root, 'src'));
    const output = join(root, 'dist/parser.cjs');
    const source = join(root, 'src/parser.cjs');
    const code = 'module.exports = 1;\n';
    await writeFile(output, code);
    await writeFile(source, code);
    await assert.rejects(readProcessCoverageSource(output, root), /ENOENT/);
    const copied = { 'dist/parser.cjs': 'src/parser.cjs' };
    assert.deepEqual(await readProcessCoverageSource(output, root, copied), {
      url: pathToFileURL(source).href,
      code,
      map: undefined,
    });
    await writeFile(source, 'module.exports = 2;\n');
    await assert.rejects(readProcessCoverageSource(output, root, copied), /differs from source/);
    await rm(source);
    await assert.rejects(readProcessCoverageSource(output, root, copied), /ENOENT/);
    await writeFile(
      output + '.map',
      JSON.stringify({ version: 3, sources: ['../src/parser.ts'], mappings: '' })
    );
    assert.equal(
      (await readProcessCoverageSource(output, root)).map.sources[0],
      pathToFileURL(join(root, 'src/parser.ts')).href
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
