import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function compile(config) {
  const result = spawnSync('tsc', ['-p', config], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Shared package compilation failed (${result.status})`);
}

rmSync(join(root, 'dist'), { recursive: true, force: true });
compile('tsconfig.build.json');

// NodeNext determines module kind from package scope. Compile the same sources
// in a CommonJS scope, preserving module boundaries and singleton identity.
const staging = mkdtempSync(join(root, '.build-cjs-'));
try {
  cpSync(join(root, 'src'), join(staging, 'src'), { recursive: true });
  writeFileSync(join(staging, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  writeFileSync(
    join(staging, 'tsconfig.json'),
    JSON.stringify({
      extends: '../tsconfig.build.json',
      compilerOptions: { rootDir: './src', outDir: '../dist/cjs' },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    })
  );
  compile(join(staging, 'tsconfig.json'));
  const manifest = join(root, 'dist/cjs/package.json');
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify({ type: 'commonjs' }) + '\n');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
