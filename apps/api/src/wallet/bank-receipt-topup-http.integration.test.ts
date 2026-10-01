import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { BANK_RECEIPT_STORAGE_PURPOSE, parseBankReceiptTopUpReview } from '@barghsa/shared/finance';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40_000);
afterAll(async () => {
  await http?.close();
});

async function seed() {
  const userId = randomUUID();
  const profileId = randomUUID();
  const sessionId = randomUUID();
  const csrf = randomUUID();
  const attachmentKey = `uploads/document/${randomUUID()}.pdf`;
  const idempotencyKey = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'test-only')",
    [userId]
  );
  await http.pool.query("INSERT INTO profiles(id,user_id,status) VALUES ($1,$2,'ACTIVE')", [
    profileId,
    userId,
  ]);
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ($1,$2)', [
    userId,
    profileId,
  ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')",
    [sessionId, userId, csrf]
  );
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name)
     VALUES($1,'active',$2::jsonb,4096,'application/pdf','document','transfer.pdf')`,
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
  const headers = {
    Cookie: `barghsa_session=${sessionId}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const details = {
    amount: '250000',
    paymentDate: '2026-08-15',
    payerReference: 'TRK-998877',
    attachmentKey,
    customerNote: 'Branch transfer',
  };
  const path = `${http.base}/api/wallet/${profileId}/bank-receipt-top-ups`;
  return { profileId, idempotencyKey, attachmentKey, headers, details, path };
}

it('reviews the bank receipt and requires its exact hash before Pending submission', async () => {
  const input = await seed();
  const preview = await fetch(`${input.path}/review`, {
    method: 'POST',
    headers: input.headers,
    body: JSON.stringify({ ...input.details, idempotencyKey: input.idempotencyKey }),
  });
  expect(preview.status, await preview.clone().text()).toBe(200);
  const review = (await preview.json()) as {
    hash: string;
    data: { amountIrR: string; fileName: string; creditRule: string };
  };
  expect(review.data).toMatchObject({
    amountIrR: '250000',
    fileName: 'transfer.pdf',
    creditRule: 'after_finance_confirmation',
  });
  const namedPreview = await fetch(`${input.path}/review`, {
    method: 'POST',
    headers: input.headers,
    body: JSON.stringify({
      ...input.details,
      bankName: '  بانک ملی  ',
      idempotencyKey: input.idempotencyKey,
    }),
  });
  expect(namedPreview.status).toBe(200);
  const named = parseBankReceiptTopUpReview(await namedPreview.json());
  if (!named) throw new Error('Expected valid bank-name review');
  expect(named.data.bankName).toBe('بانک ملی');
  expect(named.hash).not.toBe(review.hash);
  const invalidPreview = await fetch(`${input.path}/review`, {
    method: 'POST',
    headers: input.headers,
    body: JSON.stringify({
      ...input.details,
      bankName: 'Bank\tName',
      idempotencyKey: input.idempotencyKey,
    }),
  });
  expect(invalidPreview.status).toBe(400);
  const changedBank = await fetch(input.path, {
    method: 'POST',
    headers: { ...input.headers, 'Idempotency-Key': input.idempotencyKey },
    body: JSON.stringify({
      ...input.details,
      bankName: 'Other bank',
      expectedReviewHash: review.hash,
    }),
  });
  expect(changedBank.status).toBe(409);
  const submit = (expectedReviewHash?: string) =>
    fetch(input.path, {
      method: 'POST',
      headers: { ...input.headers, 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({ ...input.details, expectedReviewHash }),
    });
  expect((await submit()).status).toBe(400);
  expect((await submit('0'.repeat(64))).status).toBe(409);
  await http.pool.query('UPDATE storage_records SET file_name=$2 WHERE storage_key=$1', [
    input.attachmentKey,
    'changed.pdf',
  ]);
  expect((await submit(review.hash)).status).toBe(409);
  expect(
    (
      await http.pool.query('SELECT id FROM wallet_transactions WHERE idempotency_key=$1', [
        input.idempotencyKey,
      ])
    ).rows
  ).toEqual([]);
});
