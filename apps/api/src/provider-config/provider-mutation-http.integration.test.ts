import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
const grants = JSON.stringify(['admin:notification-providers:edit']);
beforeAll(async () => {
  const priorKey = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = 'provider-mutation-fixture-key';
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    if (priorKey === undefined) delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = priorKey;
  }
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('provider-writer','Provider writer','Fixture',$1)",
    [grants]
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('provider-writer','provider-writer@example.test','test-only',true)"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('provider-writer','provider-writer')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'provider-writer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM email_provider_configs');
  await http.pool.query('DELETE FROM sms_provider_configs');
  await http.pool.query("DELETE FROM audit_log WHERE user_id='provider-writer'");
  await http.pool.query("UPDATE staff_roles SET permissions=$1 WHERE role_id='provider-writer'", [
    grants,
  ]);
});
async function snapshot(table: string) {
  return {
    providers: (await http.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows,
    audits: (
      await http.pool.query("SELECT * FROM audit_log WHERE user_id='provider-writer' ORDER BY id")
    ).rows,
  };
}
async function waitForLock() {
  await expect
    .poll(
      async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"
            )
          ).rows[0].count
        ),
      { timeout: 3000 }
    )
    .toBeGreaterThan(0);
}
for (const channel of ['email', 'sms']) {
  const table = `${channel}_provider_configs`;
  for (const action of ['create', 'update', 'activate', 'disable', 'rollback']) {
    async function seed() {
      const id = randomUUID();
      if (action !== 'create')
        await http.pool.query(
          `INSERT INTO ${table}(id,transport,label,status,config,created_by) VALUES ($1,$2,'Fixture','draft','{}','provider-writer')`,
          [id, channel === 'email' ? 'smtp' : 'smsir']
        );
      if (action === 'activate' || action === 'rollback')
        await http.pool.query(
          `UPDATE ${table} SET config=$2,last_test_status='passed',status=$3,activated_at=$4 WHERE id=$1`,
          [
            id,
            channel === 'email'
              ? {}
              : {
                  api_key: 'fixture-api-key',
                  sender: '9830000000',
                  timeout: 15,
                  throughput_limit: 100,
                  low_credit_threshold: 0,
                },
            action === 'rollback' ? 'superseded' : 'draft',
            action === 'rollback' ? new Date() : null,
          ]
        );
      return id;
    }
    function write(id: string) {
      if (action !== 'create' && action !== 'update')
        return fetch(`${http.base}/api/admin/${channel}-providers/${id}/${action}`, {
          method: 'POST',
          headers,
          body: '{}',
        });
      const config =
        channel === 'email'
          ? { host: 'smtp.example.test', password: 'fixture-password' }
          : {
              api_key: 'fixture-api-key',
              sender: '9830000000',
              timeout: 15,
              throughput_limit: 100,
              low_credit_threshold: 0,
            };
      const body =
        action === 'update'
          ? { label: 'Updated' }
          : { label: 'Created', config, ...(channel === 'email' ? { transport: 'smtp' } : {}) };
      return fetch(
        `${http.base}/api/admin/${channel}-providers${action === 'create' ? '' : '/' + id}`,
        { method: action === 'create' ? 'POST' : 'PUT', headers, body: JSON.stringify(body) }
      );
    }
    it(`${channel} ${action}: requires the current provider capability`, async () => {
      const id = await seed(),
        before = await snapshot(table);
      await http.pool.query(
        "UPDATE staff_roles SET permissions='[]' WHERE role_id='provider-writer'"
      );
      expect((await write(id)).status).toBe(403);
      expect(await snapshot(table)).toEqual(before);
    });
    it(`${channel} ${action}: commits one audit without exposing credentials`, async () => {
      const id = await seed();
      const response = await write(id);
      expect(response.status).toBe(action === 'create' ? 201 : 200);
      expect(await response.text()).not.toMatch(/fixture-password|fixture-api-key/);
      const state = await snapshot(table);
      expect(state.audits).toHaveLength(1);
      expect(state.audits[0].event).toBe(
        `${channel}_provider_${({ create: 'created', update: 'updated', activate: 'activated', disable: 'disabled', rollback: 'rolled_back' } as Record<string, string>)[action]}`
      );
      expect(JSON.stringify(state.audits)).not.toMatch(/fixture-password|fixture-api-key/);
      if (action === 'create')
        expect(state.providers[0].config[channel === 'email' ? 'password' : 'api_key']).toMatch(
          /^v1:/
        );
    });
    it(`${channel} ${action}: rolls back when the audit cannot persist`, async () => {
      const id = await seed(),
        before = await snapshot(table);
      await http.pool.query(
        "CREATE OR REPLACE FUNCTION reject_provider_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_provider_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_provider_audit()"
      );
      try {
        expect((await write(id)).status).toBe(500);
        expect(await snapshot(table)).toEqual(before);
      } finally {
        await http.pool.query('DROP TRIGGER reject_provider_audit ON audit_log');
      }
    });
    it(`${channel} ${action}: rejects revocation while waiting to write`, async () => {
      const id = await seed(),
        before = await snapshot(table);
      const blocker = await http.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`LOCK TABLE ${table} IN SHARE MODE`);
        await blocker.query(
          "UPDATE staff_roles SET permissions='[]' WHERE role_id='provider-writer'"
        );
        pending = write(id);
        await waitForLock();
        await blocker.query('COMMIT');
        expect((await pending).status).toBe(403);
        expect(await snapshot(table)).toEqual(before);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await pending;
      }
    });
    if (action === 'activate')
      it(`${channel} activate: maps the active constraint and rolls back`, async () => {
        const id = await seed(),
          before = await snapshot(table);
        await http.pool
          .query(`CREATE OR REPLACE FUNCTION reject_provider_activation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture active conflict' USING ERRCODE='23505',CONSTRAINT='uq_${channel}_provider_active'; END $$;
          CREATE TRIGGER reject_provider_activation BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_provider_activation()`);
        try {
          expect((await write(id)).status).toBe(409);
          expect(await snapshot(table)).toEqual(before);
        } finally {
          await http.pool.query(`DROP TRIGGER reject_provider_activation ON ${table}`);
        }
      });
    if (action === 'activate')
      it(`${channel} activate: rejects test invalidation while waiting`, async () => {
        const id = await seed();
        const blocker = await http.pool.connect();
        let pending: Promise<Response> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query(`UPDATE ${table} SET last_test_status='pending' WHERE id=$1`, [id]);
          pending = write(id);
          await waitForLock();
          await blocker.query('COMMIT');
          expect((await pending).status).toBe(409);
          const state = await snapshot(table);
          expect(state.providers[0]).toMatchObject({
            status: 'draft',
            last_test_status: 'pending',
          });
          expect(state.audits).toHaveLength(0);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await pending;
        }
      });
    if (action === 'update')
      it(`${channel} update: rechecks a draft promoted while waiting`, async () => {
        const id = await seed();
        const blocker = await http.pool.connect();
        let pending: Promise<Response> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            `UPDATE ${table} SET status='active',activated_at=NOW() WHERE id=$1`,
            [id]
          );
          pending = write(id);
          await waitForLock();
          await blocker.query('COMMIT');
          expect((await pending).status).toBe(409);
          const state = await snapshot(table);
          expect(state.providers[0]).toMatchObject({ status: 'active', label: 'Fixture' });
          expect(state.audits).toHaveLength(0);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await pending;
        }
      });
  }
}

it('sms rollback: invalid mappings leave no orphan clone or audit', async () => {
  const id = randomUUID();
  await http.pool.query(
    `INSERT INTO sms_provider_configs(id,transport,label,status,config,created_by,last_test_status,activated_at)
    VALUES ($1,'smsir','History','superseded',$2,'provider-writer','passed',NOW())`,
    [
      id,
      {
        api_key: 'fixture-api-key',
        sender: '9830000000',
        timeout: 15,
        throughput_limit: 100,
        low_credit_threshold: 0,
        template_mappings: [{ event_key: 'missing-event', template_id: '123' }],
      },
    ]
  );
  const before = await snapshot('sms_provider_configs');
  const response = await fetch(`${http.base}/api/admin/sms-providers/${id}/rollback`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  expect(response.status).toBe(409);
  expect(await snapshot('sms_provider_configs')).toEqual(before);
});

for (const channel of ['email', 'sms']) {
  for (const history of ['none', 'superseded', 'disabled']) {
    it(`${channel}: inactive ${history} history cannot replace the sole OTP provider`, async () => {
      const table = `${channel}_provider_configs`,
        id = randomUUID();
      await http.pool.query(
        `INSERT INTO ${table}(id,transport,label,status,config,created_by,last_test_status,activated_at) VALUES ($1,$2,'Active','active','{}','provider-writer','passed',NOW())`,
        [id, channel === 'email' ? 'smtp' : 'smsir']
      );
      if (history !== 'none')
        await http.pool.query(
          `INSERT INTO ${table}(id,transport,label,status,config,created_by,last_test_status,activated_at) VALUES ($1,$2,'History',$3,'{}','provider-writer','passed',NOW())`,
          [randomUUID(), channel === 'email' ? 'smtp' : 'smsir', history]
        );
      const before = await snapshot(table);
      const response = await fetch(`${http.base}/api/admin/${channel}-providers/${id}/disable`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('CONFLICT:INVALID_STATE');
      expect(await snapshot(table)).toEqual(before);
    });
  }
}
