import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { type StorageProvider } from '@barghsa/shared/storage';
import { BANK_RECEIPT_STORAGE_PURPOSE } from '@barghsa/shared/finance';
import { WalletService } from '../wallet/wallet.service.js';
import { BankReceiptTopUpService } from '../wallet/bank-receipt-topup.service.js';
import { InvoiceBankReceiptUploadService } from '../invoice/invoice-bank-receipt-upload.service.js';
import { CustomerInvoiceDetailsService } from '../invoice/customer-invoice-details.service.js';
import { bankReceiptAttachmentAdvisoryLockKeys } from './claim-bank-receipt-attachment.js';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => holder.pool!,
}));
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
const objects = new Map<string, Uint8Array>();
const storage: StorageProvider = {
  async getObject(key) {
    const bytes = objects.get(key)!;
    return {
      body: new ReadableStream({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
      contentType: 'application/pdf',
      contentLength: bytes.byteLength,
      metadata: {},
      etag: undefined,
    };
  },
  async putObject(key, body) {
    if (body instanceof Uint8Array) objects.set(key, body);
  },
  async deleteObject() {},
  async presignedPutUrl() {
    return '';
  },
  async presignedGetUrl() {
    return '';
  },
  async listObjects() {
    return { items: [], isTruncated: false, continuationToken: undefined };
  },
};
beforeAll(async () => {
  db = await createMigratedTestDb();
  holder.pool = db.pool;
}, 60000);
afterAll(async () => {
  holder.pool = null;
  await db?.close();
});

async function seed() {
  const userId = randomUUID(),
    owner = randomUUID(),
    profileId = randomUUID();
  const sessionId = randomUUID(),
    csrfToken = randomUUID(),
    invoiceId = randomUUID();
  const attachmentKey = `uploads/document/${randomUUID()}.pdf`;
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'test-only'),($2,$2,'test-only')",
    [userId, owner]
  );
  await db.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,$2,'LEGAL','ACTIVE')",
    [profileId, owner]
  );
  await db.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Finance')",
    [profileId, userId]
  );
  await db.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ($1,$2)', [
    userId,
    profileId,
  ]);
  await db.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [sessionId, userId, csrfToken, randomUUID()]
  );
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount) VALUES ($1,$2,'Unpaid',1000)",
    [invoiceId, profileId]
  );
  const bytes = new Uint8Array(4096);
  bytes.set(new TextEncoder().encode('%PDF-1.4\n'));
  objects.set(attachmentKey, bytes);
  await db.pool.query(
    "INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name) VALUES ($1,'active',$2,4096,'application/pdf','document','receipt.pdf')",
    [
      attachmentKey,
      JSON.stringify({
        verified: true,
        uploadedBy: userId,
        profileId,
        purpose: BANK_RECEIPT_STORAGE_PURPOSE,
      }),
    ]
  );
  return {
    userId,
    actorId: userId,
    profileId,
    sessionId,
    csrfToken,
    invoiceId,
    attachmentKey,
    idempotencyKey: randomUUID(),
    amount: '1000',
    paymentDate: '2026-09-01',
    payerReference: 'deposit',
    correlationId: randomUUID(),
  };
}
type Submission = Awaited<ReturnType<typeof seed>>;
function submit(flow: 'wallet' | 'invoice', input: Submission) {
  return flow === 'wallet'
    ? new BankReceiptTopUpService(new WalletService()).submit(input)
    : new InvoiceBankReceiptUploadService(new CustomerInvoiceDetailsService(), storage).submit(
        input
      );
}
async function unchanged(input: Submission) {
  expect(
    (
      await db.pool.query('SELECT id FROM wallet_transactions WHERE wallet_id=$1', [
        input.profileId,
      ])
    ).rows
  ).toEqual([]);
  expect(
    (await db.pool.query('SELECT id FROM bank_receipts WHERE profile_id=$1', [input.profileId]))
      .rows
  ).toEqual([]);
  expect(
    (await db.pool.query('SELECT profile_id FROM wallets WHERE profile_id=$1', [input.profileId]))
      .rows
  ).toEqual([]);
  expect(
    (
      await db.pool.query('SELECT status FROM storage_records WHERE storage_key=$1', [
        input.attachmentKey,
      ])
    ).rows
  ).toEqual([{ status: 'active' }]);
  expect(
    (
      await db.pool.query(
        'SELECT storage_key FROM bank_receipt_attachment_claims WHERE storage_key=$1',
        [input.attachmentKey]
      )
    ).rows
  ).toEqual([]);
}

for (const flow of ['wallet', 'invoice'] as const) {
  it(`${flow} denies Manager, Legal and stale Owner roles but accepts additive Finance permission`, async () => {
    const input = await seed();
    for (const role of ['Manager', 'Legal', 'Owner']) {
      await db.pool.query('UPDATE profile_agents SET role=$3 WHERE profile_id=$1 AND user_id=$2', [
        input.profileId,
        input.userId,
        role,
      ]);
      await expect(submit(flow, input)).rejects.toMatchObject({ status: 404 });
      await unchanged(input);
    }
    await db.pool.query(
      "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Finance')",
      [input.profileId, input.userId]
    );
    await expect(submit(flow, input)).resolves.toMatchObject({
      state: flow === 'wallet' ? 'Pending' : 'Submitted',
    });
  });

  it(`${flow} rolls back receipt and attachment protection when the audit cannot persist`, async () => {
    const input = await seed();
    await db.pool.query('ALTER TABLE audit_log RENAME TO unavailable_receipt_audit');
    try {
      await expect(submit(flow, input)).rejects.toMatchObject({ code: '42P01' });
      await unchanged(input);
    } finally {
      await db.pool.query('ALTER TABLE unavailable_receipt_audit RENAME TO audit_log');
    }
  });

  for (const change of ['revoke', 'csrf', 'role', 'disabled', 'archive'] as const) {
    it(`${flow} submission rejects ${change} after waiting for its attachment`, async () => {
      const input = await seed(),
        lock = await db.pool.connect();
      const keys = bankReceiptAttachmentAdvisoryLockKeys(input.attachmentKey);
      let outcome: Promise<unknown> | undefined;
      try {
        await lock.query('SELECT pg_advisory_lock($1,$2)', keys);
        outcome = submit(flow, input).then(
          (value) => ({ value }),
          (error) => ({ error })
        );
        await expect
          .poll(async () =>
            Number(
              (
                await db.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_lock%'"
                )
              ).rows[0].count
            )
          )
          .toBe(1);
        if (change === 'revoke')
          await db.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
            input.sessionId,
          ]);
        if (change === 'csrf')
          await db.pool.query('UPDATE sessions SET csrf_token=$2 WHERE session_id=$1', [
            input.sessionId,
            randomUUID(),
          ]);
        if (change === 'role')
          await db.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
            input.profileId,
            input.userId,
          ]);
        if (change === 'disabled')
          await db.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [
            input.userId,
          ]);
        if (change === 'archive')
          await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [input.profileId]);
        await lock.query('SELECT pg_advisory_unlock($1,$2)', keys);
        const result = (await outcome) as { error?: { getStatus(): number } };
        expect(result.error?.getStatus()).toBe(
          change === 'role' ? 404 : change === 'archive' ? 409 : change === 'csrf' ? 403 : 401
        );
        await unchanged(input);
      } finally {
        await lock.query('SELECT pg_advisory_unlock_all()');
        lock.release();
        await outcome;
      }
    });
  }
  it(`${flow} commits one authorized receipt and audit on retry without moving funds`, async () => {
    const input = await seed();
    const first = await submit(flow, input),
      second = await submit(flow, input);
    expect(second).toEqual(first);
    expect(
      (
        await db.pool.query(
          'SELECT posted_balance,reserved_balance FROM wallets WHERE profile_id=$1',
          [input.profileId]
        )
      ).rows
    ).toEqual(flow === 'wallet' ? [{ posted_balance: '0', reserved_balance: '0' }] : []);
    expect(
      (
        await db.pool.query(
          "SELECT user_id,metadata::jsonb->>'sessionId' AS session_id,correlation_id FROM audit_log WHERE user_id=$1",
          [input.userId]
        )
      ).rows
    ).toEqual([
      { user_id: input.userId, session_id: input.sessionId, correlation_id: input.correlationId },
    ]);
  });
  it(`${flow} rolls back receipt, attachment claim and empty wallet if session expires during the write`, async () => {
    const input = await seed();
    const table = flow === 'wallet' ? 'wallet_transactions' : 'bank_receipts';
    await db.pool.query(
      'CREATE FUNCTION delay_receipt_submission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$'
    );
    await db.pool.query(
      `CREATE TRIGGER delay_receipt_submission BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION delay_receipt_submission()`
    );
    try {
      await db.pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE session_id=$1",
        [input.sessionId]
      );
      await expect(submit(flow, input)).rejects.toMatchObject({ status: 401 });
      await unchanged(input);
      expect(
        (await db.pool.query('SELECT id FROM audit_log WHERE user_id=$1', [input.userId])).rows
      ).toEqual([]);
    } finally {
      await db.pool.query(`DROP TRIGGER delay_receipt_submission ON ${table}`);
      await db.pool.query('DROP FUNCTION delay_receipt_submission()');
    }
  });
}
