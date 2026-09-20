import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { reserveStorageCopy } from '../storage/reserve-storage-copy.js';
import { UploadService } from '../upload/upload.service.js';

@Injectable()
export class DocumentStorageService {
  constructor(
    @Inject(UploadService) private readonly uploads: UploadService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider
  ) {}

  async seal(client: PoolClient, key: string, actorId: string, profileId: string, staff: boolean) {
    const source = (
      await client.query(
        'SELECT storage_key FROM storage_records WHERE storage_key=$1 FOR UPDATE',
        [key]
      )
    ).rows[0];
    if (!source) throw new ConflictException('Upload is unavailable');
    const verified = await this.uploads.readVerifiedUpload(key, actorId);
    const purpose = staff ? 'staff_business_document' : 'business_document';
    if (verified.metadata.purpose !== purpose || verified.metadata.profileId !== profileId)
      throw new ConflictException('Upload belongs to another purpose or profile');
    if (
      verified.metadata.scanState !== 'Available' ||
      verified.metadata.scanSkippedReason !== 'not_configured'
    )
      throw new ConflictException('Document scan has not resolved');
    const checksum = createHash('sha256').update(verified.bytes).digest('hex');
    const storageKey = `business-documents/${randomUUID()}/${checksum}`;
    await reserveStorageCopy(storageKey, {
      purpose,
      profileId,
      uploadedBy: actorId,
      sourceKey: key,
    });
    const reserved = (
      await client.query(
        `SELECT storage_key FROM storage_records WHERE storage_key=$1 AND status='removed'
       AND metadata->>'provisionalCopy'='true' AND metadata->>'deletionRequested'='true' FOR UPDATE`,
        [storageKey]
      )
    ).rows[0];
    if (!reserved) throw new ConflictException('Copy reservation expired; retry confirmation');
    await this.storage.putObject(storageKey, verified.bytes, verified.contentType);
    await client.query(
      `UPDATE storage_records SET status='immutable',signed_at=NOW(),signed_by=$2,
       content_type=$3,file_size=$4,category=$5,metadata=$6::jsonb,removed_at=NULL,updated_at=NOW()
       WHERE storage_key=$1`,
      [
        storageKey,
        actorId,
        verified.contentType,
        verified.bytes.length,
        verified.category,
        JSON.stringify({
          purpose,
          profileId,
          uploadedBy: actorId,
          sourceKey: key,
          sha256: checksum,
        }),
      ]
    );
    return {
      storageKey,
      checksum,
      detectedMime: verified.contentType,
      sizeBytes: verified.bytes.length,
    };
  }

  download(storageKey: string) {
    return this.storage.presignedGetUrl(storageKey, 300);
  }
}
