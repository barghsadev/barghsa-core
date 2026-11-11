import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { StorageObjectNotFound } from '@barghsa/shared/storage';
import { v7 as uuidv7 } from 'uuid';
import { STORAGE_PROVIDER } from './storage.constants.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
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
  cleanup_operation: 'delete' | 'expire' | null;
  metadata: Record<string, unknown> | null;
}
type VersionedRecord = RecordRow & { id: string; record_revision: string };
type StorageActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

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
  private async withAuthorizedRecord<T>(
    key: string,
    session: StorageActor,
    work: (client: PoolClient, row: VersionedRecord, verifiedAt: Date) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, session.userId, 'admin:storage:edit');
      const verifiedAt = await requireSessionStepUp(client, session);
      const row = (
        await client.query<VersionedRecord>(
          'SELECT *,xmin::text AS record_revision FROM storage_records WHERE storage_key=$1 FOR UPDATE',
          [key]
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Storage record not found');
      const result = await work(client, row, verifiedAt);
      await requireSessionStepUp(client, session);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async mutate(key: string, action: 'sign' | 'remove', session: StorageActor, ip: string) {
    if (!session) throw new UnauthorizedException();
    const actorId = session.userId;
    this.validateKey(key);
    let prepared: VersionedRecord | undefined;
    if (action === 'sign') {
      prepared = await this.withAuthorizedRecord(key, session, async (_client, row) => {
        if (row.status === 'removed')
          throw new ConflictException('Removed records cannot be signed');
        return row;
      });
      if (prepared.status === 'immutable')
        return { record: response(prepared), retained: true, alreadyRemoved: false };
      if (!this.storage) throw new ServiceUnavailableException('Storage is unavailable');
      try {
        const object = await this.storage.getObject(key);
        await object.body.cancel();
      } catch (error) {
        if (error instanceof StorageObjectNotFound)
          throw new NotFoundException('Stored file not found');
        throw error;
      }
    }

    return this.withAuthorizedRecord(key, session, async (client, row, verifiedAt) => {
      if (action === 'sign') {
        if (row.status === 'removed')
          throw new ConflictException('Removed records cannot be signed');
        if (!prepared || prepared.id !== row.id)
          throw new ConflictException('Storage record changed while checking the file');
        if (row.status === 'immutable')
          return { record: response(row), retained: true, alreadyRemoved: false };
        if (prepared.record_revision !== row.record_revision)
          throw new ConflictException('Storage record changed while checking the file');
        await client.query(
          "UPDATE storage_records SET status='immutable',signed_at=NOW(),signed_by=$2,updated_at=NOW() WHERE storage_key=$1",
          [key, actorId]
        );
      } else {
        const pendingUpload =
          row.status === 'removed' &&
          !row.cleanup_operation &&
          row.metadata?.provisionalUpload === true;
        if (row.status === 'removed' && !pendingUpload)
          return { record: response(row), retained: !!row.signed_at, alreadyRemoved: true };
        // Immutable data is retained. Active data is deleted by a worker only after this transaction commits.
        const deletable = (row.status === 'active' || pendingUpload) && !row.signed_at;
        await client.query(
          `UPDATE storage_records SET status='removed',removed_at=NOW(),updated_at=NOW(),
          metadata=(COALESCE(metadata,'{}'::jsonb)-'provisionalUpload')||jsonb_build_object('deletionRequested',$2::boolean)
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
            stepUpVerified: true,
            stepUpVerifiedAt: verifiedAt.toISOString(),
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
      return {
        record: response(changed),
        retained: action === 'sign' || row.status === 'immutable' || !!row.signed_at,
        alreadyRemoved: false,
      };
    });
  }
}
