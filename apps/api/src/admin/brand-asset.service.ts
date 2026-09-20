import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import type { StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { readCappedBytes } from '../storage/read-capped-bytes.js';

@Injectable()
export class BrandAssetService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async read(id: string, digest: string, preview = false): Promise<StreamableFile> {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(digest))
      throw new NotFoundException();
    const url = `/api/public/branding/assets/${id}/${digest}`;
    const key = `branding-assets/${id}/${digest}`;
    const result = await getDbPool().query<{ content_type: string; file_size: string }>(
      `SELECT s.content_type,s.file_size FROM storage_records s
       WHERE s.storage_key=$1 AND s.status='immutable' AND s.metadata->>'purpose'='branding_logo'
       AND EXISTS(SELECT 1 FROM brand_config b WHERE b.config->>'logoUrl'=$2
         AND ($3::boolean OR b.status='active'))`,
      [key, url, preview]
    );
    const row = result.rows[0];
    if (!row || !['image/png', 'image/jpeg', 'image/webp'].includes(row.content_type))
      throw new NotFoundException();
    const object = await this.storage.getObject(key);
    const body = await readCappedBytes(object.body, 2 * 1024 * 1024);
    if (
      body.truncated ||
      String(body.bytes.length) !== String(row.file_size) ||
      createHash('sha256').update(body.bytes).digest('hex') !== digest
    )
      throw new ServiceUnavailableException('Brand asset integrity check failed');
    return new StreamableFile(Buffer.from(body.bytes), {
      type: row.content_type,
      length: body.bytes.length,
      disposition: 'inline',
    });
  }
}
