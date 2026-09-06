import { StorageConfigService } from './storage-config.service.js';
import { StorageRecordAdminService } from './storage-record-admin.service.js';
import { SessionModule } from '../session/session.module.js';
import { Global, Module, ServiceUnavailableException } from '@nestjs/common';
import { createDbInstance, loadStoredStorageConfiguration, type DbInstance } from '@barghsa/db';
import { storageRecords } from '@barghsa/db/schema/storage-record';
import {
  runtimeStorageProvider,
  type StorageProvider,
  ImmutableStorageRecordService,
} from '@barghsa/shared/storage';
import { STORAGE_PROVIDER, IMMUTABLE_STORAGE_SERVICE } from './storage.constants.js';
import { StorageAdminController } from './storage-admin.controller.js';
import { StorageRecordDbAdapter } from './storage-record-db-adapter.js';
import { StorageRecordsController } from './storage-records.controller.js';

@Global()
@Module({
  imports: [SessionModule],
  controllers: [StorageAdminController, StorageRecordsController],
  providers: [
    StorageRecordAdminService,
    StorageConfigService,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (): StorageProvider =>
        runtimeStorageProvider(
          loadStoredStorageConfiguration,
          () => new ServiceUnavailableException({ error: 'STORAGE:CONFIG_UNAVAILABLE' })
        ),
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
        dbAdapter: StorageRecordDbAdapter
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
