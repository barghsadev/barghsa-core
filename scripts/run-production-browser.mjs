import { spawn, execFileSync } from 'node:child_process';
import { createStaticServer } from '../apps/web/server.js';
import { fileURLToPath } from 'node:url';

const collecting = process.env.BARGHSA_BROWSER_COVERAGE === '1';
const root = fileURLToPath(new URL('..', import.meta.url));
const revision = collecting
  ? execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  : '';
const dirty = collecting
  ? execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== ''
  : false;
const server = createStaticServer(
  collecting
    ? { distDir: fileURLToPath(new URL('../apps/web/dist-coverage', import.meta.url)) }
    : {}
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        '--filter',
        '@barghsa/web',
        'exec',
        'playwright',
        'test',
        ...process.argv.slice(2),
        '--project',
        'chromium',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${server.address().port}`,
          ...(collecting
            ? {
                BARGHSA_BROWSER_COVERAGE_DIR: fileURLToPath(
                  new URL('../apps/web/test-results/v8-coverage', import.meta.url)
                ),
                BARGHSA_BROWSER_COVERAGE_HEAD: revision,
                BARGHSA_BROWSER_COVERAGE_DIRTY: String(dirty),
              }
            : {}),
        },
      }
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
