import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { ONLINE_TOPUP_EXPIRY_REASON } from '@barghsa/shared/finance';
import { reconcileProviderTransactions } from './provider-reconciliation-scanner';
import { FIND_PROVIDER_RECONCILIATION_CANDIDATES_SQL } from './provider-reconciliation-scanner';
import type { Pool } from 'pg';

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
const now = new Date('2026-10-07T10:00:00Z');
const old = new Date('2026-10-07T08:00:00Z');
beforeAll(async () => {
  db = await createMigratedTestDb();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('provider-fixture','provider-fixture','fixture')"
  );
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query(
    'TRUNCATE reconciliation_exceptions,wallet_topup_callback_events,wallet_chargeback_events,wallet_transactions,wallets,profiles CASCADE'
  );
});
async function profile() {
  const id = randomUUID();
  await db.pool.query("INSERT INTO profiles(id,user_id) VALUES($1,'provider-fixture')", [id]);
  await db.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [id]);
  return id;
}
async function intent(
  walletId: string,
  state = 'Pending',
  created = old,
  metadata: Record<string, unknown> = { channel: 'online' },
  amount = '9007199254740993'
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO wallet_transactions(id,wallet_id,type,state,amount,idempotency_key,created_at,metadata) VALUES($1,$2,'topup',$3,$4,$1::uuid::text,$5,$6::jsonb)",
    [id, walletId, state, amount, created, JSON.stringify(metadata)]
  );
  return id;
}
async function credit(
  pending: string,
  walletId: string,
  amount = '9007199254740993',
  metadata: Record<string, unknown> = { channel: 'online', pendingTransactionId: pending }
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO wallet_transactions(id,wallet_id,type,state,amount,idempotency_key,metadata) VALUES($1,$2,'topup','Completed',$3,$4,$5::jsonb)",
    [id, walletId, amount, `wallet-online-topup-credit:${pending}`, JSON.stringify(metadata)]
  );
  await db.pool.query(
    'UPDATE wallets SET posted_balance=posted_balance+$2::bigint WHERE profile_id=$1',
    [walletId, amount]
  );
  return id;
}
async function callback(pending: string, walletId: string, status = 'processing', created = old) {
  const id = randomUUID(),
    event = 'provider:' + id;
  await db.pool.query(
    'INSERT INTO wallet_topup_callback_events(id,event_id,pending_transaction_id,wallet_id,status,created_at,raw) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [
      id,
      event,
      pending,
      walletId,
      status,
      created,
      JSON.stringify({ privateProviderData: 'DO-NOT-COPY' }),
    ]
  );
  return { id, event };
}
async function chargeback(
  status = 'unmatched',
  original: string | null = null,
  reversal: string | null = null,
  walletId: string | null = null,
  created = old
) {
  const id = randomUUID(),
    event = 'chargeback:' + id;
  await db.pool.query(
    'INSERT INTO wallet_chargeback_events(id,event_id,status,original_transaction_id,reversal_transaction_id,wallet_id,created_at,raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [
      id,
      event,
      status,
      original,
      reversal,
      walletId,
      created,
      JSON.stringify({ privateProviderData: 'DO-NOT-COPY' }),
    ]
  );
  return { id, event };
}
async function snapshot() {
  return Object.fromEntries(
    await Promise.all(
      [
        'profiles',
        'wallets',
        'wallet_transactions',
        'wallet_topup_callback_events',
        'wallet_chargeback_events',
      ].map(async (table) => [
        table,
        (await db.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ])
    )
  );
}
async function reports() {
  return (
    await db.pool.query('SELECT severity,status,details FROM reconciliation_exceptions ORDER BY id')
  ).rows;
}
function scan(batchSize = 200) {
  return reconcileProviderTransactions({ pool: db.pool, now, batchSize });
}

it('reports authenticated unmatched/unresolved chargebacks and stalled claims without financial changes or raw data', async () => {
  await chargeback('unmatched');
  await chargeback('unresolved');
  await chargeback('processing');
  await chargeback('processing', null, null, null, now);
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 3, errors: [] });
  expect((await reports()).map((r) => r.details.reason).sort()).toEqual([
    'stalled_processing',
    'unmatched',
    'unresolved',
  ]);
  expect(
    (await reports()).every(
      (r) =>
        r.severity === 'high' && r.status === 'open' && /^[a-f0-9]{64}$/.test(r.details.eventHash)
    )
  ).toBe(true);
  expect(JSON.stringify(await reports())).not.toContain('DO-NOT-COPY');
  expect(await snapshot()).toEqual(before);
});
it('preserves fresh and exactly-at-cutoff claims and ignores terminal unpaid callback outcomes', async () => {
  const p = await profile(),
    i = await intent(p, 'Released');
  await callback(i, p, 'processing', new Date(now.getTime() - 15 * 60000));
  await callback(i, p, 'unpaid');
  await callback(i, p, 'processing', now);
  expect(await scan()).toMatchObject({ reported: 0, errors: [] });
});
it('reports stale callback claims and exact missing credit amounts, while valid legacy credits stay accepted', async () => {
  const p = await profile(),
    stale = await intent(p, 'Released'),
    missing = await intent(p, 'Released'),
    valid = await intent(p, 'Released');
  await callback(stale, p);
  await callback(missing, p, 'credited');
  await credit(valid, p, '9007199254740993', {});
  await callback(valid, p, 'duplicate');
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 2, errors: [] });
  const rows = await reports();
  expect(rows.map((r) => r.details.reason).sort()).toEqual([
    'credit_mismatch',
    'stalled_processing',
  ]);
  expect(rows.find((r) => r.details.reason === 'credit_mismatch')?.details.intentAmount).toBe(
    '9007199254740993'
  );
  expect(await snapshot()).toEqual(before);
});
it.each(['amount', 'wallet', 'metadata'] as const)(
  'reports %s provenance drift in a completed callback credit',
  async (mismatch) => {
    const p = await profile(),
      other = await profile(),
      i = await intent(p, 'Released');
    await credit(
      i,
      mismatch === 'wallet' ? other : p,
      mismatch === 'amount' ? '9007199254740994' : '9007199254740993',
      mismatch === 'metadata'
        ? { channel: 'bank_receipt', pendingTransactionId: randomUUID() }
        : { channel: 'online', pendingTransactionId: i.toUpperCase() }
    );
    await callback(i, p, 'credited');
    const before = await snapshot();
    expect(await scan()).toMatchObject({ reported: 1, errors: [] });
    expect((await reports())[0].details.reason).toBe('credit_mismatch');
    expect(await snapshot()).toEqual(before);
  }
);
it('reports a callback claim tied to the wrong wallet even before terminal settlement', async () => {
  const p = await profile(),
    other = await profile(),
    i = await intent(p, 'Released');
  await callback(i, other, 'processing', now);
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect((await reports())[0].details.reason).toBe('credit_mismatch');
});
it('verifies reversal identity, wallet and exact signed amount and preserves a valid posted chargeback', async () => {
  const p = await profile(),
    i = await intent(p, 'Released'),
    o = await credit(i, p),
    r = randomUUID();
  await db.pool.query(
    "INSERT INTO wallet_transactions(id,wallet_id,type,state,amount,idempotency_key,reverses_transaction_id) VALUES($1,$2,'reversal','Completed',-9007199254740993,$1::uuid::text,$3)",
    [r, p, o]
  );
  await db.pool.query('UPDATE wallets SET posted_balance=0 WHERE profile_id=$1', [p]);
  await chargeback('reversed', o, r, p);
  await chargeback('reversed');
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect((await reports())[0].details.reason).toBe('reversal_mismatch');
  expect(await snapshot()).toEqual(before);
});
it('reports pending and stamped expiry once across rejection and staff closure, excluding unrelated terminal/bank intents', async () => {
  const p = await profile(),
    i = await intent(p),
    j = await intent(p, 'Rejected', now, {
      channel: 'online',
      expiry: { reason: ONLINE_TOPUP_EXPIRY_REASON, privateData: 'DO-NOT-COPY' },
    });
  await intent(p, 'Failed');
  await intent(p, 'Released');
  await intent(p, 'Rejected');
  await intent(p, 'Pending', old, { channel: 'bank_receipt' });
  await intent(p, 'Pending', new Date(now.getTime() - 30 * 60000));
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 2, errors: [] });
  expect(await snapshot()).toEqual(before);
  expect((await reports()).map((r) => r.details.pendingTransactionId).sort()).toEqual(
    [i, j].sort()
  );
  await db.pool.query(
    "UPDATE wallet_transactions SET state='Rejected',metadata=metadata||$2::jsonb WHERE id=$1",
    [i, JSON.stringify({ expiry: { reason: ONLINE_TOPUP_EXPIRY_REASON } })]
  );
  await db.pool.query(
    "UPDATE reconciliation_exceptions SET status='closed',resolution_note='investigated' WHERE details->>'source'='provider_intent'"
  );
  expect(await scan()).toMatchObject({ reported: 0, errors: [] });
  expect(await reports()).toHaveLength(2);
});

it.each(['amount', 'event-wallet', 'original'] as const)(
  'reports %s drift in a posted chargeback reversal',
  async (mismatch) => {
    const p = await profile(),
      other = await profile(),
      i = await intent(p, 'Released'),
      o = await credit(i, p),
      r = randomUUID();
    const otherIntent = await intent(p, 'Released'),
      otherOriginal = await credit(otherIntent, p, '10');
    const reversedAmount = mismatch === 'amount' ? '9007199254740992' : '9007199254740993';
    await db.pool.query(
      "INSERT INTO wallet_transactions(id,wallet_id,type,state,amount,idempotency_key,reverses_transaction_id) VALUES($1,$2,'reversal','Completed',$3,$1::uuid::text,$4)",
      [r, p, '-' + reversedAmount, mismatch === 'original' ? otherOriginal : o]
    );
    await db.pool.query(
      'UPDATE wallets SET posted_balance=posted_balance-$2::bigint WHERE profile_id=$1',
      [p, reversedAmount]
    );
    await chargeback('reversed', o, r, mismatch === 'event-wallet' ? other : p);
    const before = await snapshot();
    expect(await scan()).toMatchObject({ reported: 1, errors: [] });
    expect((await reports())[0].details.reason).toBe('reversal_mismatch');
    expect(await snapshot()).toEqual(before);
  }
);

it('rechecks a claim resolved after selection instead of emitting a stale incident', async () => {
  const p = await profile(),
    i = await intent(p, 'Released'),
    e = await callback(i, p);
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      const selected = await db.pool.query(sql, params);
      if (sql === FIND_PROVIDER_RECONCILIATION_CANDIDATES_SQL)
        await db.pool.query("UPDATE wallet_topup_callback_events SET status='unpaid' WHERE id=$1", [
          e.id,
        ]);
      return selected;
    },
    connect: () => db.pool.connect(),
  } as unknown as Pool;
  expect(await reconcileProviderTransactions({ pool, now })).toMatchObject({
    scanned: 1,
    reported: 0,
    skipped: 1,
    errors: [],
  });
  expect(await reports()).toHaveLength(0);
});
it('bounds independent drain and deduplicates resolved immutable provider outcomes', async () => {
  for (let n = 0; n < 3; n++) await chargeback();
  expect(await scan(2)).toMatchObject({ reported: 2, truncated: true, errors: [] });
  expect(await scan(2)).toMatchObject({ reported: 1, truncated: false, errors: [] });
  await db.pool.query(
    "UPDATE reconciliation_exceptions SET status='resolved',resolution_note='investigated'"
  );
  expect(await scan()).toMatchObject({ reported: 0, errors: [] });
});
it('skips the actual provider handler advisory locks and busy event rows, then reports after release', async () => {
  // Read the built API's actual keys without importing another project's source into worker tsc.
  const { onlineTopUpCallbackLockKeys } = await import(
    pathToFileURL(resolve('../api/dist/src/wallet/online-topup-callback.service.js')).href
  );
  const { chargebackEventLockKeys } = await import(
    pathToFileURL(resolve('../api/dist/src/wallet/chargeback-detection.service.js')).href
  );
  const p = await profile(),
    i = await intent(p, 'Released');
  await callback(i, p);
  const cb = await chargeback();
  const blocker = await db.pool.connect();
  try {
    await blocker.query('SELECT pg_advisory_lock($1,$2)', onlineTopUpCallbackLockKeys(i));
    await blocker.query('SELECT pg_advisory_lock($1,$2)', chargebackEventLockKeys(cb.event));
    expect(await scan()).toMatchObject({ reported: 0, skipped: 2, errors: [] });
    await blocker.query('SELECT pg_advisory_unlock_all()');
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM wallet_chargeback_events WHERE id=$1 FOR UPDATE', [cb.id]);
    expect(await scan()).toMatchObject({ reported: 1, skipped: 1, errors: [] });
    await blocker.query('ROLLBACK');
    expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  } finally {
    await blocker.query('ROLLBACK').catch(() => {});
    await blocker.query('SELECT pg_advisory_unlock_all()');
    blocker.release();
  }
});
it('concurrent workers report each incident once', async () => {
  await chargeback();
  const runs = await Promise.all([scan(), scan()]);
  expect(runs.flatMap((r) => r.errors)).toEqual([]);
  expect(runs.reduce((n, r) => n + r.reported, 0)).toBe(1);
  expect(await reports()).toHaveLength(1);
});
it('rolls back one report failure and continues other records, then retries cleanly', async () => {
  const bad = await chargeback(),
    good = await chargeback();
  await db.pool.query(
    `CREATE FUNCTION fail_provider_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details->>'recordId'='${bad.id}' THEN RAISE EXCEPTION 'fixture report failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER fail_provider_report BEFORE INSERT ON reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION fail_provider_report()`
  );
  try {
    const before = await snapshot(),
      result = await scan();
    expect(result.reported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect((await reports())[0].details.recordId).toBe(good.id);
    expect(await snapshot()).toEqual(before);
  } finally {
    await db.pool.query(
      'DROP TRIGGER fail_provider_report ON reconciliation_exceptions;DROP FUNCTION fail_provider_report()'
    );
  }
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect(await reports()).toHaveLength(2);
});
