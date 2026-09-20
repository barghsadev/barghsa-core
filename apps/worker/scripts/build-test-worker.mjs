import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function setup() {
  // CI builds this exact checkout before parallel tests; rebuilding here removes
  // shared outputs while other suites import them. Standalone runs still build.
  if (process.env['BARGHSA_TEST_PREBUILT'] === '1') return;
  execFileSync('pnpm', ['--filter', '@barghsa/worker...', 'build'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    stdio: 'pipe',
  });
}
