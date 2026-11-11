import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ensureDocumentPreview } from './document-preview.js';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { writeProvisionalStorageCopy } from '../storage/reserve-storage-copy.js';
import { UploadService } from '../upload/upload.service.js';

type DocumentUploadPlan = {
  key: string;
  id: string;
  revision: string;
  actorId: string;
  profileId: string;
  purpose: 'business_document' | 'staff_business_document';
};

@Injectable()
export class DocumentStorageService {
  constructor(
    @Inject(UploadService) private readonly uploads: UploadService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider
  ) {}

  async plan(
    client: PoolClient,
    key: string,
    actorId: string,
    profileId: string,
    staff: boolean
  ): Promise<DocumentUploadPlan> {
    const source = (
      await client.query<{ id: string; revision: string; metadata: Record<string, unknown> }>(
        `SELECT id,xmin::text AS revision,metadata FROM storage_records
         WHERE storage_key=$1 AND status='active' AND cleanup_operation IS NULL FOR UPDATE`,
        [key]
      )
    ).rows[0];
    if (!source || source.metadata.verified !== true || source.metadata.uploadedBy !== actorId)
      throw new ConflictException('Upload is unavailable');
    const purpose = staff ? 'staff_business_document' : 'business_document';
    this.requireBinding(source.metadata, purpose, profileId);
    return { key, id: source.id, revision: source.revision, actorId, profileId, purpose };
  }

  private requireBinding(
    metadata: Record<string, unknown>,
    purpose: DocumentUploadPlan['purpose'],
    profileId: string
  ) {
    if (metadata.purpose !== purpose || metadata.profileId !== profileId)
      throw new ConflictException('Upload belongs to another purpose or profile');
    if (metadata.scanState !== 'Available' || metadata.scanSkippedReason !== 'not_configured')
      throw new ConflictException('Document scan has not resolved');
  }

  async copy(source: DocumentUploadPlan, directClient?: PoolClient) {
    const { key, actorId, profileId, purpose } = source;
    const verified = await this.uploads.readVerifiedUpload(key, actorId);
    this.requireBinding(verified.metadata, purpose, profileId);
    const checksum = createHash('sha256').update(verified.bytes).digest('hex');
    const storageKey = `business-documents/${randomUUID()}/${checksum}`;
    const metadata = { purpose, profileId, uploadedBy: actorId, sourceKey: key, sha256: checksum };
    const ready = await writeProvisionalStorageCopy(
      storageKey,
      metadata,
      () => this.storage.putObject(storageKey, verified.bytes, verified.contentType),
      directClient
    );
    if (!ready) throw new ConflictException('Copy reservation expired; retry confirmation');
    return {
      source,
      metadata,
      storageKey,
      checksum,
      detectedMime: verified.contentType,
      sizeBytes: verified.bytes.length,
      category: verified.category,
    };
  }

  async publish(client: PoolClient, prepared: Awaited<ReturnType<DocumentStorageService['copy']>>) {
    const { source, metadata, storageKey, checksum, detectedMime, sizeBytes, category } = prepared;
    const current = await this.plan(
      client,
      source.key,
      source.actorId,
      source.profileId,
      source.purpose === 'staff_business_document'
    );
    if (current.id !== source.id || current.revision !== source.revision)
      throw new ConflictException('Upload changed after inspection');
    const result = await client.query(
      `UPDATE storage_records SET status='immutable',signed_at=NOW(),signed_by=$2,
       content_type=$3,file_size=$4,category=$5,metadata=$6::jsonb,removed_at=NULL,updated_at=NOW()
       WHERE storage_key=$1 AND status='removed' AND cleanup_operation IS NULL
         AND metadata @> $7::jsonb RETURNING storage_key`,
      [
        storageKey,
        source.actorId,
        detectedMime,
        sizeBytes,
        category,
        JSON.stringify(metadata),
        JSON.stringify({ ...metadata, provisionalCopy: true, deletionRequested: true }),
      ]
    );
    if (!result.rows[0])
      throw new ConflictException('Copy reservation expired; retry confirmation');
    return { storageKey, checksum, detectedMime, sizeBytes };
  }

  download(storageKey: string) {
    return this.storage.presignedGetUrl(storageKey, 300, 'attachment');
  }

  async preview(documentId: string, storageKey: string, mime: string) {
    const key = await ensureDocumentPreview(this.storage, documentId, storageKey, mime);
    return { url: await this.storage.presignedGetUrl(key, 300), expiresIn: 300 };
  }
}
