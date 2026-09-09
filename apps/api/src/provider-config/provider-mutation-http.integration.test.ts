import { EmailProviderConfigService } from './email-provider-config.service.js';
import { SmsProviderConfigService } from './sms-provider-config.service.js';
import { EmailCircuitBreakerService } from './email-circuit-breaker.service.js';
import { SmtpConnectionTesterService } from './smtp-connection-tester.service.js';
import { SmsirConnectionTesterService } from './smsir-connection-tester.service.js';
import { ProviderSecretsService } from './provider-secrets.service.js';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
const session = randomUUID(),
  csrf = randomUUID();
const actor = { userId: 'provider-writer', sessionId: session, csrfToken: csrf };
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
    "INSERT INTO users(user_id,username,mobile,password_hash,is_staff) VALUES ('provider-writer','provider-writer@example.test','+989121234567','test-only',true)"
  );
  await http.pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ('+989121234567','provider-writer','mobile',NOW())"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('provider-writer','provider-writer')"
  );
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
  await http.pool.query(
    "UPDATE sessions SET csrf_token=$2,revoked_at=NULL,expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '1 hour',step_up_verified_at=NOW() WHERE session_id=$1",
    [session, csrf]
  );
  await http.pool.query('DELETE FROM email_provider_configs');
  await http.pool.query('DELETE FROM sms_provider_configs');
  await http.pool.query("DELETE FROM audit_log WHERE user_id='provider-writer'");
  await http.pool.query("UPDATE staff_roles SET permissions=$1 WHERE role_id='provider-writer'", [
    grants,
  ]);
  await http.pool.query('DELETE FROM notification_templates');
  await http.pool.query(
    `INSERT INTO notification_templates(id,event_key,channel,locale,body_template,variables,status,is_active,version,published_at)
    VALUES($1,'auth.otp','sms','en','Code {{code}}','["code"]','active',true,1,NOW())`,
    [randomUUID()]
  );
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
  for (const action of ['create', 'update', 'activate', 'disable', 'rollback', 'test-connection']) {
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
                  template_mappings: [
                    { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
                  ],
                },
            action === 'rollback' ? 'superseded' : 'draft',
            action === 'rollback' ? new Date() : null,
          ]
        );
      if (action !== 'create')
        await http.pool.query(
          `UPDATE ${table} SET last_test_status='passed',last_test_at=NOW(),delivery_verified_at=NOW(),
          delivery_config_hash=encode(sha256(convert_to(jsonb_build_array(transport,config)::text,'UTF8')),'hex') WHERE id=$1`,
          [id]
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
              template_mappings: [
                { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
              ],
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
    if (action !== 'rollback')
      it(`${channel} ${action}: commits one audit without exposing credentials`, async () => {
        const id = await seed();
        const response = await write(id);
        expect(response.status).toBe(action === 'create' ? 201 : 200);
        expect(await response.text()).not.toMatch(/fixture-password|fixture-api-key/);
        const state = await snapshot(table);
        expect(state.audits).toHaveLength(1);
        const metadata = JSON.parse(state.audits[0].metadata);
        expect(metadata).toMatchObject({ sessionId: session, stepUpVerified: true });
        expect(metadata.stepUpVerifiedAt).toBe(
          (
            await http.pool.query('SELECT step_up_verified_at FROM sessions WHERE session_id=$1', [
              session,
            ])
          ).rows[0].step_up_verified_at.toISOString()
        );
        expect(state.audits[0].correlation_id).toBe(response.headers.get('x-correlation-id'));
        expect(state.audits[0].event).toBe(
          `${channel}_provider_${({ create: 'created', update: 'updated', activate: 'activated', disable: 'disabled', rollback: 'rolled_back', 'test-connection': 'tested' } as Record<string, string>)[action]}`
        );
        expect(JSON.stringify(state.audits)).not.toMatch(/fixture-password|fixture-api-key/);
        if (action === 'create')
          expect(state.providers[0].config[channel === 'email' ? 'password' : 'api_key']).toMatch(
            /^v1:/
          );
      });
    for (const change of ['expiry', 'csrf', 'step-up'] as const) {
      it(`${channel} ${action}: rejects ${change} changed after guards while waiting for the family lock`, async () => {
        const id = await seed(),
          before = await snapshot(table);
        const blocker = await http.pool.connect();
        let pending: Promise<Response> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `notification-provider:${channel}`,
          ]);
          const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          pending = write(id);
          await expect
            .poll(
              async () =>
                Number(
                  (
                    await http.pool.query(
                      "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT pg_advisory_xact_lock%'",
                      [pid]
                    )
                  ).rows[0].count
                ),
              { timeout: 3000 }
            )
            .toBe(1);
          const assignment =
            change === 'expiry'
              ? "expires_at=NOW()-INTERVAL '1 second'"
              : change === 'csrf'
                ? "csrf_token='changed-after-guard'"
                : "step_up_verified_at=NOW()-INTERVAL '1 day'";
          await http.pool.query(`UPDATE sessions SET ${assignment} WHERE session_id=$1`, [session]);
          await blocker.query('COMMIT');
          expect((await pending).status).toBe(change === 'expiry' ? 401 : 403);
          expect(await snapshot(table)).toEqual(before);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await pending;
        }
      });
    }
    if (action === 'create')
      for (const change of ['expiry', 'csrf', 'step-up'] as const) {
        it(`${channel}: rolls back provider and audit when ${change} changes before commit`, async () => {
          const id = await seed(),
            before = await snapshot(table);
          const assignment =
            change === 'expiry'
              ? "expires_at=NOW()-INTERVAL '1 second'"
              : change === 'csrf'
                ? "csrf_token='changed-at-audit'"
                : "step_up_verified_at=NOW()-INTERVAL '1 day'";
          await http.pool.query(
            `CREATE OR REPLACE FUNCTION invalidate_provider_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE sessions SET ${assignment} WHERE session_id='${session}'; RETURN NEW; END $$; CREATE TRIGGER invalidate_provider_session BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION invalidate_provider_session()`
          );
          try {
            expect((await write(id)).status).toBe(change === 'expiry' ? 401 : 403);
            expect(await snapshot(table)).toEqual(before);
          } finally {
            await http.pool.query('DROP TRIGGER invalidate_provider_session ON audit_log');
          }
        });
      }
    if (action !== 'rollback')
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
        `INSERT INTO ${table}(id,transport,label,status,config,created_by,last_test_status,activated_at) VALUES ($1,$2,'Active','draft','{}','provider-writer','passed',NOW())`,
        [id, channel === 'email' ? 'smtp' : 'smsir']
      );
      await http.pool.query(
        `UPDATE ${table} SET status='active',last_test_at=NOW(),delivery_verified_at=NOW(),
        delivery_config_hash=encode(sha256(convert_to(jsonb_build_array(transport,config)::text,'UTF8')),'hex') WHERE id=$1`,
        [id]
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
      expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT:INVALID_STATE' } });
      expect(await snapshot(table)).toEqual(before);
    });
  }
}

for (const channel of ['email', 'sms']) {
  for (const concurrent of ['edit', 'revoke', 'audit-failure']) {
    it(`${channel} server test: holds authority and settings through ${concurrent}`, async () => {
      const id = randomUUID(),
        table = `${channel}_provider_configs`;
      const config =
        channel === 'email'
          ? {
              host: 'smtp.example.test',
              from_email: 'sender@example.test',
              password: 'fixture-password',
            }
          : {
              api_key: 'fixture-api-key',
              sender: '9830000000',
              timeout: 15,
              throughput_limit: 100,
              low_credit_threshold: 0,
              template_mappings: [
                { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
              ],
            };
      const secrets = new ProviderSecretsService('provider-mutation-fixture-key');
      await http.pool.query(
        `INSERT INTO ${table}(id,transport,label,status,config,created_by) VALUES ($1,$2,'Delayed test','draft',$3,'provider-writer')`,
        [
          id,
          channel === 'email' ? 'smtp' : 'smsir',
          secrets.encryptConfig(channel === 'email' ? 'smtp' : 'smsir', config),
        ]
      );
      if (channel === 'email')
        await http.pool.query(
          `UPDATE ${table} SET consecutive_failures=2,window_failures=2 WHERE id=$1`,
          [id]
        );
      const before = await snapshot(table);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const smtp = new SmtpConnectionTesterService(),
        sms = new SmsirConnectionTesterService();
      const send = vi.fn(async () => {
        await held;
        return { ok: true };
      });
      vi.spyOn(smtp, 'test').mockImplementation(send);
      vi.spyOn(sms, 'test').mockImplementation(send);
      const service =
        channel === 'email'
          ? new EmailProviderConfigService(
              http.pool,
              smtp,
              undefined,
              secrets,
              new EmailCircuitBreakerService(http.pool)
            )
          : new SmsProviderConfigService(http.pool, sms, secrets);
      if (concurrent === 'audit-failure')
        await http.pool.query(
          "CREATE OR REPLACE FUNCTION reject_provider_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_provider_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_provider_audit()"
        );
      const testing =
        service instanceof EmailProviderConfigService
          ? service.testConnection(id, undefined, 'provider-writer', actor)
          : service.testConnection(id, undefined, undefined, 'provider-writer', actor);
      const observed = testing.then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error })
      );
      let writing: Promise<unknown> | undefined;
      try {
        await expect.poll(() => send.mock.calls.length, { timeout: 3000 }).toBe(1);
        if (concurrent === 'edit')
          writing = service.update(
            id,
            {
              config:
                channel === 'email' ? { host: 'changed.example.test' } : { sender: '9830000001' },
            },
            'provider-writer',
            actor
          );
        if (concurrent === 'revoke')
          writing = http.pool.query(
            "UPDATE staff_roles SET permissions='[]' WHERE role_id='provider-writer'"
          );
        if (writing) await waitForLock();
        expect((await snapshot(table)).providers[0].last_test_status).toBe('pending');
        release();
        const finished = await observed;
        await writing;
        if (concurrent === 'audit-failure') {
          expect(finished.error).toBeDefined();
          expect(await snapshot(table)).toEqual(before);
        } else {
          expect(finished.error).toBeUndefined();
          expect(finished.value).toMatchObject({ ok: true, result: { lastTestStatus: 'passed' } });
          const state = await snapshot(table);
          expect(state.providers[0].last_test_status).toBe(
            concurrent === 'edit' ? 'pending' : 'passed'
          );
          expect(
            state.audits.filter((row) => row.event === `${channel}_provider_tested`)
          ).toHaveLength(1);
          const testAudit = state.audits.find((row) => row.event === `${channel}_provider_tested`);
          expect(JSON.parse(testAudit.metadata)).toMatchObject({
            providerId: id,
            lastTestStatus: 'passed',
          });
          if (channel === 'email') expect(state.providers[0].consecutive_failures).toBe(0);
          if (concurrent === 'revoke')
            await expect(
              service.update(id, { label: 'Denied' }, 'provider-writer', actor)
            ).rejects.toMatchObject({ status: 403 });
        }
      } finally {
        release();
        await observed;
        await writing;
        if (concurrent === 'audit-failure')
          await http.pool.query('DROP TRIGGER reject_provider_audit ON audit_log');
      }
    });
  }
}
