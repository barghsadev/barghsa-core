import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { notifyConsultationStatus } from './consultation-status-notifications.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const content = {
  title: 'Consultation status changed',
  localizedContent: {
    fa: { title: 'مشاوره', body: 'وضعیت مشاوره تغییر کرد' },
    en: { title: 'Consultation', body: 'Status changed' },
  },
};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function fixture() {
  const owner = randomUUID(),
    manager = randomUUID(),
    next = randomUUID();
  for (const id of [owner, manager, next])
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'fixture')",
      [id, `${id}@example.test`]
    );
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES($1,'LEGAL','ACTIVE') RETURNING id",
      [owner]
    )
  ).rows[0].id as string;
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Manager')",
    [profile, manager]
  );
  const id = uuidv7(),
    event = uuidv7();
  await http.pool.query(
    "INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,submitted_by,submission_key,status) SELECT $1,$2,id,'{}',$3,$4,'submitted' FROM products WHERE system_key='electricity_generation_station'",
    [id, profile, manager, randomUUID()]
  );
  await http.pool.query(
    "INSERT INTO consultation_request_events(id,request_id,status,actor_user_id) VALUES($1,$2,'submitted',$3)",
    [event, id, manager]
  );
  return { owner, manager, next, id, profile };
}
async function change(
  f: Awaited<ReturnType<typeof fixture>>,
  status: string,
  oldStatus = 'submitted',
  beforeNotify?: () => Promise<void>
) {
  const client = await http.pool.connect(),
    event = uuidv7();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE consultation_requests SET status=$2 WHERE id=$1', [f.id, status]);
    await client.query(
      'INSERT INTO consultation_request_events(id,request_id,status,actor_user_id) VALUES($1,$2,$3,$4)',
      [event, f.id, status, f.owner]
    );
    await beforeNotify?.();
    await notifyConsultationStatus(
      client,
      { id: f.id, profile_id: f.profile, submitted_by: f.manager, status: oldStatus },
      status,
      content
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return event;
}
const notices = async (f: Awaited<ReturnType<typeof fixture>>, recipient: string) =>
  (
    await http.pool.query(
      'SELECT * FROM in_app_notifications WHERE profile_id=$1 AND recipient_user_id=$2 ORDER BY created_at,id',
      [f.profile, recipient]
    )
  ).rows;
it('keeps repeated states as separate history occurrences and serializes duplicate delivery without rewriting read state', async () => {
  const f = await fixture();
  const ids = [
    await change(f, 'under_review'),
    await change(f, 'awaiting_customer_info', 'under_review'),
    await change(f, 'under_review', 'awaiting_customer_info'),
  ];
  const outbox = (
    await http.pool.query(
      'SELECT * FROM notification_outbox WHERE profile_id=$1 ORDER BY created_at,id',
      [f.profile]
    )
  ).rows;
  expect(outbox).toHaveLength(3);
  expect(outbox.map((r) => r.idempotency_key)).toEqual(
    ids.map((id) => `order.status_changed:consultation:${f.id}:${id}:${f.owner}`)
  );
  expect(outbox.map((r) => r.payload.status)).toEqual([
    'under_review',
    'awaiting_customer_info',
    'under_review',
  ]);
  expect(outbox.every((r) => r.user_id === f.owner && r.event_key === 'order.status_changed')).toBe(
    true
  );
  const before = await notices(f, f.owner);
  expect(before).toHaveLength(3);
  await http.pool.query('UPDATE in_app_notifications SET is_read=true,read_at=NOW() WHERE id=$1', [
    before[2].id,
  ]);
  const snapshot = await notices(f, f.owner);
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      const client = await http.pool.connect();
      try {
        await client.query('BEGIN');
        await notifyConsultationStatus(
          client,
          {
            id: f.id,
            profile_id: f.profile,
            submitted_by: f.manager,
            status: 'awaiting_customer_info',
          },
          'under_review',
          content
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );
  expect(await notices(f, f.owner)).toEqual(snapshot);
  expect(await notices(f, f.manager)).toHaveLength(3);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM notification_outbox WHERE profile_id=$1',
        [f.profile]
      )
    ).rows[0].count
  ).toBe(3);
});
it.each(['revoked', 'disabled'] as const)(
  'keeps the owner delivery private and omits a %s original manager submitter',
  async (condition) => {
    const f = await fixture();
    await change(f, 'under_review');
    const original = await notices(f, f.manager);
    expect(original).toHaveLength(1);
    await change(f, 'awaiting_customer_info', 'under_review', async () => {
      if (condition === 'revoked')
        await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
          f.profile,
          f.manager,
        ]);
      else
        await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.manager]);
    });
    expect(await notices(f, f.manager)).toEqual(original);
    expect(await notices(f, f.owner)).toHaveLength(2);
    expect(
      (
        await http.pool.query(
          'SELECT user_id,channels FROM notification_outbox WHERE profile_id=$1',
          [f.profile]
        )
      ).rows
    ).toEqual([
      { user_id: f.owner, channels: ['in_app', 'email'] },
      { user_id: f.owner, channels: ['in_app', 'email'] },
    ]);
  }
);
it('resolves the current profile owner instead of retaining an earlier owner recipient', async () => {
  const f = await fixture();
  await http.pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, f.next]);
  await change(f, 'under_review');
  expect(await notices(f, f.owner)).toEqual([]);
  expect(await notices(f, f.next)).toHaveLength(1);
  expect(
    (
      await http.pool.query('SELECT user_id FROM notification_outbox WHERE profile_id=$1', [
        f.profile,
      ])
    ).rows
  ).toEqual([{ user_id: f.next }]);
});
it('keeps a same-state informational update in the inbox without inventing a status transition', async () => {
  const f = await fixture();
  await change(f, 'under_review');
  await change(f, 'under_review', 'under_review');
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM notification_outbox WHERE profile_id=$1',
        [f.profile]
      )
    ).rows[0].count
  ).toBe(1);
  expect((await notices(f, f.owner)).map((r) => r.type)).toEqual([
    'order.status_changed',
    'general',
  ]);
});
it('fails closed without a matching saved state/history and leaves every prior delivery intact', async () => {
  const f = await fixture();
  await change(f, 'under_review');
  const before = await notices(f, f.owner);
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await expect(
      notifyConsultationStatus(
        client,
        { id: f.id, profile_id: f.profile, submitted_by: f.manager, status: 'under_review' },
        'awaiting_customer_info',
        content
      )
    ).rejects.toThrow('saved status');
    await client.query(
      "UPDATE consultation_requests SET status='awaiting_customer_info' WHERE id=$1",
      [f.id]
    );
    await expect(
      notifyConsultationStatus(
        client,
        { id: f.id, profile_id: f.profile, submitted_by: f.manager, status: 'under_review' },
        'awaiting_customer_info',
        content
      )
    ).rejects.toThrow('saved history');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await notices(f, f.owner)).toEqual(before);
  expect(
    (await http.pool.query('SELECT status FROM consultation_requests WHERE id=$1', [f.id])).rows[0]
      .status
  ).toBe('under_review');
});
it.each(['raise', 'suppress'])(
  'rolls back the native occurrence when an authorized manager inbox write is %s',
  async (mode) => {
    const f = await fixture();
    await http.pool.query(
      `CREATE FUNCTION fail_manager_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.recipient_user_id='${f.manager}' THEN ${mode === 'raise' ? "RAISE EXCEPTION 'manager inbox unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_manager_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_manager_notice()`
    );
    try {
      await expect(change(f, 'under_review')).rejects.toThrow(
        mode === 'raise' ? 'manager inbox' : 'Private consultation inbox'
      );
      expect(
        (await http.pool.query('SELECT status FROM consultation_requests WHERE id=$1', [f.id]))
          .rows[0].status
      ).toBe('submitted');
      expect(
        (
          await http.pool.query(
            'SELECT status FROM consultation_request_events WHERE request_id=$1',
            [f.id]
          )
        ).rows
      ).toEqual([{ status: 'submitted' }]);
      expect(
        (
          await http.pool.query('SELECT * FROM notification_outbox WHERE profile_id=$1', [
            f.profile,
          ])
        ).rows
      ).toEqual([]);
      expect(await notices(f, f.owner)).toEqual([]);
      expect(await notices(f, f.manager)).toEqual([]);
    } finally {
      await http.pool.query(
        'DROP TRIGGER fail_manager_notice ON in_app_notifications; DROP FUNCTION fail_manager_notice()'
      );
    }
    await change(f, 'under_review');
    expect(await notices(f, f.owner)).toHaveLength(1);
    expect(await notices(f, f.manager)).toHaveLength(1);
  }
);
