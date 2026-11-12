import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { readCappedBytes } from '../storage/read-capped-bytes.js';
import { withStaffReadAuthority, type StaffReadActor } from './staff-read-authority.js';

@Injectable()
export class BrandAssetService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async read(id: string, digest: string, preview?: StaffReadActor): Promise<StreamableFile> {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(digest))
      throw new NotFoundException();
    const url = `/api/public/branding/assets/${id}/${digest}`;
    const key = `branding-assets/${id}/${digest}`;
    const readRecord = async (database: Pick<PoolClient, 'query'>) => {
      const result = await database.query<{ content_type: string; file_size: string }>(
        `SELECT s.content_type,s.file_size FROM storage_records s
         WHERE s.storage_key=$1 AND s.status='immutable' AND s.metadata->>'purpose'='branding_logo'
         AND EXISTS(SELECT 1 FROM brand_config b WHERE (b.config->>'logoUrl'=$2 OR b.config->>'faviconUrl'=$2 OR b.config->>'logoDarkUrl'=$2)
           AND ($3::boolean OR b.status='active'))`,
        [key, url, Boolean(preview)]
      );
      const row = result.rows[0];
      if (!row || !['image/png', 'image/jpeg', 'image/webp'].includes(row.content_type))
        throw new NotFoundException();
      return row;
    };
    const authorizedRecord = () =>
      preview
        ? withStaffReadAuthority(preview, 'admin:branding:read', readRecord)
        : readRecord(getDbPool());
    const row = await authorizedRecord();
    const object = await this.storage.getObject(key);
    const body = await readCappedBytes(object.body, 2 * 1024 * 1024);
    const current = await authorizedRecord();
    if (
      body.truncated ||
      current.content_type !== row.content_type ||
      String(body.bytes.length) !== String(current.file_size) ||
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
