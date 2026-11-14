import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
  DEFAULT_CONTRACT_ELECTRICITY_LIMITS,
  DEFAULT_ESCALATION_POLICIES,
  DEFAULT_SERVICE_RESPONSE_TARGETS,
} from '@barghsa/shared/admin';
import {
  DEFAULT_GREEN_ELECTRICITY_CONFIG,
  GREEN_ELECTRICITY_CONFIG_KEY,
} from '@barghsa/shared/finance';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import {
  activationHistoryQuery,
  configActivations,
  readConfigActivationHistory,
} from './config-activation-history.js';
import {
  contractLimitDraftEvent,
  contractLimitHistory,
  readContractLimitDraft,
} from './contract-limit-recovery.js';
import {
  electricityRecoveryDraftEvent,
  electricitySettingHistory,
  electricitySettingKeys,
  readElectricitySettingDraft,
} from './electricity-setting-recovery.js';
import {
  GREEN_RECOVERY_EVENT,
  readGreenRuleDraft,
  readGreenRuleHistory,
  readGreenRuleVersion,
} from './green-electricity-recovery.js';
import {
  serviceRecoveryDraftEvent,
  serviceSettingDraft,
  serviceSettingHistory,
  serviceSettingRow,
  serviceSettings,
} from './service-settings-recovery.js';

const database = vi.hoisted(() => ({ pool: undefined as Pool | undefined }));
vi.mock('@barghsa/db', () => ({ getDbPool: () => database.pool }));

const userId = 'recovery-reader';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  database.pool = fixture.pool;
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,'recovery-reader@example.test','test-only',true)",
    [userId]
  );
}, 30_000);
afterAll(async () => {
  await fixture?.close();
  database.pool = undefined;
});

async function transaction(run: (client: PoolClient) => Promise<void>) {
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

async function audit(
  client: Pick<PoolClient, 'query'>,
  event: string,
  metadata: unknown,
  offset = 0
) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO audit_log(id,user_id,event,metadata,created_at) VALUES($1,$2,$3,$4,clock_timestamp()+($5::integer * INTERVAL '1 second'))",
    [id, userId, event, typeof metadata === 'string' ? metadata : JSON.stringify(metadata), offset]
  );
  return id;
}

type Recovery = {
  name: string;
  key: string;
  event: string;
  draftEvent: string;
  stored: unknown;
  config: unknown;
  invalid: unknown;
  invalidDraft?: unknown;
  revision: (version: unknown, value: unknown) => object;
  history: (
    c: PoolClient,
    cutoff: number,
    id?: string
  ) => Promise<{
    items: { id: string; version: number; config: unknown }[];
    nextBeforeVersion: number | null;
  }>;
  draft: (c: PoolClient, version: number) => Promise<unknown>;
};
const limits = { ...DEFAULT_CONTRACT_ELECTRICITY_LIMITS, leadTimeDays: 3 };
const templateId = randomUUID();
const targets = { ticket: 24 };
const escalation = {
  ticket: {
    level2: { delayHours: 2, channels: ['in_app', 'email'] },
    level3: { delayHours: null, channels: ['in_app'] },
  },
};
const standardRevision = (version: unknown, value: unknown) => ({ version, newValue: value });
const recoveries: Recovery[] = [
  {
    name: 'contract limits',
    key: CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
    event: 'change_recorded',
    draftEvent: contractLimitDraftEvent,
    stored: limits,
    config: limits,
    invalid: { ...limits, leadTimeDays: -1 },
    revision: (version, value) => ({
      version,
      newValue: value,
      entity: 'contract_electricity_limits',
      action: 'updated',
    }),
    history: contractLimitHistory,
    draft: readContractLimitDraft,
  },
  {
    name: 'wizard draft retention',
    key: electricitySettingKeys['wizard-draft-ttl'],
    event: 'config_change',
    draftEvent: electricityRecoveryDraftEvent,
    stored: 20,
    config: { days: 20 },
    invalid: 0,
    invalidDraft: { days: 366 },
    revision: standardRevision,
    history: (c, version, id) => electricitySettingHistory(c, 'wizard-draft-ttl', version, id),
    draft: (c, version) => readElectricitySettingDraft(c, 'wizard-draft-ttl', version),
  },
  {
    name: 'electricity contract templates',
    key: electricitySettingKeys['electricity-contract-template'],
    event: 'config_change',
    draftEvent: electricityRecoveryDraftEvent,
    stored: templateId,
    config: { versionId: templateId },
    invalid: 'corrupt template id',
    invalidDraft: { versionId: templateId, unrelated: true },
    revision: standardRevision,
    history: (c, version, id) =>
      electricitySettingHistory(c, 'electricity-contract-template', version, id),
    draft: (c, version) => readElectricitySettingDraft(c, 'electricity-contract-template', version),
  },
  {
    name: 'green electricity',
    key: GREEN_ELECTRICITY_CONFIG_KEY,
    event: 'config_change',
    draftEvent: GREEN_RECOVERY_EVENT,
    stored: DEFAULT_GREEN_ELECTRICITY_CONFIG,
    config: DEFAULT_GREEN_ELECTRICITY_CONFIG,
    invalid: {},
    revision: standardRevision,
    history: readGreenRuleHistory,
    draft: readGreenRuleDraft,
  },
  {
    name: 'response targets',
    key: serviceSettings.targets.key,
    event: 'config_change',
    draftEvent: serviceRecoveryDraftEvent,
    stored: targets,
    config: { ...DEFAULT_SERVICE_RESPONSE_TARGETS, ...targets },
    invalid: { ticket: 0 },
    revision: standardRevision,
    history: (c, version, id) => serviceSettingHistory(c, 'targets', version, id),
    draft: (c, version) => serviceSettingDraft(c, 'targets', version),
  },
  {
    name: 'escalation policy',
    key: serviceSettings.escalation.key,
    event: 'config_change',
    draftEvent: serviceRecoveryDraftEvent,
    stored: escalation,
    config: { ...DEFAULT_ESCALATION_POLICIES, ...escalation },
    invalid: { ticket: { level2: { channels: ['email'] }, level3: {} } },
    revision: standardRevision,
    history: (c, version, id) => serviceSettingHistory(c, 'escalation', version, id),
    draft: (c, version) => serviceSettingDraft(c, 'escalation', version),
  },
];

describe.each(recoveries)('$name configuration recovery', (recovery) => {
  it('preserves the audit cursor when invalid values leave holes in the first page', async () => {
    await transaction(async (client) => {
      const row = (version: unknown, value: unknown) =>
        audit(client, recovery.event, { key: recovery.key, ...recovery.revision(version, value) });
      const ids = new Map<number, string>();
      for (let version = 1; version <= 24; version++) {
        ids.set(version, await row(version, version === 17 ? recovery.invalid : recovery.stored));
      }
      await row(24.5, recovery.stored);
      await row(25, recovery.stored);
      await row('24', recovery.stored);
      await audit(client, recovery.event, 'invalid legacy audit metadata');
      await audit(client, recovery.event, ['not a revision']);
      await audit(client, recovery.event, {
        ...recovery.revision(24, recovery.stored),
        key: 'fixture.other_configuration',
      });

      const values = (versions: number[]) =>
        versions.map((version) => ({ id: ids.get(version), version, config: recovery.config }));
      const first = await recovery.history(client, 25);
      expect(first).toEqual({
        items: values(Array.from({ length: 20 }, (_, i) => 24 - i).filter((v) => v !== 17)),
        nextBeforeVersion: 5,
      });
      expect(await recovery.history(client, first.nextBeforeVersion!)).toEqual({
        items: values([4, 3, 2, 1]),
        nextBeforeVersion: null,
      });
      expect(await recovery.history(client, 25, ids.get(3))).toEqual({
        items: values([3]),
        nextBeforeVersion: null,
      });
      expect(await recovery.history(client, 25, ids.get(17))).toEqual({
        items: [],
        nextBeforeVersion: null,
      });
    });
  });

  it('rejects ineligible latest drafts and never substitutes an older draft', async () => {
    await transaction(async (client) => {
      const baseVersion = 9;
      const sourceId = randomUUID();
      const scope = { baseVersion, key: recovery.key };
      expect(await recovery.draft(client, baseVersion)).toBeNull();
      const original = { sourceId, sourceVersion: 3, config: recovery.config };
      const id = await audit(client, recovery.draftEvent, { ...scope, ...original });
      expect(await recovery.draft(client, baseVersion)).toEqual({ ...original, id, baseVersion });
      expect(await recovery.draft(client, baseVersion + 1)).toBeNull();
      for (const [i, corrupt] of [
        { ...original, sourceId: 'malformed' },
        { ...original, sourceVersion: baseVersion },
        { ...original, config: recovery.invalidDraft ?? recovery.invalid },
      ].entries()) {
        await audit(client, recovery.draftEvent, { ...scope, ...corrupt }, i + 1);
        expect(await recovery.draft(client, baseVersion)).toBeNull();
      }
    });
  });
});

it('reads the current green version and locks only the requested service configuration row', async () => {
  await transaction(async (client) => {
    await client.query('DELETE FROM app_config WHERE key=$1', [GREEN_ELECTRICITY_CONFIG_KEY]);
    expect(await readGreenRuleVersion(client)).toBe(0);
    await client.query('INSERT INTO app_config(key,value,version) VALUES ($1,$2,3)', [
      GREEN_ELECTRICITY_CONFIG_KEY,
      DEFAULT_GREEN_ELECTRICITY_CONFIG,
    ]);
    expect(await readGreenRuleVersion(client)).toBe(3);
    const key = serviceSettings.targets.key;
    await client.query(
      'INSERT INTO app_config(key,value,version) VALUES ($1,$2,7) ON CONFLICT(key) DO UPDATE SET value=$2,version=7',
      [key, targets]
    );
    expect(await serviceSettingRow(client, 'targets')).toEqual({ value: targets, version: 7 });
    expect(await serviceSettingRow(client, 'targets', true)).toEqual({
      value: targets,
      version: 7,
    });
  });
});

it('resolves only proper activations, including earlier policy records without an action', async () => {
  await transaction(async (client) => {
    const key = 'fixture.profile_verification';
    const valid = (value: unknown): value is boolean => typeof value === 'boolean';
    const revision = (version: unknown, value: unknown, action: string | undefined = 'activate') =>
      audit(client, 'config_change', {
        key,
        action,
        next: { version, policy: value, active: value },
      });
    await revision('24', true);
    await revision(24.5, true);
    await revision(25, true);
    await revision(24, true, 'draft');
    const legacy = await audit(client, 'config_change', {
      key,
      next: { version: 2, policy: true, active: true },
    });
    const ids = new Map<number, string>();
    for (let version = 3; version <= 24; version++) {
      ids.set(version, await revision(version, version === 17 ? 'invalid' : true));
    }
    const first = await configActivations(client, key, 'policy', valid, { beforeVersion: 25 });
    expect(first).toEqual({
      items: Array.from({ length: 20 }, (_, i) => 24 - i)
        .filter((version) => version !== 17)
        .map((version) => ({ id: ids.get(version), version, value: true })),
      nextBeforeVersion: 5,
    });
    expect(await configActivations(client, key, 'policy', valid, { sourceId: legacy })).toEqual({
      items: [{ id: legacy, version: 2, value: true }],
      nextBeforeVersion: null,
    });
    expect(await configActivations(client, key, 'active', valid, { sourceId: legacy })).toEqual({
      items: [],
      nextBeforeVersion: null,
    });
    expect(activationHistoryQuery.parse({ beforeVersion: '5' })).toEqual({ beforeVersion: 5 });
    expect(activationHistoryQuery.safeParse({ beforeVersion: '2147483648' }).success).toBe(false);
  });
});

it('requires a current staff grant and session for reading activation history', async () => {
  const key = 'fixture.activation_authority';
  const pool = fixture.pool;
  await pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('test-config-history','Config reader','Fixture',$1::jsonb)",
    [JSON.stringify(['admin:config:read'])]
  );
  await pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,'test-config-history')", [
    userId,
  ]);
  const actor = { userId, sessionId: randomUUID(), csrfToken: randomUUID() };
  await pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '30 minutes')",
    [actor.sessionId, actor.userId, actor.csrfToken, randomUUID()]
  );
  const id = await audit(pool, 'config_change', {
    key,
    action: 'activate',
    next: { version: 3, active: true },
  });
  const valid = (value: unknown): value is boolean => typeof value === 'boolean';
  await expect(readConfigActivationHistory(actor, key, 'active', valid)).resolves.toEqual({
    items: [{ id, version: 3, value: true }],
    nextBeforeVersion: null,
  });
  await pool.query('UPDATE sessions SET revoked_at=now() WHERE session_id=$1', [actor.sessionId]);
  await expect(readConfigActivationHistory(actor, key, 'active', valid)).rejects.toMatchObject({
    status: 401,
  });
  await pool.query("DELETE FROM user_roles WHERE user_id=$1 AND role_id='test-config-history'", [
    userId,
  ]);
  await expect(readConfigActivationHistory(actor, key, 'active', valid)).rejects.toMatchObject({
    status: 403,
  });
  expect((await pool.query('SELECT id FROM audit_log WHERE id=$1', [id])).rows).toEqual([{ id }]);
});
