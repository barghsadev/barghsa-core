import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrations, type MigrationOptions } from '../migrate';

/** Rehearse an exact historical upgrade using unmodified production SQL and journal entries. */
export async function runMigrationPrefix(
  through: string,
  options: Omit<MigrationOptions, 'migrationsFolder'>
) {
  const production = resolve(__dirname, '../../drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const last = journal.entries.findIndex((entry) => entry.tag === through);
  if (last < 0 || journal.entries.slice(last + 1).some((entry) => entry.tag === through))
    throw new Error(`Expected exactly one production migration: ${through}`);
  const entries = journal.entries.slice(0, last + 1);
  const migrationsFolder = mkdtempSync(join(tmpdir(), 'barghsa-migration-prefix-'));
  try {
    mkdirSync(join(migrationsFolder, 'meta'));
    writeFileSync(
      join(migrationsFolder, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries })
    );
    for (const { tag } of entries) {
      if (!/^[a-zA-Z0-9_-]+$/.test(tag)) throw new Error('Invalid production migration tag');
      symlinkSync(join(production, tag + '.sql'), join(migrationsFolder, tag + '.sql'));
    }
    return await runMigrations({ ...options, migrationsFolder });
  } finally {
    rmSync(migrationsFolder, { recursive: true, force: true });
  }
}
