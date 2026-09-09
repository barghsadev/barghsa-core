import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { ManualInvoiceService } from '../invoice/manual-invoice.service.js';
import { AutoInvoiceService } from '../invoice/auto-invoice.service.js';
import { CancelAndReplaceInvoiceService } from '../invoice/cancel-and-replace-invoice.service.js';
import { CreateAdjustmentInvoiceService } from '../invoice/create-adjustment-invoice.service.js';
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { InvoiceAuditRepository } from '../invoice/invoice-audit.repository.js';
import { DueAtCalculationService } from '../invoice/due-at.service.js';
import { DueAtCalculationRepository } from '../invoice/due-at.repository.js';
import { VatCalculationService } from '../invoice/vat-calculation.service.js';
import { VatCalculationRepository } from '../invoice/vat-calculation.repository.js';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>,
  manual: ManualInvoiceService,
  auto: AutoInvoiceService,
  replace: CancelAndReplaceInvoiceService,
  adjust: CreateAdjustmentInvoiceService;
const actor = 'archive-invoice-staff';
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  holder.pool = http.pool;
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$1,'fixture',true),('archive-invoice-operator','archive-operator@example.test','fixture',true),('archive-invoice-owner','owner@example.test','fixture',false)",
    [actor]
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, 'archive-invoice-operator', csrf, randomUUID()]
  );
  headers = {
    Cookie: 'barghsa_session=' + session,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const state = new InvoiceStateMachineService(new InvoiceAuditRepository());
  const due = new DueAtCalculationService(new DueAtCalculationRepository());
  manual = new ManualInvoiceService(state, due);
  auto = new AutoInvoiceService(
    state,
    new VatCalculationService(new VatCalculationRepository()),
    due
  );
  replace = new CancelAndReplaceInvoiceService(state, due);
  adjust = new CreateAdjustmentInvoiceService(state, due);
}, 40000);
afterAll(async () => {
  holder.pool = null;
  await http?.close();
});
type Kind = 'manual' | 'auto' | 'replace' | 'charge' | 'credit';
async function setup(kind: Kind) {
  const profileId = randomUUID(),
    sourceId = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,status) VALUES ($1,'archive-invoice-owner','ACTIVE')",
    [profileId]
  );
  if (kind === 'auto') {
    const product = (
      await http.pool.query(
        'INSERT INTO products(type,title,price) VALUES (\'electricity\',\'{"en":"Fixture"}\',100000) RETURNING id'
      )
    ).rows[0].id;
    await http.pool.query(
      "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES ($1,'archive-invoice-owner',$2,$3,'electricity','province','city','Fixture street','1234567890')",
      [sourceId, profileId, product]
    );
  } else if (kind !== 'manual') {
    await http.pool.query(
      "INSERT INTO invoices(id,profile_id,type,state,total_amount,paid_amount) VALUES ($1,$2,'manual',$3,100000,$4)",
      [sourceId, profileId, kind === 'replace' ? 'Unpaid' : 'Paid', kind === 'replace' ? 0 : 100000]
    );
  }
  const lines = [{ description: 'New invoice', quantity: 1, unitPrice: 10000n, vatRate: 0 }];
  const create = () =>
    kind === 'manual'
      ? manual.createManualInvoice({ profileId, actorUserId: actor, lines })
      : kind === 'auto'
        ? auto.createInvoiceForOrder({
            orderId: sourceId,
            actorUserId: actor,
            vatRateBasisPoints: 0,
          })
        : kind === 'replace'
          ? replace.cancelAndReplaceInvoice({
              invoiceId: sourceId,
              actorUserId: actor,
              newLines: lines,
              reason: 'Correction',
            })
          : adjust.createAdjustmentInvoice({
              originalInvoiceId: sourceId,
              actorUserId: actor,
              amount: kind === 'charge' ? 10000n : -10000n,
              reason: 'Correction',
            });
  const archive = () =>
    fetch(http.base + '/api/crm/profiles/' + profileId, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ reason: 'Closure requested' }),
      signal: AbortSignal.timeout(10000),
    });
  const snapshot = async () => ({
    invoices: (
      await http.pool.query(
        'SELECT id,state,total_amount,paid_amount,metadata FROM invoices WHERE profile_id=$1 ORDER BY id',
        [profileId]
      )
    ).rows,
    lines: (
      await http.pool.query(
        'SELECT * FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE profile_id=$1) ORDER BY id',
        [profileId]
      )
    ).rows,
    audits: (
      await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'invoice.%' ORDER BY id")
    ).rows,
  });
  return { profileId, sourceId, create, archive, snapshot };
}
async function waiting(fragment: string) {
  await expect
    .poll(
      async () =>
        (
          await http.pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1) AS waiting",
            ['%' + fragment + '%']
          )
        ).rows[0].waiting
    )
    .toBe(true);
}
for (const kind of ['manual', 'auto', 'replace', 'charge', 'credit'] as const) {
  it('rejects ' + kind + ' invoices on an archived profile without side effects', async () => {
    const f = await setup(kind),
      before = await f.snapshot();
    await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profileId]);
    await expect(f.create()).rejects.toMatchObject({ status: 409 });
    expect(await f.snapshot()).toEqual(before);
  });
  it(kind + ' creation rechecks archival after waiting for the profile lock', async () => {
    const f = await setup(kind),
      before = await f.snapshot(),
      lock = await http.pool.connect();
    let creating: Promise<unknown> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profileId]);
      creating = f.create().then(
        (value) => value,
        (error) => error
      );
      await waiting('SELECT id, archived FROM profiles');
      await lock.query('COMMIT');
      expect(await creating).toMatchObject({ status: 409 });
      expect(await f.snapshot()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await creating;
    }
  });
  it('archive waits for ' + kind + ' creation holding the profile lock', async () => {
    const f = await setup(kind),
      lock = await http.pool.connect();
    let creating: Promise<unknown> | undefined, archiving: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      if (kind === 'auto')
        await lock.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [f.sourceId]);
      else await lock.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [actor]);
      creating = f.create();
      await waiting(
        kind === 'auto' ? 'FROM orders WHERE id = $1 FOR UPDATE' : 'activation_pending'
      );
      archiving = f.archive();
      await waiting('SELECT id,user_id,profile_type,status,archived FROM profiles');
      await lock.query('COMMIT');
      const result = await creating;
      expect(result).toHaveProperty(
        kind === 'replace'
          ? 'replacementInvoiceId'
          : kind === 'charge' || kind === 'credit'
            ? 'adjustmentInvoiceId'
            : 'invoiceId'
      );
      expect((await archiving).status, http.logs()).toBe(kind === 'credit' ? 200 : 409);
      expect(
        (await http.pool.query('SELECT archived FROM profiles WHERE id=$1', [f.profileId])).rows[0]
          .archived
      ).toBe(kind === 'credit');
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await creating;
      await archiving;
    }
  });
}
for (const kind of ['manual', 'charge', 'credit'] as const)
  it('a queued real archive wins before ' + kind + ' creation without deadlock', async () => {
    const f = await setup(kind),
      before = await f.snapshot(),
      lock = await http.pool.connect();
    let creating: Promise<unknown> | undefined, archiving: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profileId]);
      archiving = f.archive();
      await waiting('SELECT id,user_id,profile_type,status,archived FROM profiles');
      creating = f.create().then(
        (value) => value,
        (error) => error
      );
      await waiting('SELECT id, archived FROM profiles');
      await lock.query('COMMIT');
      expect((await archiving).status, http.logs()).toBe(200);
      expect(await creating).toMatchObject({ status: 409 });
      expect(await f.snapshot()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await creating;
      await archiving;
    }
  });

for (const [state, blocked] of [
  ['Draft', true],
  ['Unpaid', true],
  ['PaymentUnderReview', true],
  ['PartiallyFunded', true],
  ['Overdue', true],
  ['Paid', false],
  ['Cancelled', false],
  ['PartiallyRefunded', false],
  ['Refunded', false],
] as const) {
  it('archive applies the unpaid-invoice constraint to ' + state, async () => {
    const f = await setup('manual');
    const invoiceId = randomUUID();
    await http.pool.query(
      "INSERT INTO invoices(id,profile_id,type,state,total_amount,paid_amount,refunded_amount) VALUES ($1,$2,'manual',$3,100000,$4,$5)",
      [
        invoiceId,
        f.profileId,
        state,
        state === 'PartiallyFunded'
          ? 50000
          : ['Paid', 'PartiallyRefunded', 'Refunded'].includes(state)
            ? 100000
            : 0,
        state === 'Refunded' ? 100000 : state === 'PartiallyRefunded' ? 50000 : 0,
      ]
    );
    const before = await f.snapshot();
    const response = await f.archive();
    expect(response.status, http.logs()).toBe(blocked ? 409 : 200);
    if (blocked)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'CRM:PROFILE:DELETION_BLOCKED',
          message: expect.stringContaining('unpaid invoice'),
        },
      });
    expect(await f.snapshot()).toEqual(before);
    expect(
      (await http.pool.query('SELECT archived FROM profiles WHERE id=$1', [f.profileId])).rows[0]
        .archived
    ).toBe(!blocked);
  });
}
it('an issued credit note does not hide another unpaid invoice', async () => {
  const f = await setup('credit');
  await f.create();
  await http.pool.query(
    "INSERT INTO invoices(profile_id,type,state,total_amount) VALUES ($1,'manual','Unpaid',10000)",
    [f.profileId]
  );
  expect((await f.archive()).status).toBe(409);
});
