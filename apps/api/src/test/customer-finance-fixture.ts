import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { postWalletCredit } from '@barghsa/db/wallet-credit';

type QueryClient = Pick<Pool | PoolClient, 'query'>;

/** Seed only within a migrated disposable integration database. */
export async function seedCustomerUser(
  db: QueryClient,
  userId: string,
  username: string,
  passwordHash = 'test-only'
) {
  await db.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,$3)', [
    userId,
    username,
    passwordHash,
  ]);
}

export async function seedCustomerProfile(
  db: QueryClient,
  id: string,
  userId: string,
  profileType: 'INDIVIDUAL' | 'LEGAL' = 'INDIVIDUAL',
  isDefault = false
) {
  await db.query('INSERT INTO profiles(id,user_id,is_default,profile_type) VALUES($1,$2,$3,$4)', [
    id,
    userId,
    isDefault,
    profileType,
  ]);
}

/** Establish a fixture session for domain tests. Login tests use the public auth flow. */
export async function seedCustomerSession(db: QueryClient, userId: string, steppedUp = false) {
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await db.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
     VALUES($1,$2,$3,$1,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',
            CASE WHEN $4 THEN NOW()-INTERVAL '1 second' END)`,
    [sessionId, userId, csrf, steppedUp]
  );
  return {
    sessionId,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
}

export async function seedElectricityOrder(
  db: QueryClient,
  userId: string,
  profileId: string,
  productId: string
) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO orders(user_id,profile_id,product_id,order_type,snapshot_province_id,
                       snapshot_city_id,snapshot_full_address,snapshot_postal_code)
     VALUES($1,$2,$3,'electricity','province','city','Street','1234567890') RETURNING id`,
    [userId, profileId, productId]
  );
  return rows[0]!.id;
}

export async function seedPayableInvoice(
  db: QueryClient,
  input: { id: string; profileId: string; total: string; state?: string; paid?: string }
) {
  await db.query(
    `INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,payable_from)
     VALUES($1,$2,$3,$4,$5,NOW()-INTERVAL '1 day')`,
    [input.id, input.profileId, input.state ?? 'Unpaid', input.total, input.paid ?? '0']
  );
}

/** Fund a pre-created fixture wallet through the same atomic ledger credit as the app. */
export async function fundCustomerWallet(
  pool: Pool,
  profileId: string,
  amount: bigint,
  idempotencyKey = randomUUID()
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; archived: boolean }>(
      'SELECT id,archived FROM profiles WHERE id=$1 FOR SHARE',
      [profileId]
    );
    const profile = rows[0];
    if (!profile) throw new Error('Expected a migrated fixture profile');
    const result = await postWalletCredit(
      client,
      profile,
      profile.id,
      amount,
      { type: 'topup' },
      idempotencyKey
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
