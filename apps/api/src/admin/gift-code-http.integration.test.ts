import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>,
  headers: Record<string, string>,
  giftId: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('gift-editor','Slot editor','Test','["admin:promotions:edit"]'); INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('gift-admin','gift-admin@example.test','test-only',true); INSERT INTO user_roles(user_id,role_id) VALUES ('gift-admin','gift-editor')`
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'gift-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    cookie: `barghsa_session=${session}`,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
}, 30000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM gift_codes; DELETE FROM audit_log WHERE event='change_recorded'"
  );
  giftId = (
    await http.pool.query(
      "INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,created_by) VALUES ('ORIGINAL','fixed_irr',1000,'2026-01-01','gift-admin') RETURNING id"
    )
  ).rows[0].id;
});
function mutation(action: 'create' | 'update' | 'toggle') {
  return fetch(
    `${http.base}/api/admin/promotions/gift-codes${action === 'create' ? '' : `/${giftId}`}${action === 'toggle' ? '/toggle' : ''}`,
    {
      method: action === 'update' ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify(
        action === 'create'
          ? { code: 'SECOND', discountType: 'fixed_irr', discountValue: '1000' }
          : action === 'update'
            ? { code: 'CHANGED' }
            : { status: 'inactive' }
      ),
    }
  );
}
it('persists cancellation restoration settings through create and edit', async () => {
  const invalid = await fetch(`${http.base}/api/admin/promotions/gift-codes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: 'INVALIDPOLICY',
      discountType: 'fixed_irr',
      discountValue: '1000',
      restoreOnCancel: false,
      restoreAfterPayment: true,
    }),
  });
  expect(invalid.status).toBe(400);
  const createdResponse = await fetch(`${http.base}/api/admin/promotions/gift-codes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: 'RESTOREPOLICY',
      discountType: 'fixed_irr',
      discountValue: '1000',
      restoreOnCancel: false,
      restoreAfterPayment: false,
    }),
  });
  expect(createdResponse.status).toBe(201);
  const created = (await createdResponse.json()) as {
    id: string;
    restoreOnCancel: boolean;
    restoreAfterPayment: boolean;
  };
  expect(created).toMatchObject({ restoreOnCancel: false, restoreAfterPayment: false });
  const updatedResponse = await fetch(
    `${http.base}/api/admin/promotions/gift-codes/${created.id}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ restoreOnCancel: true, restoreAfterPayment: true }),
    }
  );
  expect(updatedResponse.status).toBe(200);
  expect(await updatedResponse.json()).toMatchObject({
    restoreOnCancel: true,
    restoreAfterPayment: true,
  });
  expect(
    (
      await http.pool.query(
        'SELECT restore_on_cancel,restore_after_payment FROM gift_codes WHERE id=$1',
        [created.id]
      )
    ).rows[0]
  ).toEqual({ restore_on_cancel: true, restore_after_payment: true });
});
it('filters and pages gift codes without repeating rows', async () => {
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('gift-admin','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id as string;
  const restrictedId = (
    await http.pool.query(
      `INSERT INTO gift_codes(code,discount_type,discount_value,eligibility,valid_from,valid_until,created_at,created_by)
       VALUES ('RESTRICTED','fixed_irr',1000,'profile','2026-01-01','2027-01-01','2026-06-03','gift-admin') RETURNING id`
    )
  ).rows[0].id as string;
  await http.pool.query('INSERT INTO gift_code_profiles(gift_code_id,profile_id) VALUES($1,$2)', [
    restrictedId,
    profileId,
  ]);
  await http.pool.query(
    `INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,created_at,created_by)
     VALUES ('NEXT','fixed_irr',1000,'2026-01-01','2026-06-04','gift-admin')`
  );
  await http.pool.query(
    `INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,valid_until,created_at,created_by)
     VALUES ('EXPIRED','fixed_irr',1000,'2026-01-01','2026-02-01','2026-06-02','gift-admin')`
  );
  const list = async (params: URLSearchParams) =>
    fetch(`${http.base}/api/admin/promotions/gift-codes?${params}`, { headers });
  const first = await list(new URLSearchParams({ limit: '2' }));
  expect(first.status).toBe(200);
  const firstRows = (await first.json()) as Array<{ id: string; code: string; createdAt: string }>;
  expect(firstRows.map((row) => row.code)).toEqual(['ORIGINAL', 'NEXT']);
  const last = firstRows[1]!;
  const second = await list(new URLSearchParams({ limit: '2', before: last.id }));
  expect(second.status).toBe(200);
  expect(((await second.json()) as Array<{ code: string }>).map((row) => row.code)).toEqual([
    'RESTRICTED',
    'EXPIRED',
  ]);
  const restricted = await list(new URLSearchParams({ eligibility: 'profile', limit: '2' }));
  expect(((await restricted.json()) as Array<{ code: string }>).map((row) => row.code)).toEqual([
    'RESTRICTED',
  ]);
  const expired = await list(new URLSearchParams({ expiry: 'expired', limit: '2' }));
  expect(((await expired.json()) as Array<{ code: string }>).map((row) => row.code)).toEqual([
    'EXPIRED',
  ]);
  expect((await list(new URLSearchParams({ expiry: 'past' }))).status).toBe(400);
  expect((await list(new URLSearchParams({ limit: '101' }))).status).toBe(400);
  expect((await list(new URLSearchParams({ before: 'bad-cursor' }))).status).toBe(400);
});
it('returns readable per-profile usage and restoration history', async () => {
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,title) VALUES ('gift-admin','LEGAL','ACTIVE','Promo Buyer') RETURNING id"
    )
  ).rows[0].id as string;
  const productId = (
    await http.pool.query(
      `INSERT INTO products(type,system_key,title,status,price)
       VALUES ('electricity','thermal','{"en":"Thermal"}','active',1000)
       ON CONFLICT (system_key) DO UPDATE SET status='active' RETURNING id`
    )
  ).rows[0].id as string;
  const orderId = (
    await http.pool.query(
      `INSERT INTO orders(user_id,profile_id,product_id,order_type,snapshot_province_id,
                          snapshot_city_id,snapshot_full_address,snapshot_postal_code)
       VALUES ('gift-admin',$1,$2,'electricity','province','city','Street','1234567890') RETURNING id`,
      [profileId, productId]
    )
  ).rows[0].id as string;
  await http.pool.query(
    `INSERT INTO gift_code_redemptions(gift_code_id,profile_id,order_id,discount_amount,status,restored_at)
     VALUES ($1,$2,$3,1000,'released','2026-09-24T01:00:00Z')`,
    [giftId, profileId, orderId]
  );
  try {
    const response = await fetch(`${http.base}/api/admin/promotions/gift-codes/${giftId}/stats`, {
      headers,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      perProfile: [
        { profileId, profileTitle: 'Promo Buyer', consumed: 0, released: 1, discountIrr: '0' },
      ],
      recentRedemptions: [
        { orderId, profileId, status: 'released', restoredAt: '2026-09-24T01:00:00.000Z' },
      ],
    });
  } finally {
    await http.pool.query('DELETE FROM gift_code_redemptions WHERE order_id=$1', [orderId]);
    await http.pool.query('DELETE FROM orders WHERE id=$1', [orderId]);
    await http.pool.query('DELETE FROM profiles WHERE id=$1', [profileId]);
  }
});
async function unchanged() {
  expect((await http.pool.query('SELECT id,code,status FROM gift_codes')).rows).toEqual([
    { id: giftId, code: 'ORIGINAL', status: 'active' },
  ]);
}
it.each(['create', 'update', 'toggle'] as const)(
  'rolls back gift code %s on audit failure',
  async (action) => {
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_gift_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_gift_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event = 'change_recorded') EXECUTE FUNCTION reject_gift_audit()"
    );
    try {
      expect((await mutation(action)).status).toBe(500);
      await unchanged();
    } finally {
      await http.pool.query('DROP TRIGGER reject_gift_audit ON audit_log');
    }
  }
);
it.each(['create', 'update', 'toggle'] as const)(
  'rejects gift code %s when permission is withdrawn during session validation',
  async (action) => {
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='gift-admin' FOR UPDATE");
      pending = mutation(action);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%JOIN sessions s%WHERE s.session_id=$1 FOR UPDATE OF u%'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query("DELETE FROM user_roles WHERE user_id='gift-admin'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      await unchanged();
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('gift-admin','gift-editor') ON CONFLICT DO NOTHING"
      );
    }
  }
);

it('preserves a concurrent activation change when editing the code', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE gift_codes SET status='inactive' WHERE id=$1", [giftId]);
    pending = mutation('update');
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM gift_codes%FOR UPDATE%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(200);
    expect(
      (await http.pool.query('SELECT code,status FROM gift_codes WHERE id=$1', [giftId])).rows
    ).toEqual([{ code: 'CHANGED', status: 'inactive' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
it('persists gift-code changes and suppresses repeated activation audits', async () => {
  expect((await mutation('create')).status).toBe(201);
  expect((await mutation('update')).status).toBe(200);
  expect((await mutation('toggle')).status).toBe(200);
  expect((await mutation('toggle')).status).toBe(200);
  expect((await http.pool.query('SELECT code,status FROM gift_codes ORDER BY code')).rows).toEqual([
    { code: 'CHANGED', status: 'inactive' },
    { code: 'SECOND', status: 'active' },
  ]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
  ).toHaveLength(3);
});

for (const method of ['POST', 'PATCH'])
  it.each([
    { discountValue: '9223372036854775808' },
    { discountType: 'percentage', discountValue: '100', maxCapIrr: '9223372036854775808' },
    { minOrderAmount: '9223372036854775808' },
    { totalLimit: 2147483648 },
    { perProfileLimit: 2147483648 },
    { code: '   ' },
    { unexpected: true },
    { validFrom: '2027-01-01T00:00:00' },
    { validUntil: '2027-01-01T00:00:00' },
    { categories: ['unknown'] },
  ])(`rejects invalid gift-code ${method} payload %j`, async (body) => {
    const response = await fetch(
      `${http.base}/api/admin/promotions/gift-codes${method === 'PATCH' ? `/${giftId}` : ''}`,
      {
        method,
        headers,
        body: JSON.stringify({
          ...(method === 'POST'
            ? { code: 'SECOND', discountType: 'fixed_irr', discountValue: '1000' }
            : {}),
          ...body,
        }),
      }
    );
    expect(response.status).toBe(400);
    await unchanged();
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
    ).toHaveLength(0);
  });
it('accepts exact database bounds and normalizes a code', async () => {
  const response = await fetch(`${http.base}/api/admin/promotions/gift-codes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: ' second ',
      discountType: 'fixed_irr',
      discountValue: '9223372036854775807',
      minOrderAmount: '9223372036854775807',
      totalLimit: 2147483647,
      perProfileLimit: 2147483647,
      validFrom: '2026-01-01T03:30:00+03:30',
    }),
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    code: 'SECOND',
    discountValue: '9223372036854775807',
    minOrderAmount: '9223372036854775807',
    totalLimit: 2147483647,
    perProfileLimit: 2147483647,
    validFrom: '2026-01-01T00:00:00.000Z',
  });
});
it('rejects unknown activation fields without changing state', async () => {
  const response = await fetch(`${http.base}/api/admin/promotions/gift-codes/${giftId}/toggle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'inactive', unexpected: true }),
  });
  expect(response.status).toBe(400);
  await unchanged();
});

it('requires selected profiles when restricting a public gift code', async () => {
  const response = await fetch(`${http.base}/api/admin/promotions/gift-codes/${giftId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ eligibility: 'profile' }),
  });
  expect(response.status).toBe(400);
  await unchanged();
  expect(
    (await http.pool.query('SELECT eligibility FROM gift_codes WHERE id=$1', [giftId])).rows[0]
      .eligibility
  ).toBe('public');
});
it('preserves restricted selections on edits and clears them when made public', async () => {
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,first_name) VALUES ('gift-admin','INDIVIDUAL','VERIFIED','Gift recipient') RETURNING id"
    )
  ).rows[0].id;
  const edit = (body: unknown) =>
    fetch(`${http.base}/api/admin/promotions/gift-codes/${giftId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
  const restricted = await edit({ eligibility: 'profile', profileIds: [profile, profile] });
  expect(restricted.status).toBe(200);
  expect(await restricted.json()).toMatchObject({ eligibility: 'profile', profileIds: [profile] });
  const edited = await edit({ discountValue: '2000' });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ profileIds: [profile], discountValue: '2000' });
  const publicCode = await edit({ eligibility: 'public', profileIds: [profile] });
  expect(publicCode.status).toBe(200);
  expect(await publicCode.json()).toMatchObject({ eligibility: 'public', profileIds: [] });
  const created = await fetch(`${http.base}/api/admin/promotions/gift-codes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: 'SECOND',
      discountType: 'fixed_irr',
      discountValue: '1000',
      eligibility: 'public',
      profileIds: [profile],
    }),
  });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ profileIds: [] });
});
it('requires repairing a legacy empty restricted scope before activation', async () => {
  await http.pool.query(
    "UPDATE gift_codes SET eligibility='profile',status='inactive' WHERE id=$1",
    [giftId]
  );
  const response = await fetch(`${http.base}/api/admin/promotions/gift-codes/${giftId}/toggle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'active' }),
  });
  expect(response.status).toBe(400);
  expect(
    (await http.pool.query('SELECT status FROM gift_codes WHERE id=$1', [giftId])).rows[0].status
  ).toBe('inactive');
});

it('searches only current profile names and resolves selected archived profiles without personal identifiers', async () => {
  const current = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,first_name,last_name) VALUES ('gift-admin','INDIVIDUAL','VERIFIED','Unique recipient','One') RETURNING id"
    )
  ).rows[0].id;
  const archived = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,title,archived) VALUES ('gift-admin','LEGAL','VERIFIED','Unique recipient company',true) RETURNING id"
    )
  ).rows[0].id;
  const search = await fetch(
    `${http.base}/api/admin/promotions/gift-codes/profiles?search=Unique%20recipient`,
    { headers }
  );
  expect(search.status).toBe(200);
  expect(await search.json()).toEqual([
    { id: current, title: 'Unique recipient One', profileType: 'INDIVIDUAL', archived: false },
  ]);
  const selected = await fetch(
    `${http.base}/api/admin/promotions/gift-codes/profiles?ids=${archived}`,
    { headers }
  );
  expect(selected.status).toBe(200);
  expect(await selected.json()).toEqual([
    { id: archived, title: 'Unique recipient company', profileType: 'LEGAL', archived: true },
  ]);
  expect(
    (await fetch(`${http.base}/api/admin/promotions/gift-codes/profiles?ids=invalid`, { headers }))
      .status
  ).toBe(400);
  expect(
    (
      await fetch(
        `${http.base}/api/admin/promotions/gift-codes/profiles?search=${'a'.repeat(101)}`,
        { headers }
      )
    ).status
  ).toBe(400);
});
