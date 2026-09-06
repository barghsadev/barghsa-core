import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { StorageProvider } from '@barghsa/shared/storage';
import { StorageObjectNotFound } from '@barghsa/shared/storage';
import { v7 as uuidv7 } from 'uuid';
import { STORAGE_PROVIDER } from './storage.constants.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';

interface RecordRow {
  storage_key: string;
  status: string;
  file_name: string | null;
  content_type: string | null;
  file_size: string | null;
  category: string | null;
  signed_at: Date | null;
  signed_by: string | null;
  removed_at: Date | null;
}
function response(row: RecordRow) {
  return {
    key: row.storage_key,
    status: row.status,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    category: row.category,
    signedAt: row.signed_at?.toISOString() ?? null,
    signedBy: row.signed_by,
    removedAt: row.removed_at?.toISOString() ?? null,
  };
}
@Injectable()
export class StorageRecordAdminService {
  constructor(
    @Optional() @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null = null
  ) {}
  private validateKey(key: string) {
    if (
      !key ||
      key.length > 1024 ||
      [...key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw new BadRequestException('Invalid storage key');
  }
  async get(key: string) {
    this.validateKey(key);
    const row = (
      await getDbPool().query<RecordRow>('SELECT * FROM storage_records WHERE storage_key=$1', [
        key,
      ])
    ).rows[0];
    if (!row) throw new NotFoundException('Storage record not found');
    return response(row);
  }
  async mutate(key: string, action: 'sign' | 'remove', actorId: string, ip: string) {
    this.validateKey(key);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actorId, 'admin:storage:edit');
      const row = (
        await client.query<RecordRow>(
          'SELECT * FROM storage_records WHERE storage_key=$1 FOR UPDATE',
          [key]
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Storage record not found');
      if (action === 'sign') {
        if (row.status === 'removed')
          throw new ConflictException('Removed records cannot be signed');
        if (row.status === 'immutable') {
          await client.query('COMMIT');
          return { record: response(row), retained: true, alreadyRemoved: false };
        }
        if (!this.storage) throw new ServiceUnavailableException('Storage is unavailable');
        try {
          const object = await this.storage.getObject(key);
          await object.body.cancel();
        } catch (error) {
          if (error instanceof StorageObjectNotFound)
            throw new NotFoundException('Stored file not found');
          throw error;
        }
        await client.query(
          "UPDATE storage_records SET status='immutable',signed_at=NOW(),signed_by=$2,updated_at=NOW() WHERE storage_key=$1",
          [key, actorId]
        );
      } else {
        if (row.status === 'removed') {
          await client.query('COMMIT');
          return { record: response(row), retained: !!row.signed_at, alreadyRemoved: true };
        }
        // Immutable data is retained. Active data is deleted by a worker only after this transaction commits.
        const deletable = row.status === 'active' && !row.signed_at;
        await client.query(
          `UPDATE storage_records SET status='removed',removed_at=NOW(),updated_at=NOW(),
          metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('deletionRequested',$2::boolean)
          WHERE storage_key=$1`,
          [key, deletable]
        );
      }
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [
          uuidv7(),
          actorId,
          action === 'sign' ? 'storage_record_signed' : 'storage_record_removed',
          JSON.stringify({
            storageKey: key,
            previousStatus: row.status,
            retained: action === 'sign' || row.status === 'immutable' || !!row.signed_at,
          }),
          uuidv7(),
          ip,
        ]
      );
      const changed = (
        await client.query<RecordRow>('SELECT * FROM storage_records WHERE storage_key=$1', [key])
      ).rows[0]!;
      await client.query('COMMIT');
      return {
        record: response(changed),
        retained: action === 'sign' || row.status === 'immutable' || !!row.signed_at,
        alreadyRemoved: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
