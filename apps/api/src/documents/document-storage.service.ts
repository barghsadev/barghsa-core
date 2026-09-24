import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
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

  async preview(documentId: string, storageKey: string, mime: string) {
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime))
      throw new ConflictException('Document has no preview');
    // A sealed source key is immutable. Changing the source changes the cache key;
    // a daily key bounds cache age, while the bucket lifecycle deletes old derivatives.
    const sourceHash = createHash('sha256').update(storageKey).digest('hex');
    const day = Math.floor(Date.now() / 86_400_000);
    const key = `previews/${documentId}/${sourceHash}-${day}.png`;
    const cached = await this.storage.listObjects(key, 1);
    if (!cached.items.some((item) => item.key === key)) {
      const source = await this.storage.getObject(storageKey);
      if (source.contentLength && source.contentLength > 15 * 1024 * 1024)
        throw new ConflictException('Document is too large to preview');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of source.body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > 15 * 1024 * 1024)
          throw new ConflictException('Document is too large to preview');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (mime === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw new ConflictException('Invalid PDF document');
      let image: Buffer;
      try {
        image =
          mime === 'application/pdf'
            ? await renderPdfFirstPage(bytes)
            : await sharp(bytes, { limitInputPixels: 25_000_000 })
                .rotate()
                .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer();
      } catch {
        throw new ConflictException('Document preview could not be generated');
      }
      await this.storage.putObject(key, image, 'image/png', { sourceHash });
    }
    return { url: await this.storage.presignedGetUrl(key, 300), expiresIn: 300 };
  }
}

function renderPdfFirstPage(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      'pdftoppm',
      ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '640', '-png', '-'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const output: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => process.kill('SIGKILL'), 10_000);
    process.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) process.kill('SIGKILL');
      else output.push(chunk);
    });
    process.stderr.resume();
    process.stdin.on('error', () => {
      // The close handler reports renderer failure if the child exited before reading input.
    });
    process.on('error', reject);
    process.on('close', (code) => {
      clearTimeout(timeout);
      const image = Buffer.concat(output);
      if (code === 0 && image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
        resolve(image);
      else reject(new ConflictException('PDF preview could not be generated'));
    });
    process.stdin.end(bytes);
  });
}
