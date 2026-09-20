import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { EmailProviderConfigService } from './email-provider-config.service.js';
import { SmsProviderConfigService } from './sms-provider-config.service.js';
import { SmtpConnectionTesterService } from './smtp-connection-tester.service.js';
import { ResendConnectionTesterService } from './resend-connection-tester.service.js';
import { SmsirConnectionTesterService } from './smsir-connection-tester.service.js';
import { ProviderSecretsService } from './provider-secrets.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const actor = { userId: 'provider-self', sessionId: randomUUID(), csrfToken: randomUUID() };
const email = 'staff@example.test',
  mobile = '+989121234567';
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('provider-self','Provider self','Fixture','[\"admin:notification-providers:edit\"]')"
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,email,mobile,password_hash,is_staff) VALUES ($1,$2,$2,$3,'test-only',true)",
    [actor.userId, email, mobile]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'provider-self')", [
    actor.userId,
  ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [actor.sessionId, actor.userId, actor.csrfToken, randomUUID()]
  );
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  vi.restoreAllMocks();
  await http.pool.query(
    "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '1 hour',step_up_verified_at=NOW() WHERE session_id=$1",
    [actor.sessionId]
  );
  await http.pool.query('DELETE FROM email_provider_configs');
  await http.pool.query('DELETE FROM sms_provider_configs');
  await http.pool.query('DELETE FROM audit_log WHERE user_id=$1', [actor.userId]);
  await http.pool.query('DELETE FROM notification_templates');
  for (const event of ['auth.otp', 'invoice.created'])
    await http.pool.query(
      `INSERT INTO notification_templates(id,event_key,channel,locale,body_template,variables,status,is_active,version,published_at)
       VALUES($1,$2,'sms','en','Code {{code}}','["code"]','active',true,1,NOW())`,
      [randomUUID(), event]
    );
  await http.pool.query('UPDATE users SET username=$2,email=$2,mobile=$3 WHERE user_id=$1', [
    actor.userId,
    email,
    mobile,
  ]);
  await http.pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ($2,$1,'mobile',NOW()) ON CONFLICT (destination) DO NOTHING",
    [actor.userId, mobile]
  );
});

for (const transport of ['smtp', 'resend', 'smsir'] as const) {
  const channel = transport === 'smsir' ? 'sms' : 'email';
  async function fixture() {
    const probe = vi.fn(async () => {}),
      dispatch = vi.fn();
    const send = vi.fn(
      async (
        _config: unknown,
        _recipient?: string,
        eventOrAuthorize?: string | (() => Promise<void>),
        beforeSend?: () => Promise<void>
      ) => {
        await probe();
        const authorize = typeof eventOrAuthorize === 'function' ? eventOrAuthorize : beforeSend;
        if (!authorize) throw new Error('Missing send authorization callback');
        await authorize();
        dispatch();
        return { ok: true };
      }
    );
    const smtp = new SmtpConnectionTesterService(),
      resend = new ResendConnectionTesterService(),
      sms = new SmsirConnectionTesterService();
    vi.spyOn(smtp, 'test').mockImplementation(send);
    vi.spyOn(resend, 'test').mockImplementation(send);
    vi.spyOn(sms, 'test').mockImplementation(send);
    const secrets = new ProviderSecretsService('provider-self-fixture-key');
    const service =
      transport === 'smsir'
        ? new SmsProviderConfigService(http.pool, sms, secrets)
        : new EmailProviderConfigService(http.pool, smtp, resend, secrets);
    const config =
      transport === 'smtp'
        ? { host: 'smtp.example.test', from_email: 'sender@example.test' }
        : transport === 'resend'
          ? { api_key: 'fixture-key', from_email: 'sender@example.test' }
          : {
              api_key: 'fixture-key',
              sender: '9830000000',
              timeout: 15,
              throughput_limit: 100,
              low_credit_threshold: 0,
              template_mappings: [
                { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
              ],
            };
    const row =
      service instanceof EmailProviderConfigService
        ? await service.create(
            {
              transport: transport as 'smtp' | 'resend',
              label: 'Self test',
              config,
              createdBy: actor.userId,
            },
            actor
          )
        : await service.create({ label: 'Self test', config, createdBy: actor.userId }, actor);
    const test = (recipient?: string) =>
      service instanceof EmailProviderConfigService
        ? service.testConnection(row.id, recipient, actor.userId, actor)
        : service.testConnection(row.id, recipient, undefined, actor.userId, actor);
    const snapshot = async () => ({
      provider: (
        await http.pool.query(`SELECT * FROM ${channel}_provider_configs WHERE id=$1`, [row.id])
      ).rows,
      audit: (
        await http.pool.query('SELECT * FROM audit_log WHERE user_id=$1 ORDER BY id', [
          actor.userId,
        ])
      ).rows,
    });
    return { test, send, snapshot, probe, dispatch, service, row, config };
  }
  it(`${transport}: legacy passed results cannot activate; a current self-test supplies proof`, async () => {
    const { service, row, test } = await fixture();
    await http.pool.query(
      `UPDATE ${channel}_provider_configs SET last_test_status='passed',last_test_at=NOW() WHERE id=$1`,
      [row.id]
    );
    expect((await service.get(row.id)).lastTestStatus).toBe('pending');
    await expect(service.activate(row.id, actor.userId, actor)).rejects.toMatchObject({
      status: 409,
    });
    expect((await test()).ok).toBe(true);
    const proof = (
      await http.pool.query(
        `SELECT delivery_verified_at=last_test_at AS same_time,
      delivery_config_hash=encode(sha256(convert_to(jsonb_build_array(transport,config)::text,'UTF8')),'hex') AS same_config
      FROM ${channel}_provider_configs WHERE id=$1`,
        [row.id]
      )
    ).rows[0];
    expect(proof).toEqual({ same_time: true, same_config: true });
    expect((await service.activate(row.id, actor.userId, actor)).status).toBe('active');
  });
  it(`${transport}: an old writer changing the test time invalidates proof at database precision`, async () => {
    const { service, row, test } = await fixture();
    await test();
    await http.pool.query(
      `UPDATE ${channel}_provider_configs SET last_test_at=last_test_at+INTERVAL '1 microsecond' WHERE id=$1`,
      [row.id]
    );
    expect((await service.get(row.id)).lastTestStatus).toBe('pending');
    await expect(service.activate(row.id, actor.userId, actor)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      http.pool.query(`UPDATE ${channel}_provider_configs SET status='active' WHERE id=$1`, [
        row.id,
      ])
    ).rejects.toMatchObject({ code: '23514', constraint: 'provider_delivery_proof_required' });
  });
  it(`${transport}: old-writer configuration changes cannot reuse successful delivery`, async () => {
    const { service, row, test } = await fixture();
    await test();
    await http.pool.query(
      `UPDATE ${channel}_provider_configs SET config=config || '{"changed":true}'::jsonb WHERE id=$1`,
      [row.id]
    );
    expect((await service.get(row.id)).lastTestStatus).toBe('pending');
    await expect(service.activate(row.id, actor.userId, actor)).rejects.toMatchObject({
      status: 409,
    });
  });
  it(`${transport}: a failed retest clears earlier activation proof`, async () => {
    const { service, row, test, send } = await fixture();
    await test();
    send.mockResolvedValue({ ok: false });
    expect((await test()).ok).toBe(false);
    const proof = (
      await http.pool.query(
        `SELECT delivery_verified_at,delivery_config_hash FROM ${channel}_provider_configs WHERE id=$1`,
        [row.id]
      )
    ).rows[0];
    expect(proof).toEqual({ delivery_verified_at: null, delivery_config_hash: null });
    await expect(service.activate(row.id, actor.userId, actor)).rejects.toMatchObject({
      status: 409,
    });
  });
  for (const outcome of ['passed', 'failed', 'audit-failed'] as const) {
    it(`${transport}: rollback ${outcome} retests legacy settings and preserves atomic recovery`, async () => {
      const { service, row, test, send } = await fixture();
      await test();
      await service.activate(row.id, actor.userId, actor);
      await http.pool.query(
        `UPDATE ${channel}_provider_configs SET status='superseded',delivery_verified_at=NULL,delivery_config_hash=NULL WHERE id=$1`,
        [row.id]
      );
      const replacement = await fixture();
      await replacement.test();
      await replacement.service.activate(replacement.row.id, actor.userId, actor);
      const state = async () => ({
        providers: (await http.pool.query(`SELECT * FROM ${channel}_provider_configs ORDER BY id`))
          .rows,
        audit: (
          await http.pool.query('SELECT * FROM audit_log WHERE user_id=$1 ORDER BY id', [
            actor.userId,
          ])
        ).rows,
      });
      const before = await state();
      send.mockClear();
      if (outcome === 'failed') send.mockResolvedValue({ ok: false });
      if (outcome === 'audit-failed')
        await http.pool
          .query(`CREATE FUNCTION reject_proof_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$;
        CREATE TRIGGER reject_proof_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_proof_audit()`);
      try {
        if (outcome === 'passed') {
          const restored = await service.rollback(row.id, actor.userId, actor);
          expect(restored).toMatchObject({
            status: 'active',
            lastTestStatus: 'passed',
            supersedesId: replacement.row.id,
          });
          expect(restored.id).not.toBe(row.id);
          expect((await service.get(replacement.row.id)).status).toBe('superseded');
          const after = await state();
          expect(after.audit).toHaveLength(before.audit.length + 1);
          expect(after.providers).toHaveLength(before.providers.length + 1);
          expect(after.providers.find((p) => p.id === row.id)).toEqual(
            before.providers.find((p) => p.id === row.id)
          );
        } else {
          await expect(service.rollback(row.id, actor.userId, actor)).rejects.toBeDefined();
          expect(await state()).toEqual(before);
        }
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0]?.[1]).toBe(channel === 'email' ? email : mobile);
      } finally {
        if (outcome === 'audit-failed')
          await http.pool.query(
            'DROP TRIGGER reject_proof_audit ON audit_log; DROP FUNCTION reject_proof_audit()'
          );
      }
    });
  }
  if (transport === 'smsir') {
    for (const failEnglish of [false, true]) {
      it(`tests both locale mappings for one event before activation; English failure=${failEnglish}`, async () => {
        const { service, row, config, send } = await fixture();
        if (!(service instanceof SmsProviderConfigService)) throw new Error('Wrong fixture');
        await http.pool
          .query(`INSERT INTO notification_templates(event_key,channel,locale,body_template,variables,status,is_active,version)
          VALUES ('auth.otp','sms','fa','Code {{code}}','["code"]','active',true,1)`);
        const mappings = [
          { event_key: 'auth.otp', locale: 'fa', template_id: '42', variables: { code: 'CODE' } },
          { event_key: 'auth.otp', locale: 'en', template_id: '43', variables: { code: 'CODE' } },
        ];
        await service.update(
          row.id,
          { config: { ...config, template_mappings: mappings } },
          actor.userId,
          actor
        );
        send.mockImplementation(async (value, _recipient, _event, authorize) => {
          await authorize?.();
          const mapping = (value as { template_mappings: typeof mappings }).template_mappings;
          expect(mapping).toHaveLength(1);
          return { ok: !(failEnglish && mapping[0]?.locale === 'en') };
        });
        const result = await service.testConnection(
          row.id,
          undefined,
          'auth.otp',
          actor.userId,
          actor
        );
        expect(result.ok).toBe(!failEnglish);
        expect(
          send.mock.calls.map(
            (call) => (call[0] as { template_mappings: typeof mappings }).template_mappings[0]
          )
        ).toEqual(mappings);
        if (failEnglish)
          await expect(service.activate(row.id, actor.userId, actor)).rejects.toMatchObject({
            status: 409,
          });
        else expect((await service.activate(row.id, actor.userId, actor)).status).toBe('active');
      });
    }
    it('requires an active local template for a language-specific SMS mapping', async () => {
      const { service, row, config, send } = await fixture();
      if (!(service instanceof SmsProviderConfigService)) throw new Error('Wrong fixture');
      await service.update(
        row.id,
        {
          config: {
            ...config,
            template_mappings: [
              {
                event_key: 'auth.otp',
                locale: 'fa',
                template_id: '42',
                variables: { code: 'CODE' },
              },
            ],
          },
        },
        actor.userId,
        actor
      );
      await expect(
        service.testConnection(row.id, undefined, undefined, actor.userId, actor)
      ).rejects.toMatchObject({ status: 409 });
      expect(send).not.toHaveBeenCalled();
    });
    for (const failSecond of [false, true]) {
      it(`SMS tests every mapping even with an explicit event; second failure=${failSecond}`, async () => {
        const { service, row, config, send } = await fixture();
        if (!(service instanceof SmsProviderConfigService)) throw new Error('Wrong fixture');
        await service.update(
          row.id,
          {
            config: {
              ...config,
              template_mappings: [
                { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
                { event_key: 'invoice.created', template_id: '43', variables: { code: 'CODE' } },
              ],
            },
          },
          actor.userId,
          actor
        );
        if (failSecond)
          send.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
        const result = await service.testConnection(
          row.id,
          undefined,
          'invoice.created',
          actor.userId,
          actor
        );
        expect(send.mock.calls.map((call) => call[2])).toEqual(['invoice.created', 'auth.otp']);
        expect(result.ok).toBe(!failSecond);
        if (failSecond)
          await expect(service.activate(row.id, actor.userId, actor)).rejects.toMatchObject({
            status: 409,
          });
        else expect((await service.activate(row.id, actor.userId, actor)).status).toBe('active');
      });
    }
    it('SMS activation rechecks variable availability after a successful delivery', async () => {
      const { service, row, test } = await fixture();
      await test();
      await http.pool.query(
        "UPDATE notification_templates SET variables='[]' WHERE event_key='auth.otp'"
      );
      await expect(service.activate(row.id, actor.userId, actor)).rejects.toMatchObject({
        status: 409,
      });
      expect((await service.get(row.id)).status).toBe('draft');
    });
    for (const mappings of [
      [],
      [{ event_key: 'auth.otp', template_id: '42' }],
      [{ event_key: 'auth.otp', template_id: '42', variables: { missing: 'CODE' } }],
      [{ event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE', other: 'CODE' } }],
      [
        { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
        { event_key: 'auth.otp', template_id: '43', variables: { code: 'CODE' } },
      ],
    ]) {
      it(`SMS rejects unusable mappings before sending: ${JSON.stringify(mappings)}`, async () => {
        const { service, row, config, test, send } = await fixture();
        await service.update(
          row.id,
          { config: { ...config, template_mappings: mappings } },
          actor.userId,
          actor
        );
        await expect(test()).rejects.toMatchObject({ status: 409 });
        expect(send).not.toHaveBeenCalled();
      });
    }
  }
  it(`${transport}: rechecks session expiry after a delayed provider probe`, async () => {
    const { test, probe, dispatch, snapshot } = await fixture(),
      before = await snapshot();
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '300 milliseconds' WHERE session_id=$1",
      [actor.sessionId]
    );
    probe.mockImplementation(async () => {
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT clock_timestamp()>=expires_at AS expired FROM sessions WHERE session_id=$1',
                [actor.sessionId]
              )
            ).rows[0].expired,
          { timeout: 3000 }
        )
        .toBe(true);
    });
    await expect(test()).rejects.toMatchObject({ status: 401 });
    expect(probe).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it(`${transport}: rejects a foreign test recipient before dispatch`, async () => {
    const { test, send, snapshot } = await fixture(),
      before = await snapshot();
    await expect(
      test(channel === 'email' ? 'stranger@example.test' : '+989120000000')
    ).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it(`${transport}: defaults to the current verified contact`, async () => {
    const { test, send } = await fixture();
    expect(await test()).toMatchObject({ ok: true, result: { lastTestStatus: 'passed' } });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![1]).toBe(channel === 'email' ? email : mobile);
  });
  it(`${transport}: accepts normalized own contact`, async () => {
    const { test, send } = await fixture();
    expect(await test(channel === 'email' ? email.toUpperCase() : mobile.slice(1))).toMatchObject({
      ok: true,
    });
    expect(send.mock.calls[0]![1]).toBe(channel === 'email' ? email : mobile);
  });
  it(`${transport}: requires current secondary-contact proof, even when the account field matches`, async () => {
    const { test, send, snapshot } = await fixture();
    const destination = channel === 'email' ? 'secondary@example.test' : '+989122222222';
    const kind = channel === 'email' ? 'email' : 'mobile';
    await http.pool.query(`UPDATE users SET ${kind}=$2 WHERE user_id=$1`, [
      actor.userId,
      destination,
    ]);
    const before = await snapshot();
    await expect(test(destination)).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    await http.pool.query(
      'INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ($2,$1,$3,NOW())',
      [actor.userId, destination, kind]
    );
    expect((await test(destination)).ok).toBe(true);
    expect(send.mock.calls[0]![1]).toBe(destination);
    send.mockClear();
    await http.pool.query('DELETE FROM account_login_identifiers WHERE user_id=$1 AND kind=$2', [
      actor.userId,
      kind,
    ]);
    const after = await snapshot();
    await expect(test(destination)).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(after);
  });
  it(`${transport}: defaults past unverified secondary fields without sending to them`, async () => {
    const { test, send } = await fixture();
    await http.pool.query('UPDATE users SET email=$2,mobile=$3 WHERE user_id=$1', [
      actor.userId,
      'unverified@example.test',
      '+989123333333',
    ]);
    if (channel === 'email') {
      expect((await test()).ok).toBe(true);
      expect(send.mock.calls[0]![1]).toBe(email);
    } else {
      await expect(test()).rejects.toMatchObject({ status: 400 });
      expect(send).not.toHaveBeenCalled();
    }
  });
  it(`${transport}: rejects a contact removed since the page was opened`, async () => {
    const { test, send, snapshot } = await fixture(),
      before = await snapshot();
    await http.pool.query('UPDATE users SET username=$2,email=$2,mobile=$3 WHERE user_id=$1', [
      actor.userId,
      'changed@example.test',
      '+989129999999',
    ]);
    await expect(test(channel === 'email' ? email : mobile)).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it(`${transport}: cannot pass a self-test without a verified contact`, async () => {
    const { test, send, snapshot } = await fixture(),
      before = await snapshot();
    await http.pool.query('UPDATE users SET username=$2,email=NULL,mobile=NULL WHERE user_id=$1', [
      actor.userId,
      channel === 'email' ? mobile : email,
    ]);
    await expect(test()).rejects.toMatchObject({ status: 400 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
}
