import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function setup() {
  execFileSync('pnpm', ['--filter', '@barghsa/worker...', 'build'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    stdio: 'pipe',
  });
}
