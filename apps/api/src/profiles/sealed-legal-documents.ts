import { HttpException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

export function legalDocumentsUnavailable() {
  return new HttpException({ error: 'STORAGE:UNAVAILABLE' }, 503);
}

export async function readSealedLegalDocuments(
  db: Pool | PoolClient,
  profileId: string,
  keys: unknown
) {
  if (
    !Array.isArray(keys) ||
    keys.length > 5 ||
    new Set(keys).size !== keys.length ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !/^legal-profile-documents\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(key)
    )
  )
    throw legalDocumentsUnavailable();
  if (!keys.length) return [];
  const { rows } = await db.query<{
    storage_key: string;
    file_name: string | null;
    revision: string;
  }>(
    `SELECT storage_key,file_name,xmin::text AS revision FROM storage_records
     WHERE storage_key=ANY($1::text[]) AND status='immutable'
       AND metadata->>'purpose'='legal_profile_document' AND LOWER(metadata->>'profileId')=$2`,
    [keys, profileId]
  );
  if (rows.length !== keys.length) throw legalDocumentsUnavailable();
  return keys.map((key) => rows.find((row) => row.storage_key === key)!);
}
