import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { contractReviewConfirmation } from '../test/contract-review-confirmation.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from './contract.service.js';
type ContractDto = Awaited<ReturnType<ContractService['get']>>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await login('review-legal', 'role-legal-contracts');
  await login('review-support', 'role-customer-support');
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function login(user: string, role?: string) {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',$2)",
    [user, !!role]
  );
  if (role)
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')",
    [session, user, csrf, randomUUID()]
  );
  headers[user] = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  return user;
}
async function send(path: string, method = 'GET', body?: unknown, user = 'review-legal') {
  if (method === 'POST')
    body = await contractReviewConfirmation(http.base, path, headers[user]!, body);
  return fetch(http.base + '/api/' + path, {
    method,
    headers: headers[user]!,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function fixture(
  serviceType: 'electricity' | 'savings' = 'electricity',
  linkedOrder = false
) {
  const owner = await login(randomUUID()),
    profile = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,is_default,profile_type) VALUES($1,$2,true,'LEGAL')",
    [profile, owner]
  );
  let orderId: string | null = null;
  if (linkedOrder) {
    orderId = randomUUID();
    const product = (
      await http.pool.query<{ id: string }>(
        "INSERT INTO products(type,title) VALUES('hardware',$1::jsonb) RETURNING id",
        [JSON.stringify({ fa: 'تست', en: 'Test' })]
      )
    ).rows[0]!.id;
    await http.pool.query(
      "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','p','c','address','1234567890')",
      [orderId, owner, profile, product]
    );
  }
  const response = await send('admin/contracts', 'POST', {
    profileId: profile,
    serviceType,
    ...(orderId ? { orderId } : {}),
    content: { price: '9007199254740993' },
    changeDescription: 'Initial',
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return { owner, profile, orderId, row: (await response.json()) as ContractDto };
}
const command = (version: string) => ({ expectedVersionId: version, idempotencyKey: randomUUID() });
const action = (id: string, which: string, body: unknown) =>
  send('admin/contracts/' + id + '/' + which, 'POST', body);
async function publish(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await action(f.row.id, 'submit', command(f.row.currentVersionId))).status).toBe(200);
  expect((await action(f.row.id, 'publish', command(f.row.currentVersionId))).status).toBe(200);
}
async function customer(f: Awaited<ReturnType<typeof fixture>>, suffix = '', user = f.owner) {
  return send('contracts/' + f.row.id + suffix, 'GET', undefined, user);
}
it('exposes the linked electricity order only after publication to its authorized customer', async () => {
  const f = await fixture('electricity', true);
  expect((await customer(f)).status).toBe(404);
  await publish(f);
  expect(await (await customer(f)).json()).toMatchObject({ orderId: f.orderId });
  const other = await fixture();
  expect((await customer(f, '', other.owner)).status).toBe(404);
});
it('links an authorized invoice to its contract only after publication', async () => {
  const f = await fixture();
  const invoiceId = randomUUID();
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,state,total_amount,issued_at,payable_from) VALUES($1,$2,$3,'Unpaid',100,NOW(),NOW())",
    [invoiceId, f.profile, f.row.id]
  );
  const invoice = (user: string) => send('invoices/' + invoiceId, 'GET', undefined, user);
  const unpublished = (await (await invoice(f.owner)).json()) as { contractId: string | null };
  expect(unpublished.contractId).toBeNull();
  await publish(f);
  const visible = await invoice(f.owner);
  expect(visible.status).toBe(200);
  expect(await visible.json()).toMatchObject({ contractId: f.row.id });
  const other = await fixture();
  expect((await invoice(other.owner)).status).toBe(404);
});
it('shows the published service period and initial invoice on customer and staff contract lists', async () => {
  const f = await fixture('electricity', true);
  await http.pool.query("UPDATE profiles SET title='Acme Energy' WHERE id=$1", [f.profile]);
  const invoiceId = randomUUID();
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,state,total_amount,issued_at,payable_from) VALUES($1,$2,$3,'Unpaid',125000,NOW(),NOW())",
    [invoiceId, f.profile, f.row.id]
  );
  await http.pool.query(
    `UPDATE contract_activation_requirements
     SET initial_invoice_id=$2,service_starts_at=$3,service_ends_at=$4 WHERE version_id=$1`,
    [f.row.currentVersionId, invoiceId, '2026-10-01T00:00:00Z', '2027-10-01T00:00:00Z']
  );
  await publish(f);
  const customerList = await send('contracts', 'GET', undefined, f.owner);
  expect(customerList.status).toBe(200);
  expect(await customerList.json()).toMatchObject({
    contracts: [
      {
        id: f.row.id,
        profileType: 'LEGAL',
        profileTitle: 'Acme Energy',
        orderId: f.orderId,
        serviceStartsAt: '2026-10-01T00:00:00.000Z',
        serviceEndsAt: '2027-10-01T00:00:00.000Z',
        initialInvoiceId: invoiceId,
        initialInvoiceAmount: '125000',
        initialInvoiceState: 'Unpaid',
      },
    ],
  });
  const staffList = await send('admin/contracts?profileId=' + f.profile);
  expect(staffList.status).toBe(200);
  expect(await staffList.json()).toMatchObject({
    contracts: [
      {
        id: f.row.id,
        profileType: 'LEGAL',
        profileTitle: 'Acme Energy',
        orderId: f.orderId,
        serviceStartsAt: '2026-10-01T00:00:00.000Z',
        serviceEndsAt: '2027-10-01T00:00:00.000Z',
        initialInvoiceId: invoiceId,
        initialInvoiceAmount: '125000',
        initialInvoiceState: 'Unpaid',
      },
    ],
  });
  const other = await fixture();
  const otherList = await send('contracts', 'GET', undefined, other.owner);
  expect(
    ((await otherList.json()) as { contracts: Array<{ id: string }> }).contracts
  ).not.toContainEqual(expect.objectContaining({ id: f.row.id }));
});
it('lists an activated contract in the active-only customer view', async () => {
  const f = await fixture('savings');
  await publish(f);
  const accepted = await send(
    'contracts/' + f.row.id + '/accept',
    'POST',
    command(f.row.currentVersionId),
    f.owner
  );
  expect(accepted.status).toBe(200);
  await http.pool.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
    f.row.id,
    f.row.currentVersionId,
  ]);
  const response = await send('contracts?state=Active', 'GET', undefined, f.owner);
  expect(response.status).toBe(200);
  expect(
    ((await response.json()) as { contracts: Array<{ id: string }> }).contracts.map((row) => row.id)
  ).toContain(f.row.id);
});
it('keeps drafts private and publishes only the exact reviewed version', async () => {
  const f = await fixture();
  expect((await customer(f)).status).toBe(404);
  expect((await customer(f, '/versions/' + f.row.currentVersionId)).status).toBe(404);
  expect(await (await send('contracts', 'GET', undefined, f.owner)).json()).toEqual({
    contracts: [],
    nextBefore: null,
  });
  expect((await action(f.row.id, 'publish', command(f.row.currentVersionId))).status).toBe(409);
  await publish(f);
  const result = await customer(f);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    id: f.row.id,
    canAccept: true,
    state: 'AwaitingCustomerAcceptance',
    version: {
      id: f.row.currentVersionId,
      content: { price: '9007199254740993' },
      publishedAt: expect.any(String),
      acceptedAt: null,
    },
  });
  const list = (await (await send('contracts', 'GET', undefined, f.owner)).json()) as {
    contracts: Array<{ id: string }>;
  };
  expect(list.contracts.map((r) => r.id)).toEqual([f.row.id]);
  const activeList = await send('contracts?state=Active', 'GET', undefined, f.owner);
  expect(activeList.status).toBe(200);
  expect(await activeList.json()).toEqual({ contracts: [], nextBefore: null });
  expect((await send('contracts?state=Draft', 'GET', undefined, f.owner)).status).toBe(400);
  expect(
    (
      await send('admin/contracts/' + f.row.id, 'PATCH', {
        ...command(f.row.currentVersionId),
        content: { price: '200' },
        changeDescription: 'Unreviewed edit',
      })
    ).status
  ).toBe(409);
});
it('requests changes with a durable reason, revises, and publishes without exposing the old draft', async () => {
  const f = await fixture();
  await action(f.row.id, 'submit', command(f.row.currentVersionId));
  expect((await action(f.row.id, 'request-changes', command(f.row.currentVersionId))).status).toBe(
    400
  );
  expect(
    (
      await action(f.row.id, 'request-changes', {
        ...command(f.row.currentVersionId),
        reason: 'Correct the price',
      })
    ).status
  ).toBe(200);
  expect((await customer(f)).status).toBe(404);
  expect(
    (
      await send('admin/contracts/' + f.row.id, 'PATCH', {
        ...command(f.row.currentVersionId),
        content: f.row.currentVersion.content,
        changeDescription: 'No material change',
      })
    ).status
  ).toBe(409);
  const changed = await send('admin/contracts/' + f.row.id, 'PATCH', {
    ...command(f.row.currentVersionId),
    content: { price: '200' },
    changeDescription: 'Corrected price',
  });
  expect(changed.status).toBe(200);
  const row = (await changed.json()) as ContractDto;
  expect(row.state).toBe('AwaitingStaffReview');
  expect(row.currentVersion.versionNumber).toBe(2);
  expect((await action(row.id, 'publish', command(f.row.currentVersionId))).status).toBe(409);
  expect((await action(row.id, 'publish', command(row.currentVersionId))).status).toBe(200);
  expect((await customer(f, '/versions/' + f.row.currentVersionId)).status).toBe(404);
  const history = (await (await customer(f, '/versions')).json()) as {
    versions: Array<{ id: string }>;
  };
  expect(history.versions.map((v) => v.id)).toEqual([row.currentVersionId]);
  const audit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='contract.changes_requested' AND metadata::jsonb->>'contractId'=$1",
      [row.id]
    )
  ).rows[0].metadata;
  expect(audit.reason).toBe('Correct the price');
  const notices = (
    await http.pool.query(
      'SELECT localized_content FROM in_app_notifications WHERE recipient_user_id=$1',
      [f.owner]
    )
  ).rows;
  expect(notices.some((n) => n.localized_content.en.body.includes('Correct the price'))).toBe(true);
  expect(notices.some((n) => n.localized_content.fa.body.includes('نسخه جدید'))).toBe(true);
  expect(
    notices.every(
      (n) =>
        n.localized_content.en.body.includes(row.id) && n.localized_content.fa.body.includes(row.id)
    )
  ).toBe(true);
});
it('accepts once with exact version, actor and timestamp evidence without activating or signing', async () => {
  const f = await fixture();
  await publish(f);
  expect(
    (await send('contracts/' + f.row.id + '/accept', 'POST', command(randomUUID()), f.owner)).status
  ).toBe(409);
  const body = command(f.row.currentVersionId);
  const responses = await Promise.all([
    send('contracts/' + f.row.id + '/accept', 'POST', body, f.owner),
    send('contracts/' + f.row.id + '/accept', 'POST', body, f.owner),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  const first = await responses[0]!.json();
  expect(await responses[1]!.json()).toEqual(first);
  expect(first).toMatchObject({
    state: 'Accepted',
    canAccept: false,
    version: { acceptedBy: f.owner, acceptedAt: expect.any(String) },
  });
  expect(
    (
      await http.pool.query(
        'SELECT state,accepted_at,signed_at,activated_at FROM contracts WHERE id=$1',
        [f.row.id]
      )
    ).rows[0]
  ).toMatchObject({
    state: 'Accepted',
    accepted_at: expect.any(Date),
    signed_at: null,
    activated_at: null,
  });
  expect(
    (
      await http.pool.query('SELECT count(*) FROM contract_acceptances WHERE contract_id=$1', [
        f.row.id,
      ])
    ).rows[0].count
  ).toBe('1');
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        f.owner
      )
    ).status
  ).toBe(409);
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        { ...body, expectedVersionId: randomUUID() },
        f.owner
      )
    ).status
  ).toBe(409);
});
it('makes review retries idempotent and rejects competing publication and change requests', async () => {
  const f = await fixture(),
    body = command(f.row.currentVersionId);
  const responses = await Promise.all([
    action(f.row.id, 'submit', body),
    action(f.row.id, 'submit', body),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
  expect(
    (await action(f.row.id, 'submit', { ...body, expectedVersionId: randomUUID() })).status
  ).toBe(409);
  const results = await Promise.all([
    action(f.row.id, 'publish', command(f.row.currentVersionId)),
    action(f.row.id, 'request-changes', { ...command(f.row.currentVersionId), reason: 'Recheck' }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
});
it('enforces legal customer permission, selected-profile isolation and fresh step-up', async () => {
  const f = await fixture(),
    other = await fixture();
  await publish(f);
  await publish(other);
  const finance = await login(randomUUID()),
    legal = await login(randomUUID());
  for (const [user, role] of [
    [finance, 'Finance'],
    [legal, 'Legal'],
  ]) {
    await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,$3)', [
      f.profile,
      user,
      role,
    ]);
    await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
      user,
      f.profile,
    ]);
  }
  expect((await customer(f, '', finance)).status).toBe(404);
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        finance
      )
    ).status
  ).toBe(404);
  expect((await customer(other, '', legal)).status).toBe(404);
  expect((await customer(f, '/versions/' + other.row.currentVersionId)).status).toBe(404);
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        'review-legal'
      )
    ).status
  ).toBe(404);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 day' WHERE user_id=$1",
    [legal]
  );
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        legal
      )
    ).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    [legal]
  );
  const accepted = await send(
    'contracts/' + f.row.id + '/accept',
    'POST',
    command(f.row.currentVersionId),
    legal
  );
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ version: { acceptedBy: legal } });
  await http.pool.query('DELETE FROM profile_agents WHERE user_id=$1', [legal]);
  expect((await customer(f, '', legal)).status).toBe(404);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await customer(f)).status).toBe(404);
  expect((await action(f.row.id, 'submit', command(f.row.currentVersionId))).status).toBe(409);
});
it('validates review and customer routes and requires legal staff authorization', async () => {
  const f = await fixture();
  expect((await fetch(http.base + '/api/contracts')).status).toBe(401);
  expect(
    (
      await send(
        'admin/contracts/' + f.row.id + '/submit',
        'POST',
        command(f.row.currentVersionId),
        'review-support'
      )
    ).status
  ).toBe(403);
  for (const path of [
    'contracts?before=bad',
    'contracts/bad',
    'contracts/' + f.row.id + '/versions/bad',
    'contracts/' + f.row.id + '/versions?before=0',
  ])
    expect((await send(path, 'GET', undefined, f.owner)).status).toBe(400);
  expect((await action('bad', 'submit', command(f.row.currentVersionId))).status).toBe(400);
  expect((await action(f.row.id, 'bad', command(f.row.currentVersionId))).status).toBe(400);
  expect((await action(randomUUID(), 'submit', command(f.row.currentVersionId))).status).toBe(404);
  expect(
    (await action(f.row.id, 'submit', { ...command(f.row.currentVersionId), reason: 'unwanted' }))
      .status
  ).toBe(400);
  expect(
    (
      await send(
        'contracts/' + randomUUID() + '/accept',
        'POST',
        command(f.row.currentVersionId),
        f.owner
      )
    ).status
  ).toBe(404);
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        f.owner
      )
    ).status
  ).toBe(404);
});
it.each(['audit', 'notice'])(
  'rolls back publication and retry claims when %s fails',
  async (failure) => {
    const f = await fixture();
    await action(f.row.id, 'submit', command(f.row.currentVersionId));
    const body = command(f.row.currentVersionId);
    const table = failure === 'audit' ? 'audit_log' : 'in_app_notifications';
    await http.pool.query(
      "CREATE FUNCTION fail_contract_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'review evidence unavailable'; END $$"
    );
    await http.pool.query(
      `CREATE TRIGGER fail_contract_review BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_contract_review()`
    );
    try {
      expect((await action(f.row.id, 'publish', body)).status).toBe(500);
    } finally {
      await http.pool.query(`DROP TRIGGER fail_contract_review ON ${table}`);
      await http.pool.query('DROP FUNCTION fail_contract_review()');
    }
    expect(
      (await http.pool.query('SELECT state FROM contracts WHERE id=$1', [f.row.id])).rows[0].state
    ).toBe('AwaitingStaffReview');
    expect(
      (
        await http.pool.query('SELECT * FROM contract_publications WHERE contract_id=$1', [
          f.row.id,
        ])
      ).rows
    ).toEqual([]);
    expect((await action(f.row.id, 'publish', body)).status).toBe(200);
  }
);
it('rolls back acceptance evidence, version timestamp and state if notification delivery cannot be queued', async () => {
  const f = await fixture();
  await publish(f);
  const body = command(f.row.currentVersionId);
  await http.pool.query(
    "CREATE FUNCTION fail_accept_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notice unavailable'; END $$"
  );
  await http.pool.query(
    'CREATE TRIGGER fail_accept_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_accept_notice()'
  );
  try {
    expect((await send('contracts/' + f.row.id + '/accept', 'POST', body, f.owner)).status).toBe(
      500
    );
  } finally {
    await http.pool.query('DROP TRIGGER fail_accept_notice ON in_app_notifications');
    await http.pool.query('DROP FUNCTION fail_accept_notice()');
  }
  expect(
    (
      await http.pool.query('SELECT accepted_at FROM contract_versions WHERE id=$1', [
        f.row.currentVersionId,
      ])
    ).rows[0].accepted_at
  ).toBeNull();
  expect(
    (await http.pool.query('SELECT state FROM contracts WHERE id=$1', [f.row.id])).rows[0].state
  ).toBe('AwaitingCustomerAcceptance');
  expect((await send('contracts/' + f.row.id + '/accept', 'POST', body, f.owner)).status).toBe(200);
});
it('database evidence cannot be fabricated out of order, rewritten, deleted or attached to another version', async () => {
  const f = await fixture();
  for (const table of ['contract_publications', 'contract_acceptances']) {
    const actor = table === 'contract_publications' ? 'published_by' : 'accepted_by';
    await expect(
      http.pool.query(`INSERT INTO ${table}(contract_id,version_id,${actor}) VALUES($1,$2,$3)`, [
        f.row.id,
        f.row.currentVersionId,
        f.owner,
      ])
    ).rejects.toMatchObject({ code: '23514' });
  }
  await expect(
    http.pool.query("UPDATE contracts SET state='Accepted' WHERE id=$1", [f.row.id])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query('UPDATE contract_versions SET accepted_at=NOW() WHERE id=$1', [
      f.row.currentVersionId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await publish(f);
  await send('contracts/' + f.row.id + '/accept', 'POST', command(f.row.currentVersionId), f.owner);
  for (const table of ['contract_publications', 'contract_acceptances']) {
    await expect(
      http.pool.query(`DELETE FROM ${table} WHERE contract_id=$1`, [f.row.id])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      http.pool.query(`UPDATE ${table} SET contract_id=$2 WHERE contract_id=$1`, [
        f.row.id,
        randomUUID(),
      ])
    ).rejects.toMatchObject({ code: '23514' });
  }
});

it.each(['role removed', 'profile archived'])(
  'rejects acceptance after %s during a profile lock wait',
  async (change) => {
    const f = await fixture();
    await publish(f);
    const legal = await login(randomUUID());
    await http.pool.query(
      "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Legal')",
      [f.profile, legal]
    );
    await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
      legal,
      f.profile,
    ]);
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profile]);
      if (change === 'role removed')
        await client.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
          f.profile,
          legal,
        ]);
      else await client.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        legal
      );
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await http.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pg_blocking_pids(pid) @> ARRAY[$1]::integer[] AND query LIKE '%archived FROM profiles%'",
          [blocker]
        );
        if (result.rows.length) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await client.query('COMMIT');
      expect((await pending).status).toBe(404);
      expect(
        (
          await http.pool.query('SELECT * FROM contract_acceptances WHERE contract_id=$1', [
            f.row.id,
          ])
        ).rows
      ).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
    }
  }
);
it('allows Manager reads without acceptance and requires a live customer account and CSRF proof', async () => {
  const f = await fixture();
  await publish(f);
  const manager = await login(randomUUID());
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Manager')",
    [f.profile, manager]
  );
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
    manager,
    f.profile,
  ]);
  const managerRead = await customer(f, '', manager);
  expect(managerRead.status).toBe(200);
  expect(await managerRead.json()).toMatchObject({ canAccept: false });
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        manager
      )
    ).status
  ).toBe(404);
  expect(
    (
      await fetch(http.base + '/api/contracts/' + f.row.id + '/accept', {
        method: 'POST',
        headers: { Cookie: headers[f.owner]!.Cookie!, 'Content-Type': 'application/json' },
        body: JSON.stringify(command(f.row.currentVersionId)),
      })
    ).status
  ).toBe(403);
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.owner]);
  expect((await customer(f)).status).toBe(401);
});
it('returns bounded published histories with exclusive cursors and never leaks an internal revision', async () => {
  const f = await fixture();
  await publish(f);
  const history = (await (await customer(f, '/versions?before=2')).json()) as {
    versions: Array<{ id: string }>;
    nextBefore: null;
  };
  expect(history.versions.map((v) => v.id)).toEqual([f.row.currentVersionId]);
  expect(history.nextBefore).toBeNull();
  expect(await (await customer(f, '/versions?before=1')).json()).toEqual({
    versions: [],
    nextBefore: null,
  });
  expect(
    await (await send('contracts?before=' + f.row.id, 'GET', undefined, f.owner)).json()
  ).toEqual({ contracts: [], nextBefore: null });
  // Simulate a future internal amendment without republishing it.
  const client = await http.pool.connect(),
    next = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE contracts SET state='ChangesRequested' WHERE id=$1", [f.row.id]);
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,2,$3,'Internal revision','review-legal')",
      [next, f.row.id, { internal: 'Not published' }]
    );
    await client.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [f.row.id, next]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const visible = await (await customer(f)).json();
  expect(visible).toMatchObject({
    canAccept: false,
    version: { id: f.row.currentVersionId, content: f.row.currentVersion.content },
  });
  expect(JSON.stringify(visible)).not.toContain('Not published');
  expect((await customer(f, '/versions/' + next)).status).toBe(404);
});
it('stores server-owned publication and acceptance timestamps and scoped reviewer notices', async () => {
  const f = await fixture(),
    admin = await login(randomUUID());
  await http.pool.query('UPDATE users SET is_admin=true WHERE user_id=$1', [admin]);
  await action(f.row.id, 'submit', command(f.row.currentVersionId));
  const notices = (
    await http.pool.query(
      'SELECT profile_id FROM in_app_notifications WHERE recipient_user_id=$1',
      [admin]
    )
  ).rows;
  expect(notices).toEqual([{ profile_id: null }]);
  await http.pool.query(
    "INSERT INTO contract_publications(contract_id,version_id,published_by,published_at) VALUES($1,$2,'review-legal','1900-01-01')",
    [f.row.id, f.row.currentVersionId]
  );
  await http.pool.query(
    "INSERT INTO contract_acceptances(contract_id,version_id,accepted_by,accepted_at) VALUES($1,$2,$3,'1900-01-01')",
    [f.row.id, f.row.currentVersionId, f.owner]
  );
  const evidence = (
    await http.pool.query(
      'SELECT p.published_at,a.accepted_at FROM contract_publications p JOIN contract_acceptances a USING(version_id) WHERE p.contract_id=$1',
      [f.row.id]
    )
  ).rows[0];
  expect(evidence.published_at.getFullYear()).toBeGreaterThan(2020);
  expect(evidence.accepted_at.getTime()).toBeGreaterThanOrEqual(evidence.published_at.getTime());
});

it('paginates more than 100 published versions and contracts without duplicates or gaps', async () => {
  const f = await fixture();
  await publish(f);
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    for (let number = 2; number <= 101; number++) {
      const version = randomUUID();
      await client.query("UPDATE contracts SET state='ChangesRequested' WHERE id=$1", [f.row.id]);
      await client.query(
        "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,$3,$4,'Revision','review-legal')",
        [version, f.row.id, number, { revision: number }]
      );
      await client.query(
        "UPDATE contracts SET current_version_id=$2,state='AwaitingStaffReview' WHERE id=$1",
        [f.row.id, version]
      );
      await client.query(
        "INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,'review-legal')",
        [f.row.id, version]
      );
    }
    for (let number = 0; number < 100; number++) {
      const id = randomUUID(),
        version = randomUUID();
      await client.query(
        "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'savings',$3)",
        [id, f.profile, version]
      );
      await client.query(
        "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3,'Initial','review-legal')",
        [version, id, { item: number }]
      );
      await client.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [id]);
      await client.query(
        "INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,'review-legal')",
        [id, version]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const first = (await (await customer(f, '/versions')).json()) as {
    versions: Array<{ versionNumber: number }>;
    nextBefore: number;
  };
  expect(first.versions).toHaveLength(100);
  expect(first.nextBefore).toBe(2);
  const last = (await (
    await customer(f, '/versions?before=' + first.nextBefore)
  ).json()) as typeof first;
  expect(last.versions.map((v) => v.versionNumber)).toEqual([1]);
  expect(last.nextBefore).toBeNull();
  const page = (await (await send('contracts', 'GET', undefined, f.owner)).json()) as {
    contracts: Array<{ id: string }>;
    nextBefore: string;
  };
  expect(page.contracts).toHaveLength(100);
  const next = (await (
    await send('contracts?before=' + page.nextBefore, 'GET', undefined, f.owner)
  ).json()) as typeof page;
  expect(next.contracts).toHaveLength(1);
  expect(next.nextBefore).toBeNull();
  expect(new Set([...page.contracts, ...next.contracts].map((c) => c.id)).size).toBe(101);
});

it('revalidates the original contract profile before replaying an acceptance after access is removed', async () => {
  const f = await fixture();
  await publish(f);
  const legal = await login(randomUUID());
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Legal')",
    [f.profile, legal]
  );
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
    legal,
    f.profile,
  ]);
  const body = command(f.row.currentVersionId);
  expect((await send('contracts/' + f.row.id + '/accept', 'POST', body, legal)).status).toBe(200);
  const other = randomUUID();
  await http.pool.query('INSERT INTO profiles(id,user_id,is_default) VALUES($1,$2,true)', [
    other,
    legal,
  ]);
  await http.pool.query('UPDATE user_profile_contexts SET profile_id=$2 WHERE user_id=$1', [
    legal,
    other,
  ]);
  await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
    f.profile,
    legal,
  ]);
  expect((await send('contracts/' + f.row.id + '/accept', 'POST', body, legal)).status).toBe(404);
});

it('requires the current financial review and preserves the confirmed snapshot on acceptance retries', async () => {
  const f = await fixture();
  await publish(f);
  const path = `contracts/${f.row.id}/accept`;
  const preview = () => customer(f, `/acceptance-review?versionId=${f.row.currentVersionId}`);
  const initial = await preview();
  expect(initial.status).toBe(200);
  const review = (await initial.json()) as ContractFinancialReview;
  expect(review).toMatchObject({
    scope: { action: 'contract.acceptance', profileId: f.profile, resourceId: f.row.id },
    data: {
      contract: { versionId: f.row.currentVersionId, content: { price: '9007199254740993' } },
      payment: { source: 'none', amount: '0' },
      cancellationRefund: 'full_wallet',
    },
  });
  const missing = await fetch(`${http.base}/api/${path}`, {
    method: 'POST',
    headers: headers[f.owner]!,
    body: JSON.stringify(command(f.row.currentVersionId)),
  });
  expect(missing.status).toBe(400);
  expect(
    (
      await send(
        path,
        'POST',
        {
          ...command(f.row.currentVersionId),
          expectedReviewHash: '0'.repeat(64),
        },
        f.owner
      )
    ).status
  ).toBe(409);
  await http.pool.query('UPDATE profiles SET title=$2 WHERE id=$1', [
    f.profile,
    'Updated legal entity',
  ]);
  expect(
    (
      await send(
        path,
        'POST',
        {
          ...command(f.row.currentVersionId),
          expectedReviewHash: review.hash,
        },
        f.owner
      )
    ).status
  ).toBe(409);
  expect(
    (
      await http.pool.query('SELECT count(*) FROM contract_acceptances WHERE contract_id=$1', [
        f.row.id,
      ])
    ).rows[0].count
  ).toBe('0');
  const refreshed = (await (await preview()).json()) as ContractFinancialReview;
  expect(refreshed.hash).not.toBe(review.hash);
  const body = { ...command(f.row.currentVersionId), expectedReviewHash: refreshed.hash };
  const response = await send(path, 'POST', body, f.owner);
  expect(response.status).toBe(200);
  const accepted = (await response.json()) as { financialReview: ContractFinancialReview };
  expect(accepted.financialReview).toEqual(refreshed);
  const audit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='contract.accepted' AND metadata::jsonb->>'contractId'=$1",
      [f.row.id]
    )
  ).rows[0].metadata;
  expect(audit.financialReview).toEqual(refreshed);
  const retry = await send(path, 'POST', body, f.owner);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(accepted);
  expect(
    (await send(path, 'POST', { ...body, expectedReviewHash: review.hash }, f.owner)).status
  ).toBe(409);
});
it('allows review before step-up while keeping it scoped to the authorized customer', async () => {
  const f = await fixture(),
    other = await fixture();
  await publish(f);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE user_id=$1', [f.owner]);
  const suffix = `/acceptance-review?versionId=${f.row.currentVersionId}`;
  const response = await customer(f, suffix);
  expect(response.status).toBe(200);
  const review = (await response.json()) as ContractFinancialReview;
  expect((await customer(f, suffix, other.owner)).status).toBe(404);
  expect(
    (
      await send(
        `contracts/${f.row.id}/accept`,
        'POST',
        {
          ...command(f.row.currentVersionId),
          expectedReviewHash: review.hash,
        },
        f.owner
      )
    ).status
  ).toBe(403);
});
