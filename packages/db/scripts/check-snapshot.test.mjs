import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const stale of [false, true])
  test(
    stale
      ? 'rejects a snapshot missing an implemented column'
      : 'accepts current snapshot without modifying it',
    () => {
      const fixture = mkdtempSync(join(tmpdir(), 'barghsa-snapshot-fixture-'));
      try {
        mkdirSync(join(fixture, 'scripts'));
        cpSync(
          join(root, 'scripts/check-snapshot.mjs'),
          join(fixture, 'scripts/check-snapshot.mjs')
        );
        cpSync(join(root, 'drizzle/production'), join(fixture, 'drizzle/production'), {
          recursive: true,
        });
        symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'));
        symlinkSync(join(root, 'src'), join(fixture, 'src'));
        const meta = join(fixture, 'drizzle/production/meta');
        const latest = readdirSync(meta)
          .filter((name) => /^\d+_snapshot\.json$/.test(name))
          .sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
          .at(-1);
        assert.ok(latest, 'A committed schema snapshot is required');
        const path = join(meta, latest);
        if (stale) {
          const value = JSON.parse(readFileSync(path, 'utf8'));
          delete value.tables['public.profiles'].columns.contact_email;
          writeFileSync(path, JSON.stringify(value));
        }
        const before = readFileSync(path, 'utf8');
        const result = spawnSync(process.execPath, [join(fixture, 'scripts/check-snapshot.mjs')], {
          encoding: 'utf8',
          timeout: 60_000,
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, stale ? 1 : 0, result.stdout + result.stderr);
        assert.equal(readFileSync(path, 'utf8'), before);
        assert.match(
          result.stdout + result.stderr,
          stale ? /Schema differs/ : /generation made no changes/
        );
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  );
