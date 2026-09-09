/**
 * Real-PostgreSQL cross-flow tests for bank-receipt attachment claims
 * (T-04.3.01.02).
 *
 * Wallet top-up and invoice upload share one claim table and the same
 * advisory-lock namespace. Proves:
 *   1. Sequential wallet then invoice: invoice is rejected; wallet row
 *      remains the sole claim.
 *   2. Sequential invoice then wallet: wallet is rejected; invoice row
 *      remains the sole claim.
 *   3. Same-flow retries still reuse the original row.
 *   4. Concurrent wallet + invoice: exactly one flow wins.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { BANK_RECEIPT_STORAGE_PURPOSE } from '@barghsa/shared/finance';
import { InvoiceBankReceiptUploadService } from './invoice-bank-receipt-upload.service.js';
import { CustomerInvoiceDetailsService } from './customer-invoice-details.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { BankReceiptTopUpService } from '../wallet/bank-receipt-topup.service.js';
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage';

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@barghsa/db')>();
  return {
    ...actual,
    getDbPool: () => {
      if (!poolHolder.pool) {
        throw new Error('test pool not initialized — beforeAll must run first');
      }
      return poolHolder.pool;
    },
  };
});

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const INVOICE_A = '11111111-1111-7111-8111-111111111111';
const ACTOR_ID = 'user-customer-1';
const SESSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CSRF_TOKEN = 'receipt-test-csrf';

function receiptKey(suffix: string): string {
  const pad = suffix
    .replace(/[^0-9a-f]/gi, 'a')
    .padStart(12, '0')
    .slice(0, 12);
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`;
}

function pdfBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.4\n'));
  return bytes;
}

function bytesBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

function memoryStorage(objects: Map<string, Uint8Array>): StorageProvider {
  return {
    putObject: async (key, body) => {
      if (body instanceof Uint8Array) objects.set(key, body);
    },
    getObject: async (key) => {
      const bytes = objects.get(key);
      if (!bytes) throw new StorageObjectNotFound(key);
      return {
        body: bytesBody(bytes),
        contentType: 'application/pdf',
        contentLength: bytes.byteLength,
        metadata: {},
        etag: undefined,
      };
    },
    deleteObject: async () => {},
    presignedPutUrl: async () => '',
    presignedGetUrl: async () => '',
    listObjects: async () => ({ items: [], isTruncated: false, continuationToken: undefined }),
  };
}

describe('bank-receipt attachment cross-flow claims — real PostgreSQL (T-04.3.01.02)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let invoiceUpload: InvoiceBankReceiptUploadService;
  let walletTopUp: BankReceiptTopUpService;
  const objects = new Map<string, Uint8Array>();

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    invoiceUpload = new InvoiceBankReceiptUploadService(
      new CustomerInvoiceDetailsService(),
      memoryStorage(objects)
    );
    walletTopUp = new BankReceiptTopUpService(new WalletService());

    await ctx.pool.query(
      `INSERT INTO users (user_id, username, password_hash) VALUES ($1, 'receipt-upload@example.test', 'test-only')`,
      [ACTOR_ID]
    );
    await ctx.pool.query(`INSERT INTO profiles (id, user_id, is_default) VALUES ($1, $2, true)`, [
      PROFILE_A,
      ACTOR_ID,
    ]);
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [PROFILE_A]);
    await ctx.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
      [SESSION_ID, ACTOR_ID, CSRF_TOKEN]
    );
  }, 60_000);

  afterAll(async () => {
    poolHolder.pool = null;
    await ctx.close();
  }, 60_000);

  beforeEach(async () => {
    objects.clear();
    await ctx.pool.query(
      `TRUNCATE bank_receipts, bank_receipt_attachment_claims, wallet_transactions,
                invoices, storage_records CASCADE`
    );
    await ctx.pool.query(
      `INSERT INTO invoices (id, profile_id, state, total_amount)
       VALUES ($1, $2, 'Unpaid', 5000000)`,
      [INVOICE_A, PROFILE_A]
    );
  });

  async function insertReceiptFile(storageKey: string): Promise<void> {
    await ctx.pool.query(
      `INSERT INTO storage_records
         (storage_key, status, metadata, file_size, content_type, category, file_name)
       VALUES ($1, 'active', $2::jsonb, 4096, 'application/pdf', 'document', 'slip.pdf')`,
      [
        storageKey,
        JSON.stringify({
          verified: true,
          uploadedBy: ACTOR_ID,
          profileId: PROFILE_A,
          purpose: BANK_RECEIPT_STORAGE_PURPOSE,
        }),
      ]
    );
    objects.set(storageKey, pdfBytes(4096));
  }

  function invoicePayload(attachmentKey: string) {
    return {
      userId: ACTOR_ID,
      sessionId: SESSION_ID,
      csrfToken: CSRF_TOKEN,
      invoiceId: INVOICE_A,
      amount: 250_000,
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey,
      customerNote: 'Branch transfer',
    };
  }

  function walletPayload(attachmentKey: string, idempotencyKey: string) {
    return {
      profileId: PROFILE_A,
      amount: 250_000,
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey,
      customerNote: 'Branch transfer',
      idempotencyKey,
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      csrfToken: CSRF_TOKEN,
    };
  }

  async function claimRows(storageKey: string) {
    const result = await ctx.pool.query<{ storage_key: string; claim_type: string }>(
      `SELECT storage_key, claim_type
         FROM bank_receipt_attachment_claims
        WHERE storage_key = $1`,
      [storageKey]
    );
    return result.rows;
  }

  it('rejects an invoice upload after the same file was claimed as a wallet top-up', async () => {
    const attachment = receiptKey('walletfirst01');
    await insertReceiptFile(attachment);

    const wallet = await walletTopUp.submit(walletPayload(attachment, 'wallet-first'));
    expect(wallet.state).toBe('Pending');
    await expect(invoiceUpload.submit(invoicePayload(attachment))).rejects.toBeInstanceOf(
      ConflictException
    );

    expect(await claimRows(attachment)).toEqual([
      { storage_key: attachment, claim_type: 'wallet_topup' },
    ]);
    const receipts = await ctx.pool.query(`SELECT count(*)::int AS n FROM bank_receipts`);
    expect(receipts.rows[0]!.n).toBe(0);
    const retry = await walletTopUp.submit(walletPayload(attachment, 'wallet-first'));
    expect(retry.transactionId).toBe(wallet.transactionId);
  });

  it('rejects a wallet top-up after the same file was claimed as an invoice receipt', async () => {
    const attachment = receiptKey('invoicefirst1');
    await insertReceiptFile(attachment);

    const invoice = await invoiceUpload.submit(invoicePayload(attachment));
    expect(invoice.state).toBe('Submitted');
    await expect(
      walletTopUp.submit(walletPayload(attachment, 'wallet-after-invoice'))
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await claimRows(attachment)).toEqual([
      { storage_key: attachment, claim_type: 'invoice_receipt' },
    ]);
    const ledger = await ctx.pool.query(`SELECT count(*)::int AS n FROM wallet_transactions`);
    expect(ledger.rows[0]!.n).toBe(0);
    const retry = await invoiceUpload.submit(invoicePayload(attachment));
    expect(retry.receiptId).toBe(invoice.receiptId);
  });

  it('lets only one flow win when wallet and invoice submit the same file concurrently', async () => {
    const attachment = receiptKey('concurrent01');
    await insertReceiptFile(attachment);

    const results = await Promise.allSettled([
      walletTopUp.submit(walletPayload(attachment, 'wallet-race')),
      invoiceUpload.submit(invoicePayload(attachment)),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    const rejected = results.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const claims = await claimRows(attachment);
    expect(claims).toHaveLength(1);
    const receipts = await ctx.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bank_receipts`
    );
    const walletTx = await ctx.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM wallet_transactions WHERE receipt_attachment_key = $1`,
      [attachment]
    );
    if (claims[0]!.claim_type === 'wallet_topup') {
      expect(walletTx.rows[0]!.n).toBe(1);
      expect(receipts.rows[0]!.n).toBe(0);
    } else {
      expect(claims[0]!.claim_type).toBe('invoice_receipt');
      expect(receipts.rows[0]!.n).toBe(1);
      expect(walletTx.rows[0]!.n).toBe(0);
    }
  });
});
