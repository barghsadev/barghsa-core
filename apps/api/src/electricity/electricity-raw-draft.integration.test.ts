import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { expectCoreAudit } from '../test/core-audit.js';
import { runWalletRefund } from '@barghsa/db/refund-processing';
import { createElectricityRefundObligation } from './electricity-refund-obligation.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
let profile: string, otherProfile: string, product: string, gift: string;
beforeAll(async () => {
  http = await startHttpFixture(
    process.env.TEST_DATABASE_URL!,
    undefined,
    '127.0.0.1,::1,::ffff:127.0.0.1'
  );
  for (const [id, staff] of [
    ['raw-buyer', false],
    ['raw-other', false],
    ['raw-reviewer', true],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',$2)",
      [id, staff]
    );
    if (staff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'role-legal-contracts')",
        [id]
      );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second',$5)",
      [session, id, csrf, randomUUID(), staff ? 'staff' : 'customer']
    );
    headers[id] = {
      Cookie: 'barghsa_session=' + session,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('raw-buyer','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  otherProfile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('raw-other','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  product = (
    await http.pool.query(
      `INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','thermal','{"en":"Thermal"}','active',100000) ON CONFLICT(system_key) DO UPDATE SET status='active',price=100000 RETURNING id`
    )
  ).rows[0].id;
  gift = (
    await http.pool.query(
      "INSERT INTO gift_codes(code,discount_type,discount_value,created_by) VALUES('RAW-PROBE','fixed_irr',1,'raw-reviewer') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    "INSERT INTO electricity_customer_drafts(user_id,profile_id,mode,current_step,data) VALUES('raw-buyer',$1,'simple',3,'{\"PRIVATE\":\"buyer progress\"}'),('raw-other',$2,'advanced',4,'{\"PRIVATE\":\"other progress\"}')",
    [profile, otherProfile]
  );
}, 40000);
let testIp = 0;
beforeEach(async () => {
  for (const h of Object.values(headers)) h['X-Forwarded-For'] = '192.0.2.' + ++testIp;
  await http.pool.query("DELETE FROM app_config WHERE key='finance.dual_approval_threshold'");
});
afterAll(async () => {
  await http?.close();
});
async function actualDraft(restore: boolean | null = null) {
  await http.pool.query(
    `INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','green','{}','active',100000) ON CONFLICT(system_key) DO UPDATE SET status='active',price=100000`
  );
  const provinceId = (
    await http.pool.query('INSERT INTO provinces(name_fa,name_en) VALUES($1,$1) RETURNING id', [
      randomUUID(),
    ])
  ).rows[0].id;
  const cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id;
  const code = 'ORPHAN-' + randomUUID();
  let giftId: string | null = null;
  if (restore !== null)
    giftId = (
      await http.pool.query(
        "INSERT INTO gift_codes(code,discount_type,discount_value,restore_on_cancel,restore_after_payment,created_by,valid_from) VALUES($1,'fixed_irr',100,$2,false,'raw-reviewer',clock_timestamp()-INTERVAL '1 minute') RETURNING id",
        [code, restore]
      )
    ).rows[0].id;
  const response = await fetch(http.base + '/api/orders', {
    method: 'POST',
    headers: headers['raw-buyer']!,
    body: JSON.stringify({
      profileId: profile,
      productId: product,
      orderType: 'electricity',
      address: {
        provinceId,
        cityId,
        fullAddress: 'PRIVATE generic draft address',
        postalCode: '1234567890',
      },
      ...(giftId ? { giftCode: code } : {}),
    }),
  });
  expect(response.status, http.logs()).toBe(201);
  const id = ((await response.json()) as { id: string }).id;
  expect((await snapshot(id)).root.status).toBe('DRAFT');
  return { id, giftId };
}
async function seed(targetProfile = profile) {
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,status,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','PENDING','province','city','PRIVATE unsubmitted address','1234567890')",
    [id, targetProfile === profile ? 'raw-buyer' : 'raw-other', targetProfile, product]
  );
  await http.pool.query(
    'INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot) VALUES($1,$2,\'draft\',\'{"PRIVATE":"incomplete legacy settings"}\')',
    [id, targetProfile]
  );
  return id;
}
function send(id: string, suffix: string, body?: unknown, user = 'raw-reviewer') {
  return fetch(http.base + '/api/staff/electricity/orders/' + id + suffix, {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function review(id: string, action: 'reject' | 'cancel' = 'reject') {
  const r = await send(id, '/draft-terminal/review', {
    action,
    reason: 'Discard incomplete legacy record',
  });
  expect(r.status, http.logs()).toBe(200);
  const result = (await r.json()) as { hash: string; data: Record<string, unknown> };
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  return {
    action,
    reason: 'Discard incomplete legacy record',
    expectedReviewHash: result.hash,
    idempotencyKey: randomUUID(),
  };
}
async function snapshot(id: string) {
  return (
    await http.pool.query(
      `SELECT (SELECT to_jsonb(o) FROM orders o WHERE id=$1) AS root,(SELECT to_jsonb(e) FROM electricity_orders e WHERE id=$1) AS draft,(SELECT jsonb_agg(to_jsonb(d) ORDER BY user_id,profile_id,mode) FROM electricity_customer_drafts d) AS wizard,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE metadata::jsonb->>'entityId'=$1::text) AS audits,(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM invoices i WHERE order_id=$1) AS invoices,(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM contracts c WHERE order_id=$1) AS contracts,(SELECT jsonb_agg(to_jsonb(k) ORDER BY idempotency_key) FROM idempotency_keys k WHERE entity_type='electricity_raw_draft_terminal' AND k.response->'request'->>'orderId'=$1::text) AS keys`,
      [id]
    )
  ).rows[0];
}
it.each(['reject', 'cancel'] as const)(
  'terminates an incomplete raw draft with %s once without creating or exposing submitted/financial/wizard records',
  async (action) => {
    const id = await seed(),
      command = await review(id, action),
      before = await snapshot(id);
    const responses = await Promise.all([
      send(id, '/draft-terminal', command),
      send(id, '/draft-terminal', command),
    ]);
    expect(
      responses.map((r) => r.status),
      http.logs()
    ).toEqual([200, 200]);
    const receipts = await Promise.all(responses.map((r) => r.json()));
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]).toEqual({
      orderId: id,
      status: action === 'reject' ? 'rejected' : 'cancelled',
      refundId: null,
    });
    const after = await snapshot(id);
    expect(after.wizard).toEqual(before.wizard);
    expect(after.invoices).toBeNull();
    expect(after.contracts).toBeNull();
    expect(after.draft).toMatchObject({
      status: action === 'reject' ? 'rejected' : 'cancelled',
      period_start: null,
      period_end: null,
      submitted_at: null,
      pricing_snapshot: null,
      total_kwh: null,
    });
    const { status: _s, updated_at: _u, ...raw } = after.draft;
    const { status: _bs, updated_at: _bu, ...prior } = before.draft;
    expect(raw).toEqual(prior);
    expect(after.keys).toHaveLength(1);
    await expectCoreAudit(http.pool, 'electricity.draft.terminated', id, {
      entity: 'electricity_order',
      fromState: 'draft',
      toState: action === 'reject' ? 'rejected' : 'cancelled',
      reason: command.reason,
      actor: 'raw-reviewer',
      context: 'staff',
    });
    expect(
      (await send(id, '/draft-terminal', { ...command, reason: 'Changed retry' })).status
    ).toBe(409);
    expect(await snapshot(id)).toEqual(after);
    await expect(
      http.pool.query('UPDATE electricity_orders SET profile_id=$2 WHERE id=$1', [id, otherProfile])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      http.pool.query("UPDATE orders SET status='PENDING' WHERE id=$1", [id])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(http.pool.query('DELETE FROM orders WHERE id=$1', [id])).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      http.pool.query(
        "INSERT INTO invoices(profile_id,order_id,type,state,total_amount) VALUES($1,$2,'manual','Draft',0)",
        [profile, id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      http.pool.query(
        "INSERT INTO contracts(profile_id,order_id,service_type,state) VALUES($1,$2,'electricity','Draft')",
        [profile, id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      http.pool.query(
        'INSERT INTO gift_code_redemptions(gift_code_id,profile_id,order_id,discount_amount) VALUES($1,$2,$3,1)',
        [gift, profile, id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot(id)).toEqual(after);
  }
);
it('lists only safe unlinked draft metadata and never another customer wizard progress', async () => {
  const first = await seed(),
    second = await seed(otherProfile),
    r = await send('drafts', '');
  expect(r.status, http.logs()).toBe(200);
  const text = await r.text();
  expect(text).not.toContain('PRIVATE');
  const data = JSON.parse(text);
  expect(data.drafts.map((v: { orderId: string }) => v.orderId)).toEqual([first, second]);
  expect(data.drafts[0]).toHaveProperty('profileId', profile);
  expect((await send('drafts', '', undefined, 'raw-other')).status).toBe(403);
  expect(
    (
      await send(
        second,
        '/draft-terminal/review',
        { action: 'reject', reason: 'Unowned progress' },
        'raw-buyer'
      )
    ).status
  ).toBe(403);
  const privateRow = (
    await http.pool.query("SELECT * FROM electricity_customer_drafts WHERE user_id='raw-other'")
  ).rows;
  expect(privateRow).toHaveLength(1);
  expect(privateRow[0].data.PRIVATE).toBe('other progress');
});
it.each(['settings', 'root', 'association'] as const)(
  'invalidates exact raw confirmation when %s changes',
  async (kind) => {
    const id = await seed(),
      command = await review(id);
    if (kind === 'settings')
      await http.pool.query(
        'UPDATE electricity_orders SET settings_snapshot=\'{"PRIVATE":"changed"}\' WHERE id=$1',
        [id]
      );
    else if (kind === 'root')
      await http.pool.query(
        "UPDATE orders SET snapshot_full_address='Changed PRIVATE address' WHERE id=$1",
        [id]
      );
    else
      await http.pool.query(
        "INSERT INTO invoices(profile_id,order_id,type,state,total_amount) VALUES($1,$2,'manual','Draft',0)",
        [profile, id]
      );
    const before = await snapshot(id);
    expect((await send(id, '/draft-terminal', command)).status, http.logs()).toBe(409);
    expect(await snapshot(id)).toEqual(before);
  }
);
it.each(['customer_context', 'revoked_grant', 'expired_step_up', 'csrf'] as const)(
  'requires live %s before termination and keeps the record unchanged',
  async (kind) => {
    const id = await seed(),
      command = await review(id),
      before = await snapshot(id);
    const oldHeaders = headers['raw-reviewer']!;
    if (kind === 'customer_context')
      await http.pool.query(
        "UPDATE sessions SET operating_context='customer' WHERE user_id='raw-reviewer'"
      );
    if (kind === 'revoked_grant')
      await http.pool.query("DELETE FROM user_roles WHERE user_id='raw-reviewer'");
    if (kind === 'expired_step_up')
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='raw-reviewer'"
      );
    if (kind === 'csrf') headers['raw-reviewer'] = { ...oldHeaders, 'X-CSRF-Token': randomUUID() };
    try {
      expect((await send(id, '/draft-terminal', command)).status, http.logs()).toBe(403);
      expect(await snapshot(id)).toEqual(before);
    } finally {
      headers['raw-reviewer'] = oldHeaders;
      await http.pool.query(
        "UPDATE sessions SET operating_context='staff',step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id='raw-reviewer'"
      );
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES('raw-reviewer','role-legal-contracts') ON CONFLICT DO NOTHING"
      );
    }
  }
);
it('rolls back both rows and command/audit evidence when mandatory audit persistence fails then retries once', async () => {
  const id = await seed(),
    command = await review(id),
    before = await snapshot(id);
  await http.pool.query(
    `CREATE FUNCTION reject_raw_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='electricity.draft.terminated' THEN RAISE EXCEPTION 'draft audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_raw_draft_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_raw_draft_audit()`
  );
  try {
    expect((await send(id, '/draft-terminal', command)).status, http.logs()).toBe(500);
    expect(await snapshot(id)).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_raw_draft_audit ON audit_log;DROP FUNCTION reject_raw_draft_audit()'
    );
  }
  expect((await send(id, '/draft-terminal', command)).status, http.logs()).toBe(200);
  expect((await snapshot(id)).audits).toHaveLength(1);
});
it('requires a reason and rejects protected/unknown fields before any writes', async () => {
  const id = await seed(),
    command = await review(id),
    before = await snapshot(id);
  for (const body of [
    { ...command, reason: ' ' },
    { ...command, action: 'approve' },
    { ...command, profileId: otherProfile },
    { ...command, expectedReviewHash: 'bad' },
  ]) {
    const r = await send(id, '/draft-terminal', body);
    expect(r.status).toBe(400);
    expect(await snapshot(id)).toEqual(before);
  }
});

it('refuses a legacy order-referenced payment without an invoice, and cannot attach it after closure', async () => {
  const id = await seed(),
    command = await review(id);
  const wallet = (
    await http.pool.query(
      'INSERT INTO wallets(profile_id) VALUES($1) ON CONFLICT(profile_id) DO UPDATE SET profile_id=EXCLUDED.profile_id RETURNING profile_id',
      [profile]
    )
  ).rows[0].profile_id;
  await http.pool.query(
    "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key,ref_id) VALUES($1,'payment',-100,'Pending',$2,$3)",
    [wallet, randomUUID(), id]
  );
  const before = await snapshot(id);
  expect((await send(id, '/draft-terminal', command)).status).toBe(409);
  expect(
    (await send(id, '/draft-terminal/review', { action: 'reject', reason: 'Legacy payment' }))
      .status
  ).toBe(409);
  const queue = await send('drafts', '');
  expect(queue.status).toBe(200);
  expect(
    ((await queue.json()) as { drafts: { orderId: string }[] }).drafts.map((r) => r.orderId)
  ).not.toContain(id);
  expect(await snapshot(id)).toEqual(before);
  const closed = await seed(),
    close = await review(closed);
  expect((await send(closed, '/draft-terminal', close)).status, http.logs()).toBe(200);
  await expect(
    http.pool.query(
      "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key,ref_id) VALUES($1,'payment',-100,'Pending',$2,$3)",
      [wallet, randomUUID(), closed]
    )
  ).rejects.toMatchObject({ code: '23514' });
});
it('binds retained quote lines to confirmation and prevents new lines after closure', async () => {
  const id = await seed(),
    command = await review(id);
  await http.pool.query(
    'INSERT INTO electricity_order_lines(order_id,product_id,quantity_kwh,unit_price,line_total) VALUES($1,$2,10,100,1000)',
    [id, product]
  );
  expect((await send(id, '/draft-terminal', command)).status).toBe(409);
  const refreshed = await review(id);
  expect((await send(id, '/draft-terminal', refreshed)).status, http.logs()).toBe(200);
  await expect(
    http.pool.query(
      'INSERT INTO electricity_order_lines(order_id,product_id,quantity_kwh,unit_price,line_total) VALUES($1,$2,10,100,1000)',
      [id, product]
    )
  ).rejects.toMatchObject({ code: '23514' });
});
it('serializes association creation with the profile-first terminal decision', async () => {
  const id = await seed(),
    client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profile]);
    await expect(
      http.pool.query(
        "INSERT INTO invoices(profile_id,order_id,type,state,total_amount) VALUES($1,$2,'manual','Draft',0)",
        [profile, id]
      )
    ).rejects.toMatchObject({ code: '55P03' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const command = await review(id);
  expect((await send(id, '/draft-terminal', command)).status, http.logs()).toBe(200);
});

for (const action of ['reject', 'cancel'] as const)
  for (const restore of [null, false, true])
    it(`terminates an actual generic DRAFT with ${action} and gift restore=${restore} under its captured unpaid policy`, async () => {
      const { id, giftId } = await actualDraft(restore),
        before = await snapshot(id);
      const queued = await send('drafts', '');
      expect(queued.status, http.logs()).toBe(200);
      expect(
        ((await queued.json()) as { drafts: { orderId: string }[] }).drafts.map((r) => r.orderId)
      ).toContain(id);
      const preview = await send(id, '/draft-terminal/review', {
        action,
        reason: 'Reviewed generic draft',
      });
      expect(preview.status, http.logs()).toBe(200);
      const data = (await preview.json()) as { hash: string; data: { gift: unknown } };
      expect(JSON.stringify(data)).not.toContain('PRIVATE');
      expect(data.data.gift).toEqual(
        giftId
          ? {
              giftCodeId: giftId,
              redemptionId: expect.any(String),
              status: 'consumed',
              restoreOnCancel: restore,
              outcome: restore ? 'release' : 'retain',
            }
          : null
      );
      const body = {
        action,
        reason: 'Reviewed generic draft',
        expectedReviewHash: data.hash,
        idempotencyKey: randomUUID(),
      };
      const responses = await Promise.all([
        send(id, '/draft-terminal', body),
        send(id, '/draft-terminal', body),
      ]);
      expect(
        responses.map((r) => r.status),
        http.logs()
      ).toEqual([200, 200]);
      expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
      const after = await snapshot(id);
      expect(after.wizard).toEqual(before.wizard);
      expect(after.contracts).toBeNull();
      expect(after.invoices).toBeNull();
      expect(after.draft).toMatchObject({
        status: action === 'reject' ? 'rejected' : 'cancelled',
        submitted_at: null,
        submitted_by: null,
        pricing_snapshot: null,
        period_start: null,
        period_end: null,
      });
      expect(after.root).toMatchObject({ status: 'CANCELLED', gift_code_id: giftId });
      const redemptions = (
        await http.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [id])
      ).rows;
      if (giftId) {
        expect(redemptions).toHaveLength(1);
        expect(redemptions[0]).toMatchObject({
          profile_id: profile,
          gift_code_id: giftId,
          status: restore ? 'released' : 'consumed',
        });
        expect(redemptions[0].restored_at !== null).toBe(restore);
        const released = (
          await http.pool.query(
            "SELECT metadata FROM audit_log WHERE metadata::jsonb->>'orderId'=$1 AND metadata::jsonb->>'action'='released'",
            [id]
          )
        ).rows;
        expect(released).toHaveLength(restore ? 1 : 0);
        await expect(
          http.pool.query('DELETE FROM gift_code_redemptions WHERE order_id=$1', [id])
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          http.pool.query('UPDATE gift_code_redemptions SET status=$2 WHERE order_id=$1', [
            id,
            restore ? 'consumed' : 'released',
          ])
        ).rejects.toMatchObject({ code: '23514' });
      } else expect(redemptions).toHaveLength(0);
      await expectCoreAudit(http.pool, 'electricity.draft.terminated', id, {
        entity: 'electricity_order',
        fromState: 'draft',
        toState: action === 'reject' ? 'rejected' : 'cancelled',
        reason: body.reason,
        actor: 'raw-reviewer',
        context: 'staff',
      });
    });
it('invalidates a captured orphan decision when gift policy changes, then honors the fresh policy', async () => {
  const { id, giftId } = await actualDraft(true),
    command = await review(id);
  await http.pool.query('UPDATE gift_codes SET restore_on_cancel=false WHERE id=$1', [giftId]);
  const before = await snapshot(id);
  expect((await send(id, '/draft-terminal', command)).status).toBe(409);
  expect(await snapshot(id)).toEqual(before);
  expect(
    (await http.pool.query('SELECT status FROM gift_code_redemptions WHERE order_id=$1', [id]))
      .rows[0].status
  ).toBe('consumed');
  const fresh = await review(id);
  expect((await send(id, '/draft-terminal', fresh)).status, http.logs()).toBe(200);
  expect(
    (await http.pool.query('SELECT status FROM gift_code_redemptions WHERE order_id=$1', [id]))
      .rows[0].status
  ).toBe('consumed');
});
it('rolls back orphan gift release and its audit when terminal audit fails, then retries once', async () => {
  const { id } = await actualDraft(true),
    command = await review(id),
    before = await snapshot(id);
  const giftsBefore = (
    await http.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [id])
  ).rows;
  await http.pool.query(
    `CREATE FUNCTION fail_orphan_gift_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='electricity.draft.terminated' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_orphan_gift_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_orphan_gift_audit()`
  );
  try {
    expect((await send(id, '/draft-terminal', command)).status).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_orphan_gift_audit ON audit_log; DROP FUNCTION fail_orphan_gift_audit()'
    );
  }
  expect(await snapshot(id)).toEqual(before);
  expect(
    (await http.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [id])).rows
  ).toEqual(giftsBefore);
  expect((await send(id, '/draft-terminal', command)).status, http.logs()).toBe(200);
  expect((await send(id, '/draft-terminal', command)).status).toBe(200);
});
it('retains an already released gift without releasing or auditing it again', async () => {
  const { id } = await actualDraft(true);
  await http.pool.query(
    "UPDATE gift_code_redemptions SET status='released',restored_at=clock_timestamp() WHERE order_id=$1",
    [id]
  );
  const giftsBefore = (
    await http.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [id])
  ).rows;
  const response = await send(id, '/draft-terminal/review', {
    action: 'reject',
    reason: 'Already restored gift',
  });
  expect(response.status, http.logs()).toBe(200);
  const preview = (await response.json()) as { hash: string; data: { gift: { outcome: string } } };
  expect(preview.data.gift.outcome).toBe('already_released');
  expect(
    (
      await send(id, '/draft-terminal', {
        action: 'reject',
        reason: 'Already restored gift',
        expectedReviewHash: preview.hash,
        idempotencyKey: randomUUID(),
      })
    ).status,
    http.logs()
  ).toBe(200);
  expect(
    (await http.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [id])).rows
  ).toEqual(giftsBefore);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE metadata::jsonb->>'orderId'=$1 AND metadata::jsonb->>'action'='released'",
        [id]
      )
    ).rows
  ).toHaveLength(0);
});
it('excludes a conflicting gift association and refuses its captured decision without mutation', async () => {
  const { id, giftId } = await actualDraft(true),
    command = await review(id);
  await http.pool.query('UPDATE orders SET gift_code_id=NULL WHERE id=$1', [id]);
  const before = await snapshot(id);
  const queue = await send('drafts', '');
  expect(queue.status, http.logs()).toBe(200);
  expect(
    ((await queue.json()) as { drafts: { orderId: string }[] }).drafts.map((r) => r.orderId)
  ).not.toContain(id);
  expect((await send(id, '/draft-terminal', command)).status).toBe(409);
  expect(await snapshot(id)).toEqual(before);
  await http.pool.query('UPDATE orders SET gift_code_id=$2 WHERE id=$1', [id, giftId]);
  expect((await send(id, '/draft-terminal', await review(id))).status, http.logs()).toBe(200);
});

async function orphanFunding(id: string) {
  const ids: string[] = [];
  for (const amount of [100000, 250000])
    ids.push(
      (
        await http.pool.query(
          "INSERT INTO invoices(profile_id,order_id,type,state,total_amount,paid_amount) VALUES($1,$2,$4,'Paid',$3,$3) RETURNING id",
          [profile, id, amount, ids.length ? 'manual' : 'auto']
        )
      ).rows[0].id
    );
  ids.push(
    (
      await http.pool.query(
        "INSERT INTO invoices(profile_id,order_id,type,state,total_amount,adjustment_for_invoice_id,adjustment_kind) VALUES($1,$2,'manual','Unpaid',5000,$3,'charge') RETURNING id",
        [profile, id, ids[0]]
      )
    ).rows[0].id
  );
  return ids;
}
async function orphanFinance() {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES('orphan-finance','orphan-finance','test',true) ON CONFLICT(user_id) DO NOTHING"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('orphan-finance','role-finance') ON CONFLICT DO NOTHING"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at,operating_context) VALUES($1,'orphan-finance',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW(),'staff')",
    [session, csrf, randomUUID()]
  );
  return {
    Cookie: 'barghsa_session=' + session,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}
for (const action of ['reject', 'cancel'] as const)
  for (const approvalRequired of [false, true])
    it(`ends funded orphan draft with ${action} and approval=${approvalRequired}, retaining invoices and fulfilling every wallet obligation once`, async () => {
      await http.pool.query(
        "INSERT INTO app_config(key,value) VALUES('finance.dual_approval_threshold',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify({ threshold_irr: approvalRequired ? 100 : 0 })]
      );
      const { id, giftId } = await actualDraft(true),
        ids = await orphanFunding(id),
        before = await snapshot(id);
      const response = await send(id, '/draft-terminal/review', {
        action,
        reason: 'Refund actual orphan invoices',
      });
      expect(response.status, http.logs()).toBe(200);
      const preview = (await response.json()) as {
        hash: string;
        data: {
          refundAmount: string;
          approvalRequired: boolean;
          gift: { outcome: string };
          invoices: unknown[];
        };
      };
      expect(preview.data).toMatchObject({
        refundAmount: '350000',
        approvalRequired,
        gift: { outcome: 'retain' },
      });
      expect(preview.data.invoices).toHaveLength(3);
      let body = {
        action,
        reason: 'Refund actual orphan invoices',
        expectedReviewHash: preview.hash,
        idempotencyKey: randomUUID(),
      } as {
        action: 'reject' | 'cancel';
        reason: string;
        expectedReviewHash: string;
        idempotencyKey: string;
        approvalRequestId?: string;
      };
      if (approvalRequired) {
        expect((await send(id, '/draft-terminal', body)).status).toBe(409);
        expect(await snapshot(id)).toEqual(before);
        const staged = await send(id, '/draft-terminal/approval', body);
        expect(staged.status, http.logs()).toBe(201);
        const prepared = (await staged.json()) as { approvalRequestId: string };
        const finance = await orphanFinance();
        const decision = await fetch(
          http.base + '/api/admin/approval-requests/' + prepared.approvalRequestId + '/approve',
          { method: 'POST', headers: finance, body: '{}' }
        );
        expect(decision.status, http.logs()).toBe(200);
        body = { ...body, approvalRequestId: prepared.approvalRequestId };
      }
      const responses = await Promise.all([
        send(id, '/draft-terminal', body),
        send(id, '/draft-terminal', body),
      ]);
      expect(
        responses.map((r) => r.status),
        http.logs()
      ).toEqual([200, 200]);
      const receipt = (await responses[0]!.json()) as {
        refunds: Array<{ id: string; invoiceId: string; amount: string }>;
        financiallyClosed: boolean;
      };
      expect(receipt).toEqual(await responses[1]!.json());
      expect(receipt.financiallyClosed).toBe(false);
      expect(receipt.refunds).toHaveLength(2);
      await expect(
        http.pool.query("UPDATE invoices SET state='Cancelled' WHERE id=$1", [ids[0]])
      ).rejects.toMatchObject({ code: '23514' });
      const after = await snapshot(id);
      expect(after.contracts).toBeNull();
      expect(after.wizard).toEqual(before.wizard);
      expect(after.draft).toMatchObject({
        status: action === 'reject' ? 'rejected' : 'cancelled',
        submitted_at: null,
        submitted_by: null,
        pricing_snapshot: null,
        period_start: null,
        period_end: null,
      });
      expect(
        (await http.pool.query('SELECT status FROM gift_code_redemptions WHERE order_id=$1', [id]))
          .rows[0].status
      ).toBe('consumed');
      expect(
        (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [ids[2]])).rows[0].state
      ).toBe('Cancelled');
      await http.pool.query("DELETE FROM user_roles WHERE user_id='raw-reviewer'");
      try {
        for (const refund of receipt.refunds) {
          expect(await runWalletRefund(http.pool, refund.id)).toBe('completed');
          expect(await runWalletRefund(http.pool, refund.id)).toBe('deferred');
        }
      } finally {
        await http.pool.query(
          "INSERT INTO user_roles(user_id,role_id) VALUES('raw-reviewer','role-legal-contracts') ON CONFLICT DO NOTHING"
        );
      }
      expect(
        (
          await http.pool.query(
            "SELECT SUM(amount)::text AS amount,COUNT(*)::int AS count FROM wallet_transactions WHERE ref_id=ANY($1::text[]) AND type='refund'",
            [receipt.refunds.map((r) => r.id)]
          )
        ).rows[0]
      ).toEqual({ amount: '350000', count: 2 });
      expect(
        (
          await http.pool.query('SELECT status FROM refund_obligations WHERE order_id=$1', [id])
        ).rows.map((r) => r.status)
      ).toEqual(['completed', 'completed']);
      await expect(
        http.pool.query('DELETE FROM electricity_draft_terminations WHERE order_id=$1', [id])
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        http.pool.query('UPDATE invoices SET total_amount=total_amount+1 WHERE id=$1', [ids[0]])
      ).rejects.toMatchObject({ code: '23514' });
      await expectCoreAudit(http.pool, 'electricity.draft.terminated', id, {
        entity: 'electricity_order',
        fromState: 'draft',
        toState: action === 'reject' ? 'rejected' : 'cancelled',
        reason: body.reason,
        actor: 'raw-reviewer',
        context: 'staff',
      });
      await http.pool.query("DELETE FROM app_config WHERE key='finance.dual_approval_threshold'");
      expect(giftId).not.toBeNull();
    });
it('requires a current finance reviewer and invalidates an approved orphan decision when another invoice appears', async () => {
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('finance.dual_approval_threshold','{\"threshold_irr\":100}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"
  );
  try {
    const { id } = await actualDraft(),
      ids = await orphanFunding(id),
      command = await review(id);
    const staged = await send(id, '/draft-terminal/approval', command);
    expect(staged.status, http.logs()).toBe(201);
    const approvalId = ((await staged.json()) as { approvalRequestId: string }).approvalRequestId,
      finance = await orphanFinance();
    expect(
      (
        await fetch(http.base + '/api/admin/approval-requests/' + approvalId + '/approve', {
          method: 'POST',
          headers: finance,
          body: '{}',
        })
      ).status,
      http.logs()
    ).toBe(200);
    const execution = { ...command, approvalRequestId: approvalId },
      before = await snapshot(id);
    await http.pool.query("DELETE FROM user_roles WHERE user_id='orphan-finance'");
    expect((await send(id, '/draft-terminal', execution)).status).toBe(409);
    expect(await snapshot(id)).toEqual(before);
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES('orphan-finance','role-finance')"
    );
    await http.pool.query(
      "INSERT INTO invoices(profile_id,order_id,type,state,total_amount,adjustment_for_invoice_id,adjustment_kind) VALUES($1,$2,'manual','Unpaid',1,$3,'charge')",
      [profile, id, ids[0]]
    );
    const changed = await snapshot(id);
    expect((await send(id, '/draft-terminal', execution)).status).toBe(409);
    expect(await snapshot(id)).toEqual(changed);
    expect(
      (
        await http.pool.query(
          'SELECT order_id FROM electricity_draft_terminations WHERE order_id=$1',
          [id]
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query("DELETE FROM app_config WHERE key='finance.dual_approval_threshold'");
  }
});
it('rolls back every orphan financial record when the mandatory refund audit fails, then retries the exact decision', async () => {
  const { id } = await actualDraft();
  await orphanFunding(id);
  const command = await review(id),
    before = await snapshot(id);
  await http.pool.query(
    `CREATE FUNCTION fail_orphan_financial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='refund.approved' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_orphan_financial_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_orphan_financial_audit()`
  );
  try {
    expect((await send(id, '/draft-terminal', command)).status).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_orphan_financial_audit ON audit_log; DROP FUNCTION fail_orphan_financial_audit()'
    );
  }
  expect(await snapshot(id)).toEqual(before);
  expect(
    (
      await http.pool.query(
        'SELECT order_id FROM electricity_draft_terminations WHERE order_id=$1',
        [id]
      )
    ).rows
  ).toHaveLength(0);
  expect(
    (
      await http.pool.query(
        'SELECT id FROM refunds WHERE invoice_id IN (SELECT id FROM invoices WHERE order_id=$1)',
        [id]
      )
    ).rows
  ).toHaveLength(0);
  expect(
    (await http.pool.query('SELECT id FROM refund_obligations WHERE order_id=$1', [id])).rows
  ).toHaveLength(0);
  const response = await send(id, '/draft-terminal', command);
  expect(response.status, http.logs()).toBe(200);
  const receipt = (await response.json()) as { refunds: Array<{ id: string }> };
  expect((await send(id, '/draft-terminal', command)).status).toBe(200);
  for (const refund of receipt.refunds) {
    await expectCoreAudit(http.pool, 'refund.requested', refund.id, {
      entity: 'refund',
      fromState: null,
      toState: 'Requested',
      reason: command.reason,
      actor: 'raw-reviewer',
      context: 'staff',
    });
    await expectCoreAudit(http.pool, 'refund.approved', refund.id, {
      entity: 'refund',
      fromState: 'Requested',
      toState: 'Approved',
      reason: command.reason,
      actor: 'raw-reviewer',
      context: 'staff',
    });
    expect(await runWalletRefund(http.pool, refund.id)).toBe('completed');
  }
});
it('can close a reconciled zero invoice while refusing its unresolved Draft state', async () => {
  const { id } = await actualDraft();
  const invoice = (
    await http.pool.query(
      "INSERT INTO invoices(profile_id,order_id,type,state,total_amount) VALUES($1,$2,'manual','Draft',0) RETURNING id",
      [profile, id]
    )
  ).rows[0].id;
  expect(
    (
      await send(id, '/draft-terminal/review', {
        action: 'reject',
        reason: 'Unresolved zero invoice',
      })
    ).status
  ).toBe(409);
  await http.pool.query(
    "UPDATE invoices SET state='Cancelled',cancelled_at=clock_timestamp() WHERE id=$1",
    [invoice]
  );
  const response = await send(id, '/draft-terminal', await review(id));
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({
    refundId: null,
    refunds: [],
    financiallyClosed: true,
  });
  expect(
    (
      await http.pool.query(
        'SELECT total_amount,paid_amount,refunded_amount FROM invoices WHERE id=$1',
        [invoice]
      )
    ).rows[0]
  ).toEqual({ total_amount: '0', paid_amount: '0', refunded_amount: '0' });
});
it('preserves a completed legacy orphan obligation and returns only the remaining invoice balance', async () => {
  const { id } = await actualDraft(),
    ids = await orphanFunding(id);
  await orphanFinance();
  const refundId = randomUUID(),
    invoiceId = ids[0]!;
  await http.pool.query(
    "INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,100000,'wallet',$4)",
    [refundId, invoiceId, profile, 'legacy:' + id]
  );
  await http.pool.query(
    "INSERT INTO refund_obligations(order_id,invoice_id,profile_id,refund_id,total_paid_amount,idempotency_key,authorized_by,reason) VALUES($1,$2,$3,$4,100000,$5,'orphan-finance','Retained authorized legacy refund')",
    [id, invoiceId, profile, refundId, 'electricity-end:' + id]
  );
  await http.pool.query("UPDATE refunds SET state='Approved' WHERE id=$1", [refundId]);
  await http.pool.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refundId]);
  await http.pool.query(
    "INSERT INTO refund_retry_jobs(refund_id,executor_user_id) VALUES($1,'orphan-finance')",
    [refundId]
  );
  const pendingReview = await send(id, '/draft-terminal/review', {
    action: 'reject',
    reason: 'Outstanding legacy return',
  });
  expect(pendingReview.status, http.logs()).toBe(200);
  expect(await pendingReview.json()).toMatchObject({
    data: {
      existingReturns: [{ refundId, invoiceId, amount: '100000', refundState: 'Processing' }],
    },
  });
  expect(await runWalletRefund(http.pool, refundId)).toBe('completed');
  const legacy = (
    await http.pool.query('SELECT * FROM refund_obligations WHERE refund_id=$1', [refundId])
  ).rows[0];
  const command = await review(id),
    response = await send(id, '/draft-terminal', command);
  expect(response.status, http.logs()).toBe(200);
  const receipt = (await response.json()) as { refunds: Array<{ id: string; amount: string }> };
  expect(receipt.refunds).toHaveLength(1);
  expect(receipt.refunds[0]!.amount).toBe('250000');
  expect(await runWalletRefund(http.pool, receipt.refunds[0]!.id)).toBe('completed');
  expect(
    (await http.pool.query('SELECT * FROM refund_obligations WHERE refund_id=$1', [refundId]))
      .rows[0]
  ).toEqual(legacy);
  expect(
    (
      await http.pool.query(
        "SELECT SUM(amount)::text AS amount FROM wallet_transactions WHERE type='refund' AND ref_id=ANY($1::text[])",
        [[refundId, receipt.refunds[0]!.id]]
      )
    ).rows[0].amount
  ).toBe('350000');
});
it('refuses a direct orphan commit that omits one mandatory wallet obligation', async () => {
  const { id } = await actualDraft(),
    ids = await orphanFunding(id),
    before = await snapshot(id);
  const response = await send(id, '/draft-terminal/review', {
    action: 'reject',
    reason: 'Exact all-invoice closure',
  });
  expect(response.status, http.logs()).toBe(200);
  const { approval: _approval, ...review } = (await response.json()) as {
    approval: unknown;
    hash: string;
    scope: unknown;
    data: unknown;
    schemaVersion: number;
  };
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO electricity_draft_terminations(order_id,profile_id,executed_by,action,reason,review_hash,financial_review) VALUES($1,$2,'raw-reviewer','reject','Exact all-invoice closure',$3,$4::jsonb)",
      [id, profile, review.hash, JSON.stringify(review)]
    );
    await createElectricityRefundObligation(client, {
      orderId: id,
      contractId: null,
      invoiceId: ids[0]!,
      profileId: profile,
      paidAmount: '100000',
      refundedAmount: '0',
      authorizedBy: 'raw-reviewer',
      reason: 'Exact all-invoice closure',
    });
    await client.query(
      "UPDATE invoices SET state='Cancelled',cancelled_at=clock_timestamp() WHERE id=$1",
      [ids[2]]
    );
    await client.query("UPDATE orders SET status='CANCELLED' WHERE id=$1", [id]);
    await client.query("UPDATE electricity_orders SET status='rejected' WHERE id=$1", [id]);
    await client.query(
      "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,operating_context) VALUES($1,'raw-reviewer','electricity.draft.terminated',$2::jsonb,$3,'staff')",
      [
        randomUUID(),
        JSON.stringify({
          entity: 'electricity_order',
          entityId: id,
          orderId: id,
          profileId: profile,
          fromState: 'draft',
          toState: 'rejected',
          reason: 'Exact all-invoice closure',
          actor: 'raw-reviewer',
          reviewHash: review.hash,
          financialReview: review,
        }),
        randomUUID(),
      ]
    );
    await expect(client.query('COMMIT')).rejects.toMatchObject({
      code: '23514',
      message: 'Every full wallet obligation must commit atomically',
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(await snapshot(id)).toEqual(before);
  expect(
    (
      await http.pool.query(
        'SELECT order_id FROM electricity_draft_terminations WHERE order_id=$1',
        [id]
      )
    ).rows
  ).toHaveLength(0);
  expect(
    (await http.pool.query('SELECT id FROM refunds WHERE invoice_id=ANY($1::uuid[])', [ids])).rows
  ).toHaveLength(0);
});

async function legacyReturn(id: string, invoiceId: string, state = 'Processing') {
  await orphanFinance();
  const refundId = randomUUID();
  await http.pool.query(
    "INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,100000,'wallet',$4)",
    [refundId, invoiceId, profile, 'legacy:' + id]
  );
  await http.pool.query(
    "INSERT INTO refund_obligations(order_id,invoice_id,profile_id,refund_id,total_paid_amount,idempotency_key,authorized_by,reason) VALUES($1,$2,$3,$4,100000,$5,'orphan-finance','Original legacy reason')",
    [id, invoiceId, profile, refundId, 'electricity-end:' + id]
  );
  if (state !== 'Requested')
    await http.pool.query("UPDATE refunds SET state='Approved' WHERE id=$1", [refundId]);
  if (['Processing', 'Failed'].includes(state)) {
    await http.pool.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refundId]);
    await http.pool.query(
      "INSERT INTO refund_retry_jobs(refund_id,executor_user_id) VALUES($1,'orphan-finance')",
      [refundId]
    );
  }
  if (state === 'Failed') {
    await http.pool.query("UPDATE refunds SET state='Failed' WHERE id=$1", [refundId]);
    await http.pool.query(
      'UPDATE refund_retry_jobs SET attempts=max_attempts,exhausted_at=clock_timestamp(),next_attempt_at=NULL WHERE refund_id=$1',
      [refundId]
    );
  }
  return refundId;
}
it.each(['Requested', 'Approved', 'Processing', 'Failed'])(
  'adopts an exact legacy %s return without duplicating debt or resetting retries',
  async (state) => {
    const { id } = await actualDraft(),
      ids = await orphanFunding(id),
      refundId = await legacyReturn(id, ids[0]!, state);
    const old = (
      await http.pool.query('SELECT * FROM refund_obligations WHERE refund_id=$1', [refundId])
    ).rows[0];
    const job = (
      await http.pool.query('SELECT * FROM refund_retry_jobs WHERE refund_id=$1', [refundId])
    ).rows[0];
    const command = await review(id),
      response = await send(id, '/draft-terminal', command);
    expect(response.status, http.logs()).toBe(200);
    const receipt = (await response.json()) as {
      refunds: Array<{ id: string; invoiceId: string; amount: string }>;
    };
    expect(receipt.refunds).toHaveLength(2);
    expect(receipt.refunds).toContainEqual({ id: refundId, invoiceId: ids[0], amount: '100000' });
    const after = (
      await http.pool.query('SELECT * FROM refund_obligations WHERE refund_id=$1', [refundId])
    ).rows[0];
    for (const key of [
      'id',
      'order_id',
      'invoice_id',
      'profile_id',
      'refund_id',
      'total_paid_amount',
      'completed_refund_amount',
      'idempotency_key',
      'authorized_by',
      'reason',
      'created_at',
    ])
      expect(after[key]).toEqual(old[key]);
    const adoptedJob = (
      await http.pool.query('SELECT * FROM refund_retry_jobs WHERE refund_id=$1', [refundId])
    ).rows[0];
    if (job) expect(adoptedJob).toEqual(job);
    else
      expect(adoptedJob).toMatchObject({
        executor_user_id: 'orphan-finance',
        attempts: 0,
        exhausted_at: null,
      });
    expect((await send(id, '/draft-terminal', command)).status).toBe(200);
    expect(
      (await http.pool.query('SELECT id FROM refunds WHERE invoice_id=$1', [ids[0]])).rows
    ).toHaveLength(1);
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE event='refund.obligation_adopted' AND metadata::jsonb->>'entityId'=$1",
          [refundId]
        )
      ).rows
    ).toHaveLength(1);
    await expectCoreAudit(http.pool, 'refund.obligation_adopted', refundId, {
      entity: 'refund',
      fromState: state,
      toState: ['Requested', 'Approved'].includes(state) ? 'Processing' : state,
      reason: command.reason,
      actor: 'raw-reviewer',
      context: 'staff',
    });
    await http.pool.query("DELETE FROM user_roles WHERE user_id='orphan-finance'");
    if (state === 'Failed') {
      expect(await runWalletRefund(http.pool, refundId)).toBe('deferred');
      expect(
        (await http.pool.query('SELECT * FROM refund_retry_jobs WHERE refund_id=$1', [refundId]))
          .rows[0]
      ).toEqual(job);
      const finance = await orphanFinance();
      const reviewed = await fetch(
        http.base + '/api/admin/wallet-refunds/' + refundId + '/process/review',
        { method: 'POST', headers: finance, body: '{}' }
      );
      expect(reviewed.status, http.logs()).toBe(200);
      const preview = (await reviewed.json()) as { hash: string };
      const processed = await fetch(
        http.base + '/api/admin/wallet-refunds/' + refundId + '/process',
        {
          method: 'POST',
          headers: finance,
          body: JSON.stringify({ expectedReviewHash: preview.hash }),
        }
      );
      expect(processed.status, http.logs()).toBe(200);
      expect(await processed.json()).toMatchObject({ state: 'Completed' });
      const retriedJob = (
        await http.pool.query('SELECT * FROM refund_retry_jobs WHERE refund_id=$1', [refundId])
      ).rows[0];
      expect(retriedJob.attempts).toBe(job.attempts);
      expect(retriedJob.max_attempts).toBe(job.max_attempts);
      expect(retriedJob.exhausted_at).toEqual(job.exhausted_at);
      // A manual attempt is audited separately and preserves the entire exhausted automatic job.
      expect(retriedJob).toEqual(job);
      expect(
        (
          await http.pool.query(
            "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='refund.completed' AND metadata::jsonb->>'refundId'=$1",
            [refundId]
          )
        ).rows[0].metadata
      ).toMatchObject({ retriedBy: 'orphan-finance' });
      expect(
        (
          await http.pool.query(
            "SELECT amount FROM wallet_transactions WHERE type='refund' AND ref_id=$1",
            [refundId]
          )
        ).rows
      ).toEqual([{ amount: '100000' }]);
    } else {
      expect(await runWalletRefund(http.pool, refundId)).toBe('completed');
      expect(await runWalletRefund(http.pool, refundId)).toBe('deferred');
      expect(
        (
          await http.pool.query(
            "SELECT amount FROM wallet_transactions WHERE type='refund' AND ref_id=$1",
            [refundId]
          )
        ).rows
      ).toEqual([{ amount: '100000' }]);
    }
  }
);
it('invalidates a legacy adoption review when its retry budget changes', async () => {
  const { id } = await actualDraft(),
    ids = await orphanFunding(id),
    refundId = await legacyReturn(id, ids[0]!);
  const command = await review(id),
    before = await snapshot(id);
  await http.pool.query('UPDATE refund_retry_jobs SET attempts=attempts+1 WHERE refund_id=$1', [
    refundId,
  ]);
  expect((await send(id, '/draft-terminal', command)).status).toBe(409);
  expect(await snapshot(id)).toEqual(before);
  expect(
    (
      await http.pool.query(
        'SELECT order_id FROM electricity_draft_terminations WHERE order_id=$1',
        [id]
      )
    ).rows
  ).toHaveLength(0);
});
it('refuses an unbound partial legacy refund while retaining all records', async () => {
  const { id } = await actualDraft(),
    ids = await orphanFunding(id);
  await http.pool.query(
    "INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,50000,'wallet',$3)",
    [ids[0], profile, 'partial:' + id]
  );
  const before = await snapshot(id);
  expect(
    (
      await send(id, '/draft-terminal/review', {
        action: 'reject',
        reason: 'Unmatched partial return',
      })
    ).status
  ).toBe(409);
  expect(await snapshot(id)).toEqual(before);
});

it('reconciles a prior partial refund through the existing finance workflow before terminating the remaining full wallet balance', async () => {
  const { id } = await actualDraft(),
    ids = await orphanFunding(id),
    finance = await orphanFinance();
  const post = (path: string, body: unknown) =>
    fetch(http.base + '/api/admin/wallet-refunds' + path, {
      method: 'POST',
      headers: finance,
      body: JSON.stringify(body),
    });
  const request = {
    invoiceId: ids[0]!,
    amount: '50000',
    reason: 'Reconcile the existing partial wallet return',
  };
  const preview = await post('/review', request);
  expect(preview.status, http.logs()).toBe(200);
  const confirmation = (await preview.json()) as { hash: string };
  const body = { ...request, expectedReviewHash: confirmation.hash, idempotencyKey: randomUUID() };
  const requested = await post('', body);
  expect(requested.status, http.logs()).toBe(201);
  const partial = (await requested.json()) as { id: string; state: string };
  expect(partial.state).toBe('Requested');
  const before = await snapshot(id);
  expect(
    (
      await send(id, '/draft-terminal/review', {
        action: 'reject',
        reason: 'Wait for prior financial reconciliation',
      })
    ).status
  ).toBe(409);
  expect(await snapshot(id)).toEqual(before);
  expect((await post('', body)).status).toBe(201);
  for (const action of ['approve', 'process']) {
    const reviewed = await post('/' + partial.id + '/' + action + '/review', {});
    expect(reviewed.status, http.logs()).toBe(200);
    const facts = (await reviewed.json()) as { hash: string };
    const executed = await post('/' + partial.id + '/' + action, {
      expectedReviewHash: facts.hash,
    });
    expect(executed.status, http.logs()).toBe(200);
    expect(await executed.json()).toMatchObject({
      id: partial.id,
      state: action === 'approve' ? 'Approved' : 'Completed',
    });
  }
  const retained = (await http.pool.query('SELECT * FROM refunds WHERE id=$1', [partial.id]))
    .rows[0];
  expect(
    (
      await http.pool.query('SELECT state,paid_amount,refunded_amount FROM invoices WHERE id=$1', [
        ids[0],
      ])
    ).rows[0]
  ).toEqual({ state: 'PartiallyRefunded', paid_amount: '100000', refunded_amount: '50000' });
  expect((await snapshot(id)).root.status).toBe('DRAFT');
  const command = await review(id),
    ended = await send(id, '/draft-terminal', command);
  expect(ended.status, http.logs()).toBe(200);
  const receipt = (await ended.json()) as {
    refunds: Array<{ id: string; invoiceId: string; amount: string }>;
  };
  expect(receipt.refunds).toHaveLength(2);
  expect(receipt.refunds.find((r) => r.invoiceId === ids[0])?.amount).toBe('50000');
  expect(receipt.refunds.find((r) => r.invoiceId === ids[1])?.amount).toBe('250000');
  for (const refund of receipt.refunds) {
    expect(await runWalletRefund(http.pool, refund.id)).toBe('completed');
    expect(await runWalletRefund(http.pool, refund.id)).toBe('deferred');
  }
  expect(
    (await http.pool.query('SELECT * FROM refunds WHERE id=$1', [partial.id])).rows[0]
  ).toEqual(retained);
  expect(
    (
      await http.pool.query(
        "SELECT SUM(amount)::text AS amount,COUNT(*)::int AS count FROM wallet_transactions WHERE type='refund' AND ref_id=ANY($1::text[])",
        [[partial.id, ...receipt.refunds.map((r) => r.id)]]
      )
    ).rows[0]
  ).toEqual({ amount: '350000', count: 3 });
  const after = await snapshot(id);
  expect(after.wizard).toEqual(before.wizard);
  expect(after.contracts).toBeNull();
  expect(after.root.status).toBe('CANCELLED');
  expect(after.draft.status).toBe('rejected');
  const audits = (
    await http.pool.query(
      "SELECT a.user_id,a.metadata::jsonb AS metadata,s.step_up_verified_at AS verified_at FROM audit_log a JOIN sessions s ON s.session_id::text=a.metadata::jsonb->>'sessionId' WHERE a.metadata::jsonb->>'refundId'=$1 AND a.event IN ('refund.requested','refund.approved','refund.process_requested') ORDER BY a.id",
      [partial.id]
    )
  ).rows;
  expect(audits.length).toBeGreaterThanOrEqual(2);
  for (const row of audits) {
    expect(row.user_id).toBe('orphan-finance');
    expect(row.metadata).toMatchObject({
      stepUpVerified: true,
      stepUpVerifiedAt: row.verified_at.toISOString(),
    });
  }
  const terminal = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=$1",
      [id]
    )
  ).rows[0].metadata;
  const verified = (
    await http.pool.query("SELECT step_up_verified_at FROM sessions WHERE user_id='raw-reviewer'")
  ).rows[0].step_up_verified_at as Date;
  expect(terminal).toMatchObject({
    stepUpVerified: true,
    stepUpVerifiedAt: verified.toISOString(),
  });
});
