import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  STORAGE_CONFIG_KEY,
  storageConfigUpdate,
  storedStorageConfig,
  environmentStorageConfig,
  encryptStorageSecret,
  decryptStorageSecret,
  configuredStorageProviders,
} from '@barghsa/shared/storage';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';

@Injectable()
export class StorageConfigService {
  async read() {
    const row = (
      await getDbPool().query<{ value: unknown; version: number }>(
        'SELECT value,version FROM app_config WHERE key=$1',
        [STORAGE_CONFIG_KEY]
      )
    ).rows[0];
    const stored = row ? storedStorageConfig.parse(row.value) : null;
    const config = stored
      ? { ...stored, secretAccessKey: decryptStorageSecret(stored.encryptedSecret) }
      : environmentStorageConfig();
    return { config, version: row?.version ?? 0 };
  }
  async get() {
    const { config, version } = await this.read();
    return this.mask(config, version);
  }
  private mask(config: ReturnType<typeof environmentStorageConfig>, version: number) {
    return {
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      hasSecretKey: !!config.secretAccessKey,
      forcePathStyle: config.forcePathStyle,
      privateEndpointUrl: config.privateEndpointUrl,
      publicEndpointUrl: config.publicEndpointUrl,
      version,
    };
  }
  private async candidate(raw: unknown) {
    const parsed = storageConfigUpdate.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: 'VALIDATION:INPUT_INVALID' });
    const current = await this.read();
    if (parsed.data.version !== current.version)
      throw new ConflictException({ error: 'STORAGE:CONFIG_CHANGED' });
    const input = parsed.data;
    const locations = [
      'endpoint',
      'privateEndpointUrl',
      'publicEndpointUrl',
      'bucket',
      'region',
    ] as const;
    const locationChanged = locations.some((key) => input[key] !== current.config[key]);
    if (locationChanged && input.secretAccessKey === undefined && current.config.secretAccessKey)
      throw new BadRequestException({ error: 'STORAGE:SECRET_REENTRY_REQUIRED' });
    const config = {
      ...input,
      secretAccessKey: input.secretAccessKey ?? current.config.secretAccessKey,
    };
    if (!!config.accessKeyId !== !!config.secretAccessKey)
      throw new BadRequestException({ error: 'STORAGE:CREDENTIAL_PAIR_REQUIRED' });
    return { config, current, locationChanged };
  }
  private async probe(config: ReturnType<typeof environmentStorageConfig>) {
    try {
      const providers = configuredStorageProviders(config, true);
      await providers.internal.listObjects('', 1);
      await providers.browser.listObjects('', 1);
    } catch {
      // SDK errors may contain endpoint or credential details; expose a fixed message.
      throw new ServiceUnavailableException({ error: 'STORAGE:CONNECTION_FAILED' });
    }
  }
  async test(raw: unknown) {
    const { config } = await this.candidate(raw);
    await this.probe(config);
    return { success: true, message: 'Connection successful' };
  }
  async save(raw: unknown, actor: string) {
    const { config, current, locationChanged } = await this.candidate(raw);
    let encryptedSecret: string | null;
    try {
      encryptedSecret = encryptStorageSecret(config.secretAccessKey);
    } catch {
      throw new ServiceUnavailableException({ error: 'STORAGE:ENCRYPTION_UNAVAILABLE' });
    }
    await this.probe(config);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor, 'admin:storage:edit');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('storage.active'))");
      const row = (
        await client.query<{ version: number }>(
          'SELECT version FROM app_config WHERE key=$1 FOR UPDATE',
          [STORAGE_CONFIG_KEY]
        )
      ).rows[0];
      if ((row?.version ?? 0) !== current.version)
        throw new ConflictException({ error: 'STORAGE:CONFIG_CHANGED' });
      if (locationChanged) {
        // Serialize with upload reservations before changing where keys resolve.
        await client.query('LOCK TABLE storage_records IN SHARE ROW EXCLUSIVE MODE');
        if ((await client.query('SELECT 1 FROM storage_records LIMIT 1')).rows.length)
          throw new ConflictException({ error: 'STORAGE:LOCATION_IN_USE' });
      }
      const { secretAccessKey: _secret, version: _version, ...fields } = config;
      await client.query(
        `INSERT INTO app_config(key,value,version) VALUES ($1,$2::jsonb,1)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1,updated_at=NOW()`,
        [STORAGE_CONFIG_KEY, JSON.stringify({ ...fields, encryptedSecret })]
      );
      const version = current.version + 1;
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata)
        VALUES (uuid_generate_v7()::text,$1,'storage.config.updated',$2)`,
        [actor, JSON.stringify({ version, previousVersion: current.version })]
      );
      await client.query('COMMIT');
      return this.mask(config, version);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
