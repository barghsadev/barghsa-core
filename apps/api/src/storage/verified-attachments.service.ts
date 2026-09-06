import { readCappedBytes } from './read-capped-bytes.js';
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
import type { DualApprovalQueryClient } from '../admin/dual-approval-resolution.js';
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export type AttachmentPurpose = 'ticket_attachment' | 'legal_profile_document';
function prefix(purpose: AttachmentPurpose) {
  return purpose === 'ticket_attachment' ? 'ticket-attachments/' : 'legal-profile-documents/';
}
@Injectable()
export class VerifiedAttachmentsService {
  constructor(
    @Optional() @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null = null
  ) {}
  async seal(
    client: DualApprovalQueryClient,
    keys: string[],
    actorId: string,
    profileId: string | null,
    purpose: AttachmentPurpose = 'ticket_attachment'
  ): Promise<string[]> {
    if (!keys.length || keys.length > 5 || new Set(keys).size !== keys.length)
      throw new BadRequestException('One to five distinct attachment files are required');
    if (!this.storage) throw new ServiceUnavailableException('Attachment storage is unavailable');
    const sealed: string[] = [];
    for (const key of [...keys].sort()) {
      if (!/^uploads\/(document|image)\/[a-f0-9-]+\.(pdf|png|jpe?g|webp)$/i.test(key))
        throw new BadRequestException('Invalid attachment upload key');
      const row = (
        await client.query('SELECT * FROM storage_records WHERE storage_key=$1 FOR UPDATE', [key])
      ).rows[0] as Record<string, unknown> | undefined;
      const metadata = row?.metadata as Record<string, unknown> | undefined;
      if (
        !row ||
        row.status !== 'active' ||
        metadata?.verified !== true ||
        metadata.uploadedBy !== actorId ||
        (metadata.profileId ?? null) !== profileId ||
        metadata.purpose !== purpose
      )
        throw new BadRequestException(
          'Attachment must be a verified upload for this profile by this uploader'
        );
      const object = await this.storage.getObject(key);
      const read = await readCappedBytes(object.body, MAX_BYTES);
      if (read.truncated) throw new BadRequestException('Attachment file is too large');
      const bytes = Buffer.from(read.bytes),
        total = bytes.length;
      if (!total || String(row.file_size) !== String(total))
        throw new BadRequestException('Attachment size changed after upload verification');
      const contentType = pickDetectedContentType(
        sniffContentTypes(bytes.subarray(0, SNIFF_SAMPLE_BYTES)),
        MIME
      );
      if (!contentType) throw new BadRequestException('Unsupported attachment file content');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const sealedKey = `${prefix(purpose)}${randomUUID()}/${digest}`;
      await this.storage.putObject(sealedKey, bytes, contentType);
      await client.query(
        `INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name,signed_at,signed_by)
        VALUES ($1,'immutable',$2::jsonb,$3,$4,$5,$6,NOW(),$7)`,
        [
          sealedKey,
          JSON.stringify({
            purpose,
            profileId,
            uploadedBy: actorId,
            sourceKey: key,
            sha256: digest,
          }),
          total,
          contentType,
          row.category,
          row.file_name,
          actorId,
        ]
      );
      sealed.push(sealedKey);
    }
    return sealed;
  }
  async downloadUrls(
    keys: string[],
    purpose: AttachmentPurpose = 'ticket_attachment'
  ): Promise<string[]> {
    if (!this.storage) return [];
    return Promise.all(
      keys
        .filter((key) => key.startsWith(prefix(purpose)))
        .map((key) => this.storage!.presignedGetUrl(key, 300))
    );
  }
}
