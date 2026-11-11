import { readCappedBytes } from './read-capped-bytes.js';
import { reserveStorageCopy } from './reserve-storage-copy.js';
import { createDirectDbPool } from '@barghsa/db';
import { withMultipartUploadLock } from '@barghsa/db/storage-multipart';
import type { PoolClient } from 'pg';
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from './storage.constants.js';
import {
  pickDetectedContentType,
  sniffContentTypes,
  SNIFF_SAMPLE_BYTES,
} from '../upload/content-type-sniffer.js';
import { requireCleanUpload } from '../upload/require-clean-upload.js';
import type { DualApprovalQueryClient } from '../admin/dual-approval-resolution.js';
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export type AttachmentPurpose =
  | 'ticket_attachment'
  | 'ticket_reply_attachment'
  | 'legal_profile_document'
  | 'branding_logo'
  | 'conversation_avatar';
type AttachmentBinding = {
  actorId: string;
  profileId: string | null;
  purpose: AttachmentPurpose;
  ticketId?: string | undefined;
};
type AttachmentSource = {
  key: string;
  id: string;
  revision: string;
  fileSize: string | number | null;
  fileName: string | null;
  category: string | null;
  metadata: Record<string, unknown>;
};
type AttachmentPlan = { binding: AttachmentBinding; sources: AttachmentSource[] };
export type PreparedAttachmentCopies = {
  binding: AttachmentBinding;
  copies: {
    source: AttachmentSource;
    key: string;
    digest: string;
    size: number;
    contentType: string;
  }[];
};

function prefix(purpose: AttachmentPurpose) {
  if (purpose === 'conversation_avatar') return 'conversation-avatars/';
  if (purpose === 'branding_logo') return 'branding-assets/';
  if (purpose === 'ticket_reply_attachment') return 'ticket-reply-attachments/';
  return purpose === 'ticket_attachment' ? 'ticket-attachments/' : 'legal-profile-documents/';
}
@Injectable()
export class VerifiedAttachmentsService {
  constructor(
    @Optional() @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null = null
  ) {}
  private storageProvider() {
    if (!this.storage) throw new ServiceUnavailableException('Attachment storage is unavailable');
    return this.storage;
  }

  private async source(
    client: DualApprovalQueryClient,
    key: string,
    { actorId, profileId, purpose, ticketId }: AttachmentBinding
  ): Promise<AttachmentSource> {
    if (!/^uploads\/(document|image)\/[a-f0-9-]+\.(pdf|png|jpe?g|webp)$/i.test(key))
      throw new BadRequestException('Invalid attachment upload key');
    const row = (
      await client.query(
        'SELECT *,xmin::text AS revision FROM storage_records WHERE storage_key=$1 FOR UPDATE',
        [key]
      )
    ).rows[0] as Record<string, unknown> | undefined;
    const metadata = row?.metadata as Record<string, unknown> | undefined;
    if (
      !row ||
      row.status !== 'active' ||
      metadata?.verified !== true ||
      metadata.uploadedBy !== actorId ||
      (metadata.profileId ?? null) !== profileId ||
      metadata.purpose !== purpose ||
      (purpose === 'ticket_reply_attachment' && (!ticketId || metadata.ticketId !== ticketId))
    )
      throw new BadRequestException(
        'Attachment must be a verified upload for this profile by this uploader'
      );
    return {
      key,
      id: row.id as string,
      revision: row.revision as string,
      fileSize: row.file_size as string | number | null,
      fileName: row.file_name as string | null,
      category: row.category as string | null,
      metadata,
    };
  }

  /** Snapshot eligible sources inside the caller's short authorization transaction. */
  async plan(
    client: DualApprovalQueryClient,
    keys: string[],
    actorId: string,
    profileId: string | null,
    purpose: AttachmentPurpose = 'ticket_attachment',
    ticketId?: string
  ): Promise<AttachmentPlan> {
    if (!keys.length || keys.length > 5 || new Set(keys).size !== keys.length)
      throw new BadRequestException('One to five distinct attachment files are required');
    this.storageProvider();
    const binding = { actorId, profileId, purpose, ticketId };
    const sources: AttachmentSource[] = [];
    for (const key of [...keys].sort()) sources.push(await this.source(client, key, binding));
    return { binding, sources };
  }

  private async readBytes(
    storage: StorageProvider,
    source: AttachmentSource,
    purpose: AttachmentPurpose
  ) {
    const image = purpose === 'branding_logo' || purpose === 'conversation_avatar';
    const object = await storage.getObject(source.key);
    const read = await readCappedBytes(object.body, image ? 2 * 1024 * 1024 : MAX_BYTES);
    if (read.truncated) throw new BadRequestException('Attachment file is too large');
    const bytes = Buffer.from(read.bytes);
    if (!bytes.length || String(source.fileSize) !== String(bytes.length))
      throw new BadRequestException('Attachment size changed after upload verification');
    const contentType = pickDetectedContentType(
      sniffContentTypes(bytes.subarray(0, SNIFF_SAMPLE_BYTES)),
      image ? ['image/png', 'image/jpeg', 'image/webp'] : MIME
    );
    if (!contentType) throw new BadRequestException('Unsupported attachment file content');
    const digest = createHash('sha256').update(bytes).digest('hex');
    requireCleanUpload(source.metadata, digest);
    return { bytes, contentType, digest };
  }

  private copyMetadata(binding: AttachmentBinding, source: AttachmentSource, digest: string) {
    const { purpose, profileId, actorId, ticketId } = binding;
    return {
      purpose,
      profileId,
      uploadedBy: actorId,
      sourceKey: source.key,
      sha256: digest,
      ...(ticketId ? { ticketId } : {}),
    };
  }

  private copyExpired() {
    return new ServiceUnavailableException('Attachment reservation expired; retry the upload');
  }

  /** Copy scanned bytes after the authorization transaction commits. */
  async copy(plan: AttachmentPlan, directClient?: PoolClient): Promise<PreparedAttachmentCopies> {
    const storage = this.storageProvider();
    const { binding } = plan;
    const copies: PreparedAttachmentCopies['copies'] = [];
    for (const source of plan.sources) {
      const { bytes, contentType, digest } = await this.readBytes(storage, source, binding.purpose);
      const key = `${prefix(binding.purpose)}${randomUUID()}/${digest}`;
      const metadata = this.copyMetadata(binding, source, digest);
      await reserveStorageCopy(key, metadata);
      const outcome = await withMultipartUploadLock(
        directClient ?? createDirectDbPool(),
        key,
        async (client) => {
          const ready = await client.query(
            `SELECT 1 FROM storage_records WHERE storage_key=$1 AND status='removed'
           AND cleanup_operation IS NULL AND metadata @> $2::jsonb`,
            [key, JSON.stringify({ ...metadata, provisionalCopy: true, deletionRequested: true })]
          );
          if (!ready.rows[0]) throw this.copyExpired();
          await storage.putObject(key, bytes, contentType);
          // Give the publication transaction a fresh cleanup grace period after a slow upload.
          const refreshed = await client.query(
            `UPDATE storage_records SET updated_at=NOW() WHERE storage_key=$1
           AND status='removed' AND cleanup_operation IS NULL`,
            [key]
          );
          if (refreshed.rowCount !== 1) throw this.copyExpired();
        }
      );
      if (!outcome.acquired) throw this.copyExpired();
      copies.push({ source, key, digest, size: bytes.length, contentType });
    }
    return { binding, copies };
  }

  /** Publish only the same sources and completed provisional copies, in the business transaction. */
  async publish(
    client: DualApprovalQueryClient,
    prepared: PreparedAttachmentCopies
  ): Promise<string[]> {
    for (const copy of prepared.copies) {
      const current = await this.source(client, copy.source.key, prepared.binding);
      if (current.id !== copy.source.id || current.revision !== copy.source.revision)
        throw new BadRequestException('Attachment changed after verification');
      requireCleanUpload(current.metadata, copy.digest);
    }
    for (const copy of prepared.copies) await this.publishCopy(client, prepared.binding, copy);
    return prepared.copies.map(({ key }) => key);
  }

  private async publishCopy(
    client: DualApprovalQueryClient,
    binding: AttachmentBinding,
    { key, digest, size, contentType, source }: PreparedAttachmentCopies['copies'][number]
  ) {
    const metadata = this.copyMetadata(binding, source, digest);
    const saved = await client.query(
      `UPDATE storage_records SET status='immutable',metadata=$2::jsonb,file_size=$3,
       content_type=$4,category=$5,file_name=$6,signed_at=NOW(),signed_by=$7,
       removed_at=NULL,updated_at=NOW()
       WHERE storage_key=$1 AND status='removed' AND cleanup_operation IS NULL AND metadata @> $8::jsonb
       RETURNING storage_key`,
      [
        key,
        JSON.stringify(metadata),
        size,
        contentType,
        source.category,
        source.fileName,
        binding.actorId,
        JSON.stringify({ ...metadata, provisionalCopy: true, deletionRequested: true }),
      ]
    );
    if (!saved.rows[0]) throw this.copyExpired();
  }

  async downloadUrls(
    keys: string[],
    purpose: AttachmentPurpose = 'ticket_attachment'
  ): Promise<string[]> {
    if (!this.storage) return [];
    const inline = purpose === 'conversation_avatar' || purpose === 'branding_logo';
    return Promise.all(
      keys
        .filter((key) => key.startsWith(prefix(purpose)))
        .map((key) =>
          inline
            ? this.storage!.presignedGetUrl(key, 300)
            : this.storage!.presignedGetUrl(key, 300, 'attachment')
        )
    );
  }
}
