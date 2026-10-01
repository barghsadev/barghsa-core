import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
});
const kinds = ['wallet', 'invoice'] as const;
type Kind = (typeof kinds)[number];
const permission = (kind: Kind) =>
  kind === 'wallet'
    ? 'admin:finance:wallet:bank-receipt-confirm'
    : 'admin:finance:invoices:bank-receipt-confirm';
const path = (kind: Kind) =>
  kind === 'wallet'
    ? '/api/admin/wallet/bank-receipt-top-ups'
    : '/api/admin/invoices/bank-receipts';
async function actor(grants: string[]) {
  const user = randomUUID(),
    session = randomUUID(),
    role = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$1,'fixture-only',true)",
    [user]
  );
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$1,'Receipt queue fixture',$2::jsonb)",
    [role, JSON.stringify(grants)]
  );
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [user, role]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$1,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [session, user]
  );
  return { user, session, role, headers: { Cookie: `barghsa_session=${session}` } };
}
async function owner() {
  const user = randomUUID(),
    profile = randomUUID(),
    invoice = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'fixture-only')",
    [user]
  );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,$2,'LEGAL','ACTIVE')",
    [profile, user]
  );
  await http.pool.query(
    'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES ($1,0,0)',
    [profile]
  );
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount) VALUES ($1,$2,'Unpaid',9223372036854775807)",
    [invoice, profile]
  );
  return { profile, invoice };
}
async function seed(
  kind: Kind,
  scope: Awaited<ReturnType<typeof owner>>,
  options: {
    bank: string;
    reference?: string;
    index?: number;
    state?: string;
    credit?: boolean;
    channel?: string;
  }
) {
  const id = randomUUID(),
    amount = '9007199254740993',
    index = options.index ?? 0;
  if (kind === 'wallet') {
    const metadata = {
      channel: options.channel ?? 'bank_receipt',
      receipt: {
        bankName: options.bank,
        payerReference: options.reference ?? 'Transfer',
        paymentDate: '2026-09-01',
        attachmentKey: `sealed/${id}`,
      },
      ...(options.credit ? { pendingTransactionId: randomUUID() } : {}),
    };
    await http.pool.query(
      `INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,receipt_attachment_key,metadata,created_at) VALUES ($1::uuid,$2,'topup',$3::bigint,$4,$1::text,$5,$6::jsonb,'2026-09-01T00:00:00Z'::timestamptz + ($7::int * interval '1 microsecond'))`,
      [
        id,
        scope.profile,
        amount,
        options.state ?? 'Pending',
        `sealed/${id}`,
        JSON.stringify(metadata),
        Math.floor(index / 3),
      ]
    );
  } else {
    await http.pool.query(
      `INSERT INTO bank_receipts(id,invoice_id,profile_id,amount,state,payment_date,payer_reference,bank_name,attachment_key,created_at,rejection_reason) VALUES ($1,$2,$3,$4::bigint,$5,'2026-09-01',$6,$7,$8,'2026-09-01T00:00:00Z'::timestamptz + ($9::int * interval '1 microsecond'),CASE WHEN $5='Rejected' THEN 'Mismatch' ELSE NULL END)`,
      [
        id,
        scope.invoice,
        scope.profile,
        amount,
        options.state ?? 'Submitted',
        options.reference ?? 'Transfer',
        options.bank,
        `sealed/${id}`,
        Math.floor(index / 3),
      ]
    );
  }
  return id;
}
async function read(
  kind: Kind,
  who: Awaited<ReturnType<typeof actor>>,
  query: Record<string, string> = {}
) {
  return fetch(`${http.base}${path(kind)}?${new URLSearchParams(query)}`, { headers: who.headers });
}
interface Page {
  items: { transactionId?: string; receiptId?: string; amount: string }[];
  nextCursor: { beforeAt: string; beforeId: string } | null;
}
async function page(response: Response): Promise<Page> {
  expect(response.status, http.logs()).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private');
  expect(response.headers.get('cache-control')).toContain('no-store');
  return (await response.json()) as Page;
}
const idOf = (row: Page['items'][number]) => row.transactionId ?? row.receiptId;
it.each(kinds)('pages bounded %s receipts in both orders at tied microseconds', async (kind) => {
  const who = await actor([permission(kind)]),
    scope = await owner(),
    bank = randomUUID();
  for (let index = 0; index < 61; index++) await seed(kind, scope, { bank, index });
  const table = kind === 'wallet' ? 'wallet_transactions' : 'bank_receipts';
  const rows = await http.pool.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE ${kind === 'wallet' ? 'wallet_id' : 'profile_id'}=$1 ORDER BY created_at ASC,id ASC`,
    [scope.profile]
  );
  const sorted = rows.rows.map((r) => r.id);
  for (const sort of ['submitted_at:asc', 'submitted_at:desc']) {
    let cursor: Page['nextCursor'] = null;
    const seen: Array<string | undefined> = [];
    let count = 0;
    do {
      const result = await page(await read(kind, who, { q: bank, sort, ...(cursor ?? {}) }));
      expect(result.items.length).toBeLessThanOrEqual(25);
      expect(result.items.every((r) => r.amount === '9007199254740993')).toBe(true);
      seen.push(...result.items.map(idOf));
      cursor = result.nextCursor;
      if (cursor) expect(cursor.beforeAt).toMatch(/\.\d{6}Z$/);
      expect(++count).toBeLessThan(5);
    } while (cursor);
    expect(seen).toEqual(sort.endsWith('asc') ? sorted : [...sorted].reverse());
    expect(new Set(seen).size).toBe(61);
  }
});
it.each(kinds)(
  'searches %s public identifiers and metadata literally while excluding completed receipts',
  async (kind) => {
    const who = await actor([permission(kind)]),
      scope = await owner(),
      token = randomUUID();
    const bank = `${token}_%\\بانک`,
      reference = `${token}-TRANSFER`;
    const first = await seed(kind, scope, { bank, reference });
    await seed(kind, scope, { bank: `${token}XYبانک` });
    await seed(kind, scope, { bank, state: kind === 'wallet' ? 'Released' : 'Rejected' });
    if (kind === 'wallet') {
      await seed(kind, scope, { bank, credit: true });
      await seed(kind, scope, { bank, channel: 'online' });
    } else await seed(kind, scope, { bank, state: 'UnderReview', reference: 'second-review' });
    for (const q of [bank, reference.toLowerCase(), first]) {
      const result = await page(await read(kind, who, { q }));
      expect(result.items.map(idOf)).toEqual(
        q === bank && kind === 'invoice' ? expect.arrayContaining([first]) : [first]
      );
      expect(result.items.length).toBe(q === bank && kind === 'invoice' ? 2 : 1);
    }
    const profileMatches = await page(await read(kind, who, { q: scope.profile }));
    expect(profileMatches.items.map(idOf)).toContain(first);
    if (kind === 'invoice')
      expect((await page(await read(kind, who, { q: scope.invoice }))).items).toHaveLength(3);
    expect((await page(await read(kind, who, { q: randomUUID() }))).items).toEqual([]);
  }
);
it.each(kinds)(
  'enforces live %s queue permission and rejects malformed query input',
  async (kind) => {
    const allowed = await actor([permission(kind)]),
      denied = await actor([permission(kind === 'wallet' ? 'invoice' : 'wallet')]);
    expect((await read(kind, denied, { q: 'x' })).status).toBe(403);
    expect((await fetch(`${http.base}${path(kind)}`)).status).toBe(401);
    for (const query of [
      { q: 'x'.repeat(121) },
      { q: 'bank\nname' },
      { sort: 'amount:asc' },
      { beforeId: randomUUID() },
      { beforeAt: 'bad', beforeId: randomUUID() },
      { unknown: 'private' },
    ])
      expect((await read(kind, allowed, query)).status).toBe(400);
    const duplicate = await fetch(`${http.base}${path(kind)}?q=one&q=two`, {
      headers: allowed.headers,
    });
    expect(duplicate.status).toBe(400);
    await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [allowed.user]);
    expect((await read(kind, allowed)).status).toBe(403);
  }
);
