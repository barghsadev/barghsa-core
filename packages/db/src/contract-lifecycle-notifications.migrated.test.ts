import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { activateReadyContracts } from './contract-activation';
import { cancelEmptyContract } from './test/cancel-empty-contract';
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
let counter = 0n;
beforeAll(async () => {
  db = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function identity() {
  const actor = randomUUID(),
    profile = randomUUID(),
    id = randomUUID(),
    version = randomUUID();
  await db.pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    actor,
  ]);
  await db.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
  return { actor, profile, id, version, number: String(9007199254740993n + counter++) };
}
async function create(
  f: Awaited<ReturnType<typeof identity>>,
  client: PoolClient,
  service: 'electricity' | 'savings' | 'solar' = 'savings'
) {
  await client.query(
    'INSERT INTO contracts(id,profile_id,service_type,current_version_id,contract_number) VALUES($1,$2,$5,$3,$4)',
    [f.id, f.profile, f.version, f.number, service]
  );
  await client.query(
    'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,\'{"text":"PRIVATE DRAFT TERMS SENTINEL"}\',\'Initial\',$3)',
    [f.version, f.id, f.actor]
  );
}
async function seed() {
  const f = await identity(),
    client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await create(f, client);
    await client.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [f.id]);
    await client.query(
      'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
      [f.id, f.version, f.actor]
    );
    await client.query(
      'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
      [f.id, f.version, f.actor]
    );
    await client.query('COMMIT');
    return f;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function snapshot(f: Awaited<ReturnType<typeof identity>>) {
  const outbox = (
    await db.pool.query('SELECT * FROM notification_outbox WHERE profile_id=$1 ORDER BY id', [
      f.profile,
    ])
  ).rows;
  const ids = outbox.map((row) => row.id);
  return {
    contract: (await db.pool.query('SELECT * FROM contracts WHERE id=$1', [f.id])).rows,
    activations: (
      await db.pool.query('SELECT * FROM contract_activations WHERE contract_id=$1', [f.id])
    ).rows,
    cancellations: (
      await db.pool.query('SELECT * FROM contract_cancellations WHERE contract_id=$1', [f.id])
    ).rows,
    intents: (
      await db.pool.query('SELECT * FROM contract_cancellation_intents WHERE contract_id=$1', [
        f.id,
      ])
    ).rows,
    audit: (
      await db.pool.query(
        "SELECT * FROM audit_log WHERE metadata::jsonb->>'contractId'=$1 ORDER BY id",
        [f.id]
      )
    ).rows,
    outbox,
    inbox: (
      await db.pool.query('SELECT * FROM in_app_notifications WHERE profile_id=$1 ORDER BY id', [
        f.profile,
      ])
    ).rows,
    jobs: (
      await db.pool.query(
        'SELECT * FROM notification_job WHERE outbox_id=ANY($1::uuid[]) ORDER BY id',
        [ids]
      )
    ).rows,
    logs: (
      await db.pool.query(
        'SELECT * FROM notification_delivery_log WHERE notification_id=ANY($1::uuid[]) ORDER BY id',
        [ids]
      )
    ).rows,
  };
}
it('delivers three exact private lifecycle occurrences without exposing draft terms or redelivering immediate inboxes', async () => {
  const f = await seed();
  expect(await activateReadyContracts(db.pool)).toMatchObject({ activated: 1 });
  await cancelEmptyContract(db.pool, f.id, f.actor);
  const saved = await snapshot(f);
  expect(saved.contract[0].state).toBe('Cancelled');
  expect(saved.outbox.map((row) => row.event_key)).toEqual([
    'contract.created',
    'contract.active',
    'contract.cancelled',
  ]);
  for (const row of saved.outbox) {
    expect(row.id[14]).toBe('7');
    expect(row).toMatchObject({
      profile_id: f.profile,
      user_id: f.actor,
      channels: ['in_app', 'email'],
      status: 'queued',
      idempotency_version: 2,
      max_attempts: 5,
      idempotency_key: `${row.event_key}:${f.id}:${f.version}:${f.actor}`,
      payload: { contractNumber: f.number },
    });
    const inbox = saved.inbox.find((n) => n.delivery_key === `outbox:${row.id}`)!;
    expect(inbox).toMatchObject({
      type: row.event_key,
      profile_id: f.profile,
      recipient_user_id: f.actor,
      operating_context: 'customer',
      is_read: false,
    });
    expect(inbox.id[14]).toBe('7');
    expect(inbox.localized_content.fa.body).toContain(f.number);
    expect(inbox.localized_content.en.body).toContain(f.number);
    expect(JSON.stringify(inbox.localized_content)).not.toContain('PRIVATE DRAFT TERMS SENTINEL');
    expect(
      saved.jobs
        .filter((job) => job.outbox_id === row.id)
        .sort((a, b) => a.channel.localeCompare(b.channel))
    ).toMatchObject([
      {
        channel: 'email',
        status: 'queued',
        attempts: 0,
        priority: row.event_key === 'contract.cancelled' ? 'urgent' : 'normal',
      },
      { channel: 'in_app', status: 'done', attempts: 1, provider_ref: inbox.id },
    ]);
    expect(saved.logs.filter((log) => log.notification_id === row.id)).toMatchObject([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox.id },
    ]);
  }
  expect(saved.outbox[0].payload).toEqual({
    contractNumber: f.number,
    contractId: f.id,
    contractType: 'صرفه‌جویی / Energy saving',
    link_route: '/contracts',
  });
  expect(saved.outbox[0].payload).not.toHaveProperty('content');
  expect(saved.outbox[2].payload.link_route).toBe(`/contracts/${f.id}`);
  const email = vi
      .fn()
      .mockResolvedValue({ status: 'delivered', providerRef: 'controlled-lifecycle-email' }),
    inApp = vi.fn();
  const worker = createRequire(__filename)(
    resolve(__dirname, '../../../apps/worker/dist/notifications/outbox-runner.js')
  );
  expect(
    await worker.runOutboxPoll({
      pool: db.pool,
      transports: {
        email: { channel: 'email', send: email },
        in_app: { channel: 'in_app', send: inApp },
      },
      availability: () => ({
        enabledChannels: { email: true, sms: true },
        verifiedEmail: true,
        verifiedPhone: false,
        marketingOptedIn: {},
      }),
      deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
    })
  ).toMatchObject({ leased: 3, delivered: 3, failed: 0 });
  expect(email).toHaveBeenCalledTimes(3);
  expect(inApp).not.toHaveBeenCalled();
  const delivered = await snapshot(f);
  expect(delivered.inbox).toEqual(saved.inbox);
  expect(delivered.logs.filter((row) => row.channel === 'in_app')).toEqual(saved.logs);
  expect(delivered.contract).toEqual(saved.contract);
  expect(delivered.audit).toEqual(saved.audit);
  await db.pool.query(
    'UPDATE in_app_notifications SET is_read=true,read_at=clock_timestamp() WHERE profile_id=$1',
    [f.profile]
  );
  const read = await snapshot(f);
  await expect(
    db.pool.query('UPDATE contracts SET state=state,updated_at=clock_timestamp() WHERE id=$1', [
      f.id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await db.pool.query(
        'INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2) ON CONFLICT(version_id) DO NOTHING',
        [f.id, f.version]
      )
    ).rowCount
  ).toBe(0);
  const unchanged = await snapshot(f);
  for (const key of ['outbox', 'inbox', 'jobs', 'logs'] as const)
    expect(unchanged[key]).toEqual(read[key]);
});
it.each([
  ['electricity', 'برق / Electricity'],
  ['savings', 'صرفه‌جویی / Energy saving'],
  ['solar', 'نیروگاه خورشیدی / Solar'],
] as const)(
  'stores readable creation type for %s without publishing its terms',
  async (kind, label) => {
    const f = await identity(),
      client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await create(f, client, kind);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const saved = await snapshot(f);
    expect(saved.contract[0].state).toBe('Draft');
    expect(saved.outbox[0].payload).toEqual({
      contractId: f.id,
      contractNumber: f.number,
      contractType: label,
      link_route: '/contracts',
    });
    expect(JSON.stringify(saved.inbox)).not.toContain('PRIVATE DRAFT TERMS SENTINEL');
  }
);
it('keeps an unpublished cancellation on the accessible contract list instead of a private draft URL', async () => {
  const f = await identity(),
    client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await create(f, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await cancelEmptyContract(db.pool, f.id, f.actor);
  const saved = await snapshot(f),
    outbox = saved.outbox.find((row) => row.event_key === 'contract.cancelled');
  expect(outbox.payload).toMatchObject({
    contractId: f.id,
    contractNumber: f.number,
    link_route: '/contracts',
  });
  expect(saved.inbox.find((row) => row.type === 'contract.cancelled').link_route).toBe(
    '/contracts'
  );
});
it.each([false, true])(
  'preserves or rejects a retained occurrence with changed data=%s',
  async (changed) => {
    const f = await identity();
    const data = {
      contractId: f.id,
      contractNumber: changed ? 'different' : f.number,
      contractType: 'صرفه‌جویی / Energy saving',
      link_route: '/contracts',
    };
    const key = `contract.created:${f.id}:${f.version}:${f.actor}`;
    const outbox = (
      await db.pool.query(
        "INSERT INTO notification_outbox(profile_id,user_id,event_key,payload,channels,status,idempotency_key) VALUES($1,$2,'contract.created',$3,ARRAY['in_app','email'],'delivered',$4) RETURNING id",
        [f.profile, f.actor, data, key]
      )
    ).rows[0].id;
    const notice = (
      await db.pool.query(
        "INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,params,localized_content,link_route,delivery_key,is_read,read_at) VALUES($1,$2,'customer','contract.created','notifications.legacy.title','notifications.legacy.body',$3,$4,'/contracts','outbox:'||$5::text,true,clock_timestamp()) RETURNING id",
        [
          f.profile,
          f.actor,
          data,
          { fa: { title: 'قرارداد', body: f.number }, en: { title: 'Contract', body: f.number } },
          outbox,
        ]
      )
    ).rows[0].id;
    await db.pool.query(
      "INSERT INTO notification_job(outbox_id,channel,status,priority,attempts,provider_ref) VALUES($1,'in_app','done','normal',1,$2),($1,'email','done','normal',1,'retained-email')",
      [outbox, notice]
    );
    await db.pool.query(
      "INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref) VALUES($1,'in_app','delivered',1,$2)",
      [outbox, notice]
    );
    const saved = await snapshot(f),
      client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      if (changed) {
        await expect(create(f, client)).rejects.toThrow('conflicts with saved delivery');
        await client.query('ROLLBACK');
      } else {
        await create(f, client);
        await client.query('COMMIT');
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const after = await snapshot(f);
    if (changed) expect(after).toEqual(saved);
    else {
      for (const field of ['outbox', 'inbox', 'jobs', 'logs'] as const)
        expect(after[field]).toEqual(saved[field]);
      expect(after.inbox[0].is_read).toBe(true);
      expect(after.contract).toHaveLength(1);
    }
  }
);
for (const lifecycle of ['created', 'active', 'cancelled'] as const) {
  for (const table of [
    'notification_outbox',
    'in_app_notifications',
    'notification_job',
    'notification_delivery_log',
  ] as const) {
    for (const failure of ['raise', 'suppress'] as const) {
      it(`rolls back ${lifecycle} and all delivery evidence when ${table} ${failure}s a write`, async () => {
        const f = lifecycle === 'created' ? await identity() : await seed();
        const saved = await snapshot(f);
        await db.pool.query(
          `CREATE FUNCTION fail_lifecycle_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${failure === 'raise' ? "RAISE EXCEPTION 'test lifecycle failure';" : 'RETURN NULL;'} END $$; CREATE TRIGGER fail_lifecycle_delivery BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_lifecycle_delivery()`
        );
        const act = async () => {
          if (lifecycle === 'active') {
            await db.pool.query(
              'INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)',
              [f.id, f.version]
            );
            return;
          }
          if (lifecycle === 'cancelled') {
            await cancelEmptyContract(db.pool, f.id, f.actor);
            return;
          }
          const client = await db.pool.connect();
          try {
            await client.query('BEGIN');
            await create(f, client);
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        };
        try {
          await expect(act()).rejects.toThrow();
        } finally {
          await db.pool.query(
            `DROP TRIGGER fail_lifecycle_delivery ON ${table}; DROP FUNCTION fail_lifecycle_delivery()`
          );
        }
        expect(await snapshot(f)).toEqual(saved);
        await act();
        const recovered = await snapshot(f);
        expect(
          recovered.outbox.filter((row) => row.event_key === `contract.${lifecycle}`)
        ).toHaveLength(1);
        expect(recovered.contract[0].state).toBe(
          lifecycle === 'created' ? 'Draft' : lifecycle === 'active' ? 'Active' : 'Cancelled'
        );
      });
    }
  }
}
