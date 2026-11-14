import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const marker = 'Configured solar guidance';
const paths = ['document-guidance', 'postal-guidance'] as const;

async function session(user: string, context: 'customer' | 'staff') {
  const id = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
     VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes',$5)`,
    [id, user, randomUUID(), randomUUID(), context]
  );
  return id;
}

function read(path: string, sessionId: string) {
  return fetch(`${http.base}/api/${path}`, { headers: { Cookie: `barghsa_session=${sessionId}` } });
}

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_staff) VALUES
      ('guidance-customer','guidance-customer@example.test','test-only',false),
      ('guidance-reviewer','guidance-reviewer@example.test','test-only',true),
      ('guidance-editor','guidance-editor@example.test','test-only',true)`
  );
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES
      ('guidance-review','Guidance review','Test reviewer','["orders:read"]'),
      ('guidance-edit','Guidance edit','Test editor','["admin:catalogue:edit"]')`
  );
  await http.pool.query(
    `INSERT INTO user_roles(user_id,role_id) VALUES
      ('guidance-reviewer','guidance-review'),('guidance-editor','guidance-edit')`
  );
  await http.pool.query(
    `INSERT INTO app_config(key,value,version) VALUES
      ('solar.document_guidance',$1,1),('solar.postal_guidance',$2,1)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [
      JSON.stringify({ fa: 'راهنما', en: marker, suggestions: [] }),
      JSON.stringify({
        fa: 'راهنما',
        en: marker,
        destinationAddress: '',
        contactDetails: '',
        originals: [],
      }),
    ]
  );
}, 60_000);

afterAll(async () => http?.close());

it.each(paths)(
  'preserves customer %s and limits the staff endpoint to catalogue editors in staff mode',
  async (path) => {
    const customer = await session('guidance-customer', 'customer');
    const reviewer = await session('guidance-reviewer', 'staff');
    const editorInCustomerMode = await session('guidance-editor', 'customer');
    const editor = await session('guidance-editor', 'staff');
    const visible = await read(`solar/${path}`, customer);
    expect(visible.status, http.logs()).toBe(200);
    const guidance = await visible.json();
    expect(guidance).toMatchObject({ en: marker });
    const permitted = await read(`admin/solar/${path}`, editor);
    expect(permitted.status, http.logs()).toBe(200);
    expect(await permitted.json()).toEqual(guidance);
    for (const id of [customer, reviewer, editorInCustomerMode]) {
      const denied = await read(`admin/solar/${path}`, id);
      expect(denied.status, http.logs()).toBe(403);
      expect(await denied.text()).not.toContain(marker);
    }
  }
);

it.each([
  ['solar/document-guidance', 'customer'],
  ['solar/postal-guidance', 'customer'],
  ['admin/solar/document-guidance', 'staff'],
  ['admin/solar/postal-guidance', 'staff'],
] as const)(
  'withholds %s when the %s session expires during the database read',
  async (path, context) => {
    const id = await session(
      context === 'staff' ? 'guidance-editor' : 'guidance-customer',
      context
    );
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE app_config IN ACCESS EXCLUSIVE MODE');
      const { pid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!;
      const { expires_at: expiresAt } = (
        await http.pool.query<{ expires_at: Date }>(
          `UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '3 seconds'
         WHERE session_id=$1 RETURNING expires_at`,
          [id]
        )
      ).rows[0]!;
      pending = read(path, id);
      await expect
        .poll(async () => {
          const query = await http.pool.query<{ waiting: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
         WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
           AND query LIKE 'SELECT value FROM app_config WHERE key=%') AS waiting`,
            [pid]
          );
          return query.rows[0]!.waiting;
        })
        .toBe(true);
      await expect
        .poll(
          async () => {
            const observed = await http.pool.query<{ expired: boolean }>(
              'SELECT clock_timestamp()>=$1::timestamptz AS expired',
              [expiresAt]
            );
            return observed.rows[0]!.expired;
          },
          { timeout: 6000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      const denied = await pending;
      expect(denied.status, http.logs()).toBe(401);
      expect(await denied.text()).not.toContain(marker);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  },
  12_000
);
