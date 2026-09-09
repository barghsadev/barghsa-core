import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { WalletService } from '../wallet/wallet.service.js';
import { PayInvoiceWithWalletService } from '../wallet/pay-invoice-with-wallet.service.js';
import { BankReceiptConfirmationService } from '../wallet/bank-receipt-confirmation.service.js';
import { InvoiceBankReceiptConfirmationService } from '../invoice/invoice-bank-receipt-confirmation.service.js';
import { bankReceiptTopUpMetadata } from '@barghsa/shared/finance';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
const wallet = new WalletService();
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  holder.pool = http.pool;
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('archive-wallet-staff','wallet-staff','fixture',true),('archive-wallet-owner','wallet-owner','fixture',false)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'archive-wallet-staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: 'barghsa_session=' + session,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterAll(async () => {
  holder.pool = null;
  await http?.close();
});

type Kind = 'credit' | 'debit' | 'reserve' | 'release' | 'reverse' | 'delta' | 'create';

async function payment(kind: 'wallet-receipt' | 'invoice-receipt' | 'pay') {
  const f = await setup('credit'),
    invoiceId = randomUUID(),
    receiptId = randomUUID();
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES ($1,$2,'Unpaid',100,0)",
    [invoiceId, f.id]
  );
  const key = 'receipts/' + receiptId + '.pdf';
  if (kind === 'wallet-receipt') {
    await http.pool.query(
      "INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,metadata,receipt_attachment_key) VALUES ($1,$2,'topup',100,'Pending',$1::uuid::text,$3::jsonb,$4)",
      [
        receiptId,
        f.id,
        JSON.stringify(
          bankReceiptTopUpMetadata({
            paymentDate: '2026-09-08',
            payerReference: receiptId,
            attachmentKey: key,
            customerNote: null,
          })
        ),
        key,
      ]
    );
  } else if (kind === 'invoice-receipt') {
    await http.pool.query(
      "INSERT INTO bank_receipts(id,invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key,state) VALUES ($1,$2,$3,100,'2026-09-08',$1::uuid::text,$4,'Submitted')",
      [receiptId, invoiceId, f.id, key]
    );
  }
  const confirm = () =>
    kind === 'pay'
      ? new PayInvoiceWithWalletService(wallet).payInvoiceWithWallet(invoiceId, f.id, receiptId)
      : kind === 'wallet-receipt'
        ? new BankReceiptConfirmationService(wallet).confirm({
            transactionId: receiptId,
            actorUserId: 'archive-wallet-staff',
            sessionId: headers.Cookie!.split('=')[1]!,
            csrfToken: headers['X-CSRF-Token']!,
            ip: '127.0.0.1',
          })
        : new InvoiceBankReceiptConfirmationService(wallet).confirm({
            receiptId,
            actorUserId: 'archive-wallet-staff',
            sessionId: headers.Cookie!.split('=')[1]!,
            csrfToken: headers['X-CSRF-Token']!,
            ip: '127.0.0.1',
          });
  return { ...f, confirm, receiptId, invoiceId };
}
for (const kind of ['wallet-receipt', 'invoice-receipt', 'pay'] as const) {
  it(kind + ' waits for the profile before holding staff or financial rows', async () => {
    const f = await payment(kind),
      before = await f.snapshot(),
      lock = await http.pool.connect();
    let confirming: Promise<unknown> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query('UPDATE profiles SET archived=true WHERE id=$1', [f.id]);
      confirming = f.confirm().catch((e: unknown) => e);
      await waiting('SELECT id, archived FROM profiles');
      await lock.query(
        "SELECT user_id FROM users WHERE user_id='archive-wallet-staff' FOR UPDATE NOWAIT"
      );
      await lock.query('SELECT profile_id FROM wallets WHERE profile_id=$1 FOR UPDATE NOWAIT', [
        f.id,
      ]);
      await lock.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE NOWAIT', [f.invoiceId]);
      if (kind === 'wallet-receipt')
        await lock.query('SELECT id FROM wallet_transactions WHERE id=$1 FOR UPDATE NOWAIT', [
          f.receiptId,
        ]);
      if (kind === 'invoice-receipt')
        await lock.query('SELECT id FROM bank_receipts WHERE id=$1 FOR UPDATE NOWAIT', [
          f.receiptId,
        ]);
      await lock.query('COMMIT');
      expect(await confirming).toMatchObject({ status: 409 });
      expect(await f.snapshot()).toEqual(before);
      expect(
        (await http.pool.query('SELECT paid_amount,state FROM invoices WHERE id=$1', [f.invoiceId]))
          .rows[0]
      ).toMatchObject({ paid_amount: '0', state: 'Unpaid' });
      expect(
        (
          await http.pool.query(
            'SELECT idempotency_key FROM idempotency_keys WHERE idempotency_key=$1',
            [f.receiptId]
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await confirming;
    }
  });
}

async function setup(kind: Kind) {
  const id = randomUUID(),
    tx = randomUUID(),
    key = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,status) VALUES ($1,'archive-wallet-owner','ACTIVE')",
    [id]
  );
  if (kind !== 'create') {
    await http.pool.query(
      'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES ($1,$2,$3)',
      [id, ['credit', 'delta'].includes(kind) ? 0 : 100, kind === 'release' ? 100 : 0]
    );
  }
  if (kind === 'release' || kind === 'reverse') {
    await http.pool.query(
      'INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key) VALUES ($1,$2,$3,100,$4,$5)',
      [
        tx,
        id,
        kind === 'release' ? 'reservation' : 'topup',
        kind === 'release' ? 'Reserved' : 'Completed',
        randomUUID(),
      ]
    );
  }
  // Uppercase inputs exercise PostgreSQL's canonical UUID ownership checks.
  const write = (): Promise<unknown> => {
    const input = id.toUpperCase();
    switch (kind) {
      case 'credit':
        return wallet.credit(input, 100n, { type: 'topup' }, key);
      case 'debit':
        return wallet.debit(input, 100n, { type: 'payment' }, key);
      case 'reserve':
        return wallet.reserve(input, 100n, key);
      case 'release':
        return wallet.release(tx.toUpperCase());
      case 'reverse':
        return wallet.reverseTransaction(tx.toUpperCase(), 'Correction', key);
      case 'delta':
        return wallet.applyPostedBalanceDelta(input, 100n, 0);
      case 'create':
        return wallet.createWallet(input);
    }
  };
  const archive = () =>
    fetch(http.base + '/api/crm/profiles/' + id, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ reason: 'Closure requested' }),
      signal: AbortSignal.timeout(10000),
    });
  const snapshot = async () => ({
    wallet: (await http.pool.query('SELECT * FROM wallets WHERE profile_id=$1', [id])).rows,
    ledger: (
      await http.pool.query('SELECT * FROM wallet_transactions WHERE wallet_id=$1 ORDER BY id', [
        id,
      ])
    ).rows,
  });
  return { id, tx, write, archive, snapshot };
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
for (const kind of [
  'credit',
  'debit',
  'reserve',
  'release',
  'reverse',
  'delta',
  'create',
] as const) {
  it(
    'rejects new ' + kind + ' changes after archival with no ledger or balance mutation',
    async () => {
      const f = await setup(kind),
        before = await f.snapshot();
      await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.id]);
      await expect(f.write()).rejects.toMatchObject({ status: kind === 'create' ? 404 : 409 });
      expect(await f.snapshot()).toEqual(before);
    }
  );
  it(kind + ' rechecks archival after waiting for the profile lock', async () => {
    const f = await setup(kind),
      before = await f.snapshot(),
      lock = await http.pool.connect();
    let writing: Promise<unknown> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query('UPDATE profiles SET archived=true WHERE id=$1', [f.id]);
      writing = f.write().catch((e: unknown) => e);
      await waiting(
        kind === 'delta' || kind === 'create'
          ? 'WITH active_profile'
          : 'SELECT id, archived FROM profiles'
      );
      await lock.query('COMMIT');
      expect(await writing).toMatchObject({ status: kind === 'create' ? 404 : 409 });
      expect(await f.snapshot()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await writing;
    }
  });
  if (kind !== 'create')
    it('archive waits for ' + kind + ' to finish before checking balances', async () => {
      const f = await setup(kind),
        lock = await http.pool.connect();
      let writing: Promise<unknown> | undefined, archiving: Promise<Response> | undefined;
      try {
        await lock.query('BEGIN');
        await lock.query('SELECT profile_id FROM wallets WHERE profile_id=$1 FOR UPDATE', [f.id]);
        writing = f.write();
        await waiting(
          kind === 'delta'
            ? 'UPDATE wallets'
            : 'SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE'
        );
        archiving = f.archive();
        await waiting('SELECT id,user_id,profile_type,status,archived FROM profiles');
        await lock.query('COMMIT');
        await writing;
        expect((await archiving).status, http.logs()).toBe(
          kind === 'debit' || kind === 'reverse' ? 200 : 409
        );
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await writing;
        await archiving;
      }
    });
  if (kind !== 'delta')
    it('returns the existing ' + kind + ' result after archival without rewriting it', async () => {
      const f = await setup(kind),
        first = await f.write(),
        before = await f.snapshot();
      await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.id]);
      expect(await f.write()).toEqual(first);
      expect(await f.snapshot()).toEqual(before);
    });
}
for (const kind of ['credit', 'delta', 'create'] as const)
  it('a queued real archive wins before ' + kind + ' without deadlock', async () => {
    const f = await setup(kind),
      before = await f.snapshot(),
      lock = await http.pool.connect();
    let writing: Promise<unknown> | undefined, archiving: Promise<Response> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.id]);
      archiving = f.archive();
      await waiting('SELECT id,user_id,profile_type,status,archived FROM profiles');
      writing = f.write().catch((e: unknown) => e);
      await waiting(
        kind === 'credit' ? 'SELECT id, archived FROM profiles' : 'WITH active_profile'
      );
      await lock.query('COMMIT');
      expect((await archiving).status, http.logs()).toBe(200);
      expect(await writing).toMatchObject({ status: kind === 'create' ? 404 : 409 });
      expect(await f.snapshot()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await writing;
      await archiving;
    }
  });
for (const [posted, reserved] of [
  [1, 0],
  [-1, -1],
  [100, 1],
  [0, -1],
  [100, 100],
  [0, 0],
])
  it(
    'archive checks posted ' + posted + ' and reserved ' + reserved + ' independently',
    async () => {
      const f = await setup('credit');
      await http.pool.query(
        'UPDATE wallets SET posted_balance=$2,reserved_balance=$3 WHERE profile_id=$1',
        [f.id, posted, reserved]
      );
      const result = await f.archive();
      expect(result.status, http.logs()).toBe(posted === 0 && reserved === 0 ? 200 : 409);
    }
  );
