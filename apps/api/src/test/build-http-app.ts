import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

/** HTTP integration tests must never silently exercise stale compiled code. */
export function setup(): void {
  const require = createRequire(__filename)
  execFileSync(process.execPath, [require.resolve('@nestjs/cli/bin/nest.js'), 'build'], {
    cwd: resolve(__dirname, '../..'), stdio: 'pipe',
  })
}
