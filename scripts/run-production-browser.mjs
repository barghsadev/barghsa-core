import { spawn } from 'node:child_process';
import { createStaticServer } from '../apps/web/server.js';

const server = createStaticServer();
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
        env: { ...process.env, PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${server.address().port}` },
      }
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
