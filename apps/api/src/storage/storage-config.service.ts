import { randomUUID } from 'node:crypto';
import { readCappedBytes } from './read-capped-bytes.js';
import {
  BadRequestException,
  HttpException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  STORAGE_CONFIG_KEY,
  MULTIPART_CLEANUP_POLICY_KEY,
  DEFAULT_MULTIPART_CLEANUP_HOURS,
  multipartCleanupPolicy,
  multipartCleanupPolicyUpdate,
  storageConfigUpdate,
  storedStorageConfig,
  environmentStorageConfig,
  encryptStorageSecret,
  decryptStorageSecret,
  configuredStorageProviders,
  unapprovedStorageEndpointFields,
} from '@barghsa/shared/storage';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { withStaffReadAuthority } from '../admin/staff-read-authority.js';
import { rejectContentFields } from '../admin/content-input-fields.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import {
  currentStorageDraft,
  storageRevisions,
  type StorageRecoveryDraft,
  type StorageRecoverySettings,
} from './storage-config-recovery.js';

type MutationSession = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type StorageSettings = ReturnType<typeof environmentStorageConfig>;
const storageLocationFields = [
  'endpoint',
  'privateEndpointUrl',
  'publicEndpointUrl',
  'bucket',
  'region',
] as const;
const withoutCredentials = (config: StorageSettings): StorageRecoverySettings => ({
  endpoint: config.endpoint,
  privateEndpointUrl: config.privateEndpointUrl,
  publicEndpointUrl: config.publicEndpointUrl,
  region: config.region,
  bucket: config.bucket,
  forcePathStyle: config.forcePathStyle,
});
const changedLocation = (next: StorageRecoverySettings, current: StorageSettings) =>
  storageLocationFields.some((key) => next[key] !== current[key]);
const changedConfig = () => new ConflictException({ error: 'STORAGE:CONFIG_CHANGED' });

@Injectable()
export class StorageConfigService {
  async getMultipartCleanupPolicy() {
    const row = (
      await getDbPool().query<{ value: unknown; version: number }>(
        'SELECT value,version FROM app_config WHERE key=$1',
        [MULTIPART_CLEANUP_POLICY_KEY]
      )
    ).rows[0];
    if (!row) return { hours: DEFAULT_MULTIPART_CLEANUP_HOURS, version: 0 };
    const parsed = multipartCleanupPolicy.safeParse(row.value);
    return { hours: parsed.success ? parsed.data.hours : null, version: row.version };
  }

  async saveMultipartCleanupPolicy(raw: unknown, session: MutationSession) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, session.userId, 'admin:storage:edit');
      await requireSessionStepUp(client, session);
      const parsed = multipartCleanupPolicyUpdate.safeParse(raw);
      if (!parsed.success) rejectContentFields(parsed.error.issues, ['hours']);
      await client.query(
        `INSERT INTO app_config(key,value,version) VALUES($1,$2::jsonb,0)
         ON CONFLICT(key) DO NOTHING`,
        [MULTIPART_CLEANUP_POLICY_KEY, JSON.stringify({ hours: DEFAULT_MULTIPART_CLEANUP_HOURS })]
      );
      const current = (
        await client.query<{ version: number }>(
          'SELECT version FROM app_config WHERE key=$1 FOR UPDATE',
          [MULTIPART_CLEANUP_POLICY_KEY]
        )
      ).rows[0];
      if ((current?.version ?? 0) !== parsed.data.version)
        throw new ConflictException({ error: 'STORAGE:CONFIG_CHANGED' });
      await client.query(
        `INSERT INTO app_config(key,value,version) VALUES($1,$2::jsonb,1)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
           version=app_config.version+1,updated_at=NOW()`,
        [MULTIPART_CLEANUP_POLICY_KEY, JSON.stringify({ hours: parsed.data.hours })]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata)
         VALUES(uuid_generate_v7()::text,$1,'storage.multipart_cleanup_policy_updated',$2::jsonb)`,
        [
          session.userId,
          JSON.stringify({
            hours: parsed.data.hours,
            previousVersion: parsed.data.version,
          }),
        ]
      );
      await requireSessionStepUp(client, session);
      await client.query('COMMIT');
      return { hours: parsed.data.hours, version: parsed.data.version + 1 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
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
    if (!parsed.success)
      rejectContentFields(parsed.error.issues, [
        'endpoint',
        'region',
        'bucket',
        'accessKeyId',
        'forcePathStyle',
        'privateEndpointUrl',
        'publicEndpointUrl',
        'secretAccessKey',
      ]);
    const current = await this.read();
    if (parsed.data.version !== current.version)
      throw new ConflictException({ error: 'STORAGE:CONFIG_CHANGED' });
    const input = parsed.data;
    const unapproved = unapprovedStorageEndpointFields(input);
    if (unapproved.length) throw new InputFieldException(unapproved);
    const locationChanged = changedLocation(input, current.config);
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
  private async authorize(session: MutationSession) {
    if (!session) throw new UnauthorizedException();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, session.userId, 'admin:storage:edit');
      await requireSessionStepUp(client, session);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async probe(
    config: ReturnType<typeof environmentStorageConfig>,
    session: MutationSession
  ) {
    let providers: ReturnType<typeof configuredStorageProviders>;
    try {
      providers = configuredStorageProviders(config, true);
    } catch {
      throw new ServiceUnavailableException({ error: 'STORAGE:CONNECTION_FAILED' });
    }
    const key = `_storage_probes/${randomUUID()}`;
    const expected = Buffer.from(`Barghsa storage probe ${randomUUID()}`);
    let attemptedUpload = false;
    let failure: unknown;
    try {
      for (const provider of [providers.internal, providers.browser]) {
        await this.authorize(session);
        await provider.listObjects('', 1);
      }
      await this.authorize(session);
      attemptedUpload = true;
      await providers.internal.putObject(key, expected, 'application/octet-stream');
      await this.authorize(session);
      const url = await providers.browser.presignedGetUrl(key, 60);
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('Probe download failed');
      const downloaded = await readCappedBytes(response.body, expected.byteLength);
      if (downloaded.truncated || !Buffer.from(downloaded.bytes).equals(expected))
        throw new Error('Probe content mismatch');
      await this.authorize(session);
    } catch (error) {
      failure =
        error instanceof HttpException
          ? error
          : new ServiceUnavailableException({ error: 'STORAGE:CONNECTION_FAILED' });
    } finally {
      try {
        // Trusted cleanup is limited to this server-generated disposable key,
        // including when a send or the final authority check was uncertain.
        if (attemptedUpload) await providers.internal.deleteObject(key);
      } catch {
        failure ??= new ServiceUnavailableException({ error: 'STORAGE:CONNECTION_FAILED' });
      } finally {
        providers.internal.destroy?.();
        providers.browser.destroy?.();
      }
    }
    if (failure) throw failure;
  }

  async test(raw: unknown, session: MutationSession) {
    await this.authorize(session);
    const { config } = await this.candidate(raw);
    await this.probe(config, session);
    return { success: true, message: 'Connection successful' };
  }
  async save(raw: unknown, session: MutationSession) {
    await this.authorize(session);
    const { config, current, locationChanged } = await this.candidate(raw);
    return this.activate(config, current, locationChanged, session);
  }

  history(session: MutationSession, before?: number) {
    return withStaffReadAuthority(session, 'admin:storage:edit', async (client) => {
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('storage.active'))");
      const baseVersion =
        (
          await client.query<{ version: number }>('SELECT version FROM app_config WHERE key=$1', [
            STORAGE_CONFIG_KEY,
          ])
        ).rows[0]?.version ?? 0;
      return {
        baseVersion,
        ...(await storageRevisions(client, Math.min(baseVersion, before ?? baseVersion))),
        draft: await currentStorageDraft(client, baseVersion),
      };
    });
  }

  async prepareRecovery(
    input: { sourceId: string; expectedVersion: number },
    session: MutationSession
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, session.userId, 'admin:storage:edit');
      await requireSessionStepUp(client, session);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('storage.active'))");
      const baseVersion =
        (
          await client.query<{ version: number }>('SELECT version FROM app_config WHERE key=$1', [
            STORAGE_CONFIG_KEY,
          ])
        ).rows[0]?.version ?? 0;
      if (baseVersion !== input.expectedVersion) throw changedConfig();
      const {
        items: [source],
      } = await storageRevisions(client, baseVersion, input.sourceId);
      if (!source) throw new NotFoundException({ error: 'NOT_FOUND' });
      if (unapprovedStorageEndpointFields({ ...source.config, accessKeyId: '' }).length)
        throw new BadRequestException({ error: 'STORAGE:ENDPOINT_UNAPPROVED' });
      let draft = await currentStorageDraft(client, baseVersion);
      if (draft?.sourceId !== input.sourceId) {
        draft = {
          id: randomUUID(),
          baseVersion,
          sourceId: source.id,
          sourceVersion: source.version,
          config: source.config,
        };
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
           VALUES($1,$2,'storage.config.rollback_draft',$3,$4,clock_timestamp())`,
          [
            draft.id,
            session.userId,
            JSON.stringify(draft),
            correlationIdStorage.getStore() ?? randomUUID(),
          ]
        );
      }
      await requireSessionStepUp(client, session);
      await client.query('COMMIT');
      return draft;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async activateRecovery(
    input: { draftId: string; expectedVersion: number },
    session: MutationSession
  ) {
    await this.authorize(session);
    const current = await this.read();
    if (input.expectedVersion !== current.version) throw changedConfig();
    const client = await getDbPool().connect();
    let draft: StorageRecoveryDraft | null;
    try {
      draft = await currentStorageDraft(client, current.version);
    } finally {
      client.release();
    }
    if (draft?.id !== input.draftId) throw changedConfig();
    const config = { ...current.config, ...draft.config };
    const locationChanged = changedLocation(config, current.config);
    if (locationChanged && config.secretAccessKey)
      throw new BadRequestException({ error: 'STORAGE:SECRET_REENTRY_REQUIRED' });
    if (!!config.accessKeyId !== !!config.secretAccessKey)
      throw new BadRequestException({ error: 'STORAGE:CREDENTIAL_PAIR_REQUIRED' });
    const active = await this.activate(config, current, locationChanged, session, draft);
    return { config: draft.config, version: active.version, draftId: draft.id };
  }

  private async activate(
    config: StorageSettings,
    current: Awaited<ReturnType<StorageConfigService['read']>>,
    locationChanged: boolean,
    session: MutationSession,
    draft?: StorageRecoveryDraft
  ) {
    const actor = session.userId;
    let encryptedSecret: string | null;
    try {
      encryptedSecret = encryptStorageSecret(config.secretAccessKey);
    } catch {
      throw new ServiceUnavailableException({ error: 'STORAGE:ENCRYPTION_UNAVAILABLE' });
    }
    await this.probe(config, session);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor, 'admin:storage:edit');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('storage.active'))");
      const verifiedAt = await requireSessionStepUp(client, session);
      const row = (
        await client.query<{ version: number }>(
          'SELECT version FROM app_config WHERE key=$1 FOR UPDATE',
          [STORAGE_CONFIG_KEY]
        )
      ).rows[0];
      if ((row?.version ?? 0) !== current.version) throw changedConfig();
      if (draft && (await currentStorageDraft(client, current.version))?.id !== draft.id)
        throw changedConfig();
      if (locationChanged) {
        // Serialize with upload reservations before changing where keys resolve.
        await client.query('LOCK TABLE storage_records IN SHARE ROW EXCLUSIVE MODE');
        if ((await client.query('SELECT 1 FROM storage_records LIMIT 1')).rows.length)
          throw new ConflictException({ error: 'STORAGE:LOCATION_IN_USE' });
      }
      const fields = { ...withoutCredentials(config), accessKeyId: config.accessKeyId };
      await client.query(
        `INSERT INTO app_config(key,value,version) VALUES ($1,$2::jsonb,1)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1,updated_at=NOW()`,
        [STORAGE_CONFIG_KEY, JSON.stringify({ ...fields, encryptedSecret })]
      );
      const version = current.version + 1;
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata)
        VALUES (uuid_generate_v7()::text,$1,'storage.config.updated',$2)`,
        [
          actor,
          JSON.stringify({
            version,
            previousVersion: current.version,
            ...(current.version > 0 && { previousSettings: withoutCredentials(current.config) }),
            ...(draft && {
              draftId: draft.id,
              sourceId: draft.sourceId,
              sourceVersion: draft.sourceVersion,
            }),
            stepUpVerified: true,
            stepUpVerifiedAt: verifiedAt.toISOString(),
          }),
        ]
      );
      await requireSessionStepUp(client, session);
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
