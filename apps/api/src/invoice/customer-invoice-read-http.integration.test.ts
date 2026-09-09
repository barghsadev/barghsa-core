import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Missing PostgreSQL');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function fixture(agent = false) {
  const owner = randomUUID(),
    user = agent ? randomUUID() : owner,
    profile = randomUUID(),
    invoice = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  for (const id of new Set([owner, user]))
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'test-only')",
      [id]
    );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,is_default) VALUES ($1,$2,'LEGAL',true)",
    [profile, owner]
  );
  if (agent) {
    await http.pool.query(
      "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Finance')",
      [profile, user]
    );
    await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ($1,$2)', [
      user,
      profile,
    ]);
  }
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [session, user, csrf, randomUUID()]
  );
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,issued_at,payable_from) VALUES ($1,$2,'Unpaid',1000,NOW(),NOW())",
    [invoice, profile]
  );
  await http.pool.query(
    "INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,vat_rate,vat_amount,is_taxable,position) VALUES ($1,$2,'Private usage',1,1000,1000,0,0,false,0)",
    [randomUUID(), invoice]
  );
  return {
    owner,
    user,
    profile,
    invoice,
    session,
    headers: { Cookie: `barghsa_session=${session}` },
  };
}
function read(f: Awaited<ReturnType<typeof fixture>>, detail = true, id: string = f.invoice) {
  return fetch(`${http.base}/api/invoices${detail ? '/' + id : ''}`, { headers: f.headers });
}

it('returns the same invoice for a valid uppercase UUID', async () => {
  const f = await fixture();
  const response = await read(f, true, f.invoice.toUpperCase());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    viewedInvoiceId: f.invoice,
    originalInvoiceId: f.invoice,
  });
});
it.each([false, true])(
  'denies expired session after waiting to read (details=%s)',
  async (detail) => {
    const f = await fixture(),
      blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE invoices IN ACCESS EXCLUSIVE MODE');
      await http.pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
        [f.session]
      );
      pending = read(f, detail);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM invoices%' "
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1',
                [f.session]
              )
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(401);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);
it('isolates profiles and excludes draft corrections while showing linked charge/credit explanations', async () => {
  const f = await fixture(),
    foreign = await fixture();
  expect((await read(f, true, foreign.invoice)).status).toBe(404);
  const charge = randomUUID(),
    credit = randomUUID(),
    draft = randomUUID();
  for (const [id, kind, state, reason] of [
    [charge, 'charge', 'Unpaid', 'Additional usage'],
    [credit, 'credit', 'Unpaid', 'Usage credit'],
    [draft, 'charge', 'Draft', 'Hidden draft'],
  ]) {
    await http.pool.query(
      `INSERT INTO invoices(id,profile_id,state,total_amount,adjustment_for_invoice_id,adjustment_kind,metadata,issued_at)
      VALUES ($1,$2,$3,100,$4,$5,$6::jsonb,NOW())`,
      [id, f.profile, state, f.invoice, kind, JSON.stringify({ reason })]
    );
  }
  const details = await read(f, true, credit);
  expect(details.status).toBe(200);
  const body = (await details.json()) as {
    chain: Array<{
      invoiceId: string;
      explanation: string | null;
      accountingAmount: string | null;
    }>;
  };
  expect(body.chain.map((i) => i.invoiceId).sort()).toEqual([f.invoice, charge, credit].sort());
  expect(body.chain.find((i) => i.invoiceId === charge)).toMatchObject({
    explanation: 'Additional usage',
    accountingAmount: '100',
  });
  expect(body.chain.find((i) => i.invoiceId === credit)).toMatchObject({
    explanation: 'Usage credit',
    accountingAmount: '-100',
  });
  expect((await read(f, true, draft)).status).toBe(404);
});
it('permits current Finance agents and denies removed membership, stale Owner, archived profiles and activation-pending accounts', async () => {
  const f = await fixture(true);
  expect((await read(f)).status).toBe(200);
  await http.pool.query(
    "UPDATE profile_agents SET role='Owner' WHERE profile_id=$1 AND user_id=$2",
    [f.profile, f.user]
  );
  expect((await read(f)).status).toBe(404);
  await http.pool.query(
    "UPDATE profile_agents SET role='Finance' WHERE profile_id=$1 AND user_id=$2",
    [f.profile, f.user]
  );
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await read(f)).status).toBe(404);
  await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [f.profile]);
  await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
    f.profile,
    f.user,
  ]);
  expect((await read(f)).status).toBe(404);
  const owner = await fixture();
  await http.pool.query("UPDATE users SET activation_token='pending' WHERE user_id=$1", [
    owner.user,
  ]);
  expect((await read(owner)).status).toBe(401);
});

it('holds agent view permission until the read completes, then applies revocation', async () => {
  const f = await fixture(true),
    blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined, removal: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE invoices IN ACCESS EXCLUSIVE MODE');
    pending = read(f);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM invoices%' "
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    removal = http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
      f.profile,
      f.user,
    ]);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'DELETE FROM profile_agents%' "
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(200);
    await removal;
    expect((await read(f)).status).toBe(404);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
    await removal;
  }
});
