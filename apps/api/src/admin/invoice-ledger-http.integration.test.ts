import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const profileId = randomUUID();
const invoiceId = randomUUID();
const draftId = randomUUID();
const financeSession = randomUUID();
const otherSession = randomUUID();

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES
    ('ledger-finance','ledger-finance@example.test','test-only',true),
    ('ledger-other','ledger-other@example.test','test-only',true),
    ('ledger-customer','ledger-customer@example.test','test-only',false)`);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('ledger-finance','role-finance')"
  );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,is_default) VALUES ($1,'ledger-customer',true)",
    [profileId]
  );
  await http.pool.query(
    `INSERT INTO invoices(id,profile_id,type,state,total_amount,issued_at,due_at)
     VALUES ($1,$3,'manual','Unpaid',109000,'2026-09-01T00:00:00Z','2026-10-01T00:00:00Z'),
            ($2,$3,'manual','Draft',200000,NULL,NULL)`,
    [invoiceId, draftId, profileId]
  );
  await http.pool.query(
    `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,vat_rate,vat_amount,position)
     VALUES ($1,$2,'Electricity',1,100000,100000,900,9000,0)`,
    [randomUUID(), invoiceId]
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'ledger-finance',$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes'),
            ($2,'ledger-other',$5,$6,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [financeSession, otherSession, randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  );
}, 40_000);
afterAll(async () => {
  await http?.close();
});

const get = (path: string, session = financeSession) =>
  fetch(`${http.base}/api/admin/invoices/ledger${path}`, {
    headers: { Cookie: `barghsa_session=${session}` },
  });

it('lets finance staff filter and inspect real invoice lines while hiding the ledger from other staff', async () => {
  expect((await get('')).status).toBe(200);
  const listResponse = await get('?state=Unpaid');
  const list = await listResponse.json();
  expect(list.items).toEqual([
    expect.objectContaining({ invoiceId, totalAmount: '109000', state: 'Unpaid' }),
  ]);
  expect(list.nextCursor).toBeNull();
  const detailResponse = await get(`/${invoiceId}`);
  expect(detailResponse.status).toBe(200);
  expect(await detailResponse.json()).toMatchObject({
    invoiceId,
    profileId,
    lines: [{ description: 'Electricity', lineTotal: '100000', vatAmount: '9000' }],
    activity: { payments: [], bankReceipts: [], refunds: [] },
  });
  expect((await get(`/${invoiceId}`, otherSession)).status).toBe(403);
  expect((await get('?state=invalid')).status).toBe(400);
  expect((await get(`/${randomUUID()}`)).status).toBe(404);
  expect((await get(`?invoiceId=${draftId}`)).status).toBe(200);
});

it('does not skip invoices whose creation timestamps share the same millisecond', async () => {
  const ids = Array.from({ length: 26 }, () => randomUUID());
  for (const id of ids) {
    await http.pool.query(
      `INSERT INTO invoices(id,profile_id,type,state,total_amount,paid_amount,issued_at,created_at)
       VALUES ($1,$2,'manual','Paid',100,100,'2026-09-01T00:00:00Z','2026-09-01T00:00:00.123456Z')`,
      [id, profileId]
    );
  }
  const first = await (await get('?state=Paid')).json();
  expect(first.items).toHaveLength(25);
  expect(first.nextCursor.beforeAt).toBe('2026-09-01T00:00:00.123456Z');
  const query = new URLSearchParams({ state: 'Paid', ...first.nextCursor });
  const second = await (await get(`?${query}`)).json();
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(
    new Set([...first.items, ...second.items].map((row: { invoiceId: string }) => row.invoiceId))
  ).toEqual(new Set(ids));
});
