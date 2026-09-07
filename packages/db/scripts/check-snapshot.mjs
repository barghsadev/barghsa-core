import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Generate in an isolated copy. A check must never create a product migration.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'barghsa-snapshot-check-'));
const output = join(scratch, 'migrations');
function files(folder) {
  return Object.fromEntries(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [
          path.slice(folder.length + 1),
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b))
  );
}
try {
  cpSync(join(root, 'drizzle/production'), output, { recursive: true });
  const before = files(output);
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/drizzle-kit/bin.cjs'),
      'generate',
      '--dialect',
      'postgresql',
      '--schema',
      join(root, 'src/schema/!(*.test).ts'),
      '--out',
      relative(root, output),
      '--name',
      'snapshot_check',
    ],
    { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }
  );
  if (result.error || result.status !== 0 || result.stderr.trim())
    throw new Error(result.error?.message ?? result.stderr + result.stdout);
  if (JSON.stringify(before) !== JSON.stringify(files(output)))
    throw new Error(
      'Schema differs from the committed migration snapshot. Generate and review the required migration and snapshot.\n' +
        result.stdout
    );
  if (!result.stdout.includes('No schema changes'))
    throw new Error('Generator did not confirm an unchanged schema.\n' + result.stdout);
  console.log('Database schema matches the committed snapshot; generation made no changes.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
