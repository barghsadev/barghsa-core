import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { runMigrationPrefix } from './test/migration-prefix';
import { finishMultipartReservation, withMultipartUploadLock } from './storage-multipart';

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  db = await createMigratedTestDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

it('serializes one object across sessions while provider work holds no transaction or row lock', async () => {
  const key = `uploads/document/${randomUUID()}.pdf`;
  await db.pool.query("INSERT INTO storage_records(storage_key,status) VALUES($1,'removed')", [
    key,
  ]);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pid: number;
  const first = withMultipartUploadLock(db.pool, key, async (client) => {
    pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    entered();
    await pending;
    return 'provider-result';
  });
  await started;
  try {
    expect(await withMultipartUploadLock(db.pool, key, async () => 'duplicate')).toEqual({
      acquired: false,
    });
    expect(
      await withMultipartUploadLock(db.pool, `${key}-other`, async () => 'independent')
    ).toEqual({ acquired: true, value: 'independent' });
    expect(
      (await db.pool.query('SELECT state,xact_start FROM pg_stat_activity WHERE pid=$1', [pid!]))
        .rows[0]
    ).toEqual({ state: 'idle', xact_start: null });
    const observer = await db.pool.connect();
    try {
      await observer.query('BEGIN');
      await observer.query('SELECT 1 FROM storage_records WHERE storage_key=$1 FOR UPDATE NOWAIT', [
        key,
      ]);
      await observer.query('COMMIT');
    } finally {
      await observer.query('ROLLBACK');
      observer.release();
    }
  } finally {
    release();
  }
  expect(await first).toEqual({ acquired: true, value: 'provider-result' });
  await expect(
    withMultipartUploadLock(db.pool, key, async () => {
      throw new Error('provider failed');
    })
  ).rejects.toThrow('provider failed');
  expect(await withMultipartUploadLock(db.pool, key, async () => 'retry')).toEqual({
    acquired: true,
    value: 'retry',
  });
});

it('finalizes only the matching durable direction and retains historical cleanup receipts', async () => {
  const key = `uploads/document/${randomUUID()}.pdf`;
  await db.pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata) VALUES($1,'removed',$2::jsonb)`,
    [
      key,
      JSON.stringify({
        multipart: { id: randomUUID(), providerId: 'provider', status: 'completing' },
        provisionalUpload: true,
        deletionRequested: false,
      }),
    ]
  );
  const client = await db.pool.connect();
  try {
    expect(await finishMultipartReservation(client, key, 'provider', 'aborted')).toBe(false);
    expect(await finishMultipartReservation(client, key, 'other', 'completed')).toBe(false);
    expect(await finishMultipartReservation(client, key, 'provider', 'completed')).toBe(true);
    expect(await finishMultipartReservation(client, key, 'provider', 'aborted')).toBe(false);
  } finally {
    client.release();
  }
  expect(
    (await db.pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [key]))
      .rows[0].metadata.multipart.status
  ).toBe('completed');
  expect(
    (await db.pool.query('SELECT metadata FROM storage_records WHERE storage_key=$1', [key]))
      .rows[0].metadata.deletionRequested
  ).toBe(true);
  for (const status of ['pending', 'aborted', 'failed'])
    await db.pool.query(
      `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status) VALUES($1,$2,NOW(),$3)`,
      [key, status, status]
    );
  await expect(
    db.pool.query(
      `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status) VALUES($1,'invalid',NOW(),'unknown')`,
      [key]
    )
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await db.pool.query(
        'SELECT status FROM upload_cleanup_log WHERE storage_key=$1 ORDER BY status',
        [key]
      )
    ).rows.map((row) => row.status)
  ).toEqual(['aborted', 'failed', 'pending']);
});

describe('historical multipart cleanup upgrade', () => {
  const name = `test_multipart_upgrade_${randomUUID().replaceAll('-', '')}`;
  const target = '0289_solar_document_destruction_guard';
  let pool: Pool;
  let connection: { pgdirectUrl: string };
  let history: object[];
  let prior: object[];
  let priorStorage: object[];
  beforeAll(async () => {
    await db.pool.query(`CREATE DATABASE "${name}"`);
    const url = new URL(db.connectionString);
    url.pathname = `/${name}`;
    connection = { pgdirectUrl: url.toString() };
    const migrated = await runMigrationPrefix('0286_upload_scope_quotas', { connection });
    expect(migrated.ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    for (const status of ['failed', 'aborted'])
      await pool.query(
        `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status,error_code) VALUES($1,$2,NOW(),$2,'original-receipt')`,
        [status, status]
      );
    prior = (await pool.query('SELECT * FROM upload_cleanup_log ORDER BY storage_key')).rows;
    await pool.query(
      `INSERT INTO storage_records(storage_key,status,signed_at,metadata)
       VALUES('historical-signed','immutable',NOW(),'{"retained":true}'),
         ('historical-removed','removed',NULL,'{"deletionRequested":true}')`
    );
    priorStorage = (await pool.query('SELECT * FROM storage_records ORDER BY storage_key')).rows;
    history = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await db.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
  it('preserves old receipts and the journal while allowing durable pending intent', async () => {
    expect(await runMigrationPrefix(target, { connection })).toEqual({
      ok: true,
      applied: [
        '0287_multipart_operation_recovery',
        '0288_storage_cleanup_operation_claim',
        '0289_solar_document_destruction_guard',
      ],
    });
    expect(
      (await pool.query('SELECT * FROM upload_cleanup_log ORDER BY storage_key')).rows
    ).toEqual(prior);
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        history.length
      )
    ).toEqual(history);
    expect((await pool.query('SELECT * FROM storage_records ORDER BY storage_key')).rows).toEqual(
      priorStorage.map((row) => ({ ...row, cleanup_operation: null }))
    );
    await expect(
      pool.query(
        "UPDATE storage_records SET cleanup_operation='delete' WHERE storage_key='historical-signed'"
      )
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'storage_records_cleanup_operation_check',
    });
    await pool.query(
      "UPDATE storage_records SET cleanup_operation='delete' WHERE storage_key='historical-removed'"
    );
    await expect(
      pool.query(
        "UPDATE storage_records SET status='active' WHERE storage_key='historical-removed'"
      )
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'storage_records_cleanup_operation_check',
    });
    await pool.query(
      `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status) VALUES('pending','pending',NOW(),'pending')`
    );
    await expect(
      pool.query(`UPDATE upload_cleanup_log SET status='unexpected' WHERE storage_key='pending'`)
    ).rejects.toMatchObject({ code: '23514' });
    expect(await runMigrationPrefix(target, { connection })).toEqual({ ok: true, applied: [] });
  }, 30_000);
});
