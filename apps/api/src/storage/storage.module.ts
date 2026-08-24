import { Global, Logger, Module } from '@nestjs/common';
import { createDbInstance, type DbInstance } from '@barghsa/db';
import { storageRecords } from '@barghsa/db/schema/storage-record';
import { createStorageProvider, type StorageProvider, ImmutableStorageRecordService } from '@barghsa/shared/storage';
import { StorageAdminController } from './storage-admin.controller.js';
import { StorageRecordDbAdapter } from './storage-record-db-adapter.js';
import { StorageRecordsController } from './storage-records.controller.js';

/**
 * NestJS injection token for the StorageProvider instance.
 * Inject with `@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null`.
 */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/**
 * NestJS injection token for the ImmutableStorageRecordService instance.
 */
export const IMMUTABLE_STORAGE_SERVICE = Symbol('IMMUTABLE_STORAGE_SERVICE');

@Global()
@Module({
  controllers: [StorageAdminController, StorageRecordsController],
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: (): StorageProvider | null => {
        const bucket = process.env['S3_BUCKET'];
        const region = process.env['S3_REGION'];

        if (!bucket || !region) {
          const logger = new Logger('StorageModule');
          logger.warn(
            'S3_BUCKET and/or S3_REGION not set — storage provider disabled. ' +
            'Upload endpoints will return 503.',
          );
          return null;
        }

        const config: Record<string, unknown> = {
          type: 's3' as const,
          bucket,
          region,
          ...(process.env['S3_ENDPOINT'] ? { endpoint: process.env['S3_ENDPOINT'] } : {}),
          ...(process.env['S3_ACCESS_KEY_ID'] ? { accessKeyId: process.env['S3_ACCESS_KEY_ID'] } : {}),
          ...(process.env['S3_SECRET_ACCESS_KEY'] ? { secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] } : {}),
          ...(process.env['S3_FORCE_PATH_STYLE'] === 'true' ? { forcePathStyle: true } : {}),
        };

        const logger = new Logger('StorageModule');
        return createStorageProvider(config as unknown as Parameters<typeof createStorageProvider>[0], {
          warn: (msg, ...meta) => logger.warn(msg, ...meta),
          error: (msg, ...meta) => logger.error(msg, ...meta),
        });
      },
    },
    {
      provide: 'DB_INSTANCE',
      useFactory: (): DbInstance => {
        return createDbInstance(undefined, { storageRecords });
      },
    },
    StorageRecordDbAdapter,
    {
      provide: IMMUTABLE_STORAGE_SERVICE,
      useFactory: (
        storageProvider: StorageProvider | null,
        dbAdapter: StorageRecordDbAdapter,
      ): ImmutableStorageRecordService | null => {
        if (!storageProvider) return null;
        return new ImmutableStorageRecordService(storageProvider, dbAdapter);
      },
      inject: [STORAGE_PROVIDER, StorageRecordDbAdapter],
    },
  ],
  exports: [STORAGE_PROVIDER, IMMUTABLE_STORAGE_SERVICE],
})
export class StorageModule {}