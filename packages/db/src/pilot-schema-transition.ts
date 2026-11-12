import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const PILOT_SCHEMA_TRANSITION_VERSION = 1;

interface MigrationHead {
  hash: string;
  created_at: string;
}

function matches(head: unknown, expected: MigrationHead): boolean {
  if (!head || typeof head !== 'object') return false;
  const value = head as Partial<MigrationHead>;
  return value.hash === expected.hash && value.created_at === expected.created_at;
}

/** The pilot operator can bind a reviewed additive migration to one previous image. */
export async function permitsPilotSchemaTransition(
  expected: MigrationHead,
  applied: MigrationHead
): Promise<boolean> {
  const file = process.env['BARGHSA_PILOT_SCHEMA_TRANSITION_FILE'];
  const commit = process.env['BARGHSA_RELEASE_SHA'];
  if (!file || !isAbsolute(file) || !commit || !/^[a-f0-9]{40}$/.test(commit)) return false;
  if (
    !/^[a-f0-9]{64}$/.test(applied.hash) ||
    !/^\d+$/.test(applied.created_at) ||
    BigInt(applied.created_at) <= BigInt(expected.created_at)
  ) {
    return false;
  }
  try {
    const receipt = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const stat = await receipt.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > 4096 || (stat.mode & 0o022) !== 0)
        return false;
      const bytes = Buffer.alloc(4097);
      const { bytesRead } = await receipt.read(bytes);
      if (bytesRead < 1 || bytesRead > 4096) return false;
      const data = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')) as {
        version?: unknown;
        previous_commit?: unknown;
        previous?: unknown;
        candidate?: unknown;
      } | null;
      return (
        data?.version === PILOT_SCHEMA_TRANSITION_VERSION &&
        data.previous_commit === commit &&
        matches(data.previous, expected) &&
        matches(data.candidate, applied)
      );
    } finally {
      await receipt.close();
    }
  } catch {
    return false;
  }
}
