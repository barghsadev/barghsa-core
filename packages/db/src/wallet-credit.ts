import { WALLET_REVERSAL_ERRORS, WALLET_REVERSAL_TYPE } from '@barghsa/shared/finance';

export interface WalletCreditClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}
export interface WalletCreditReference {
  type: 'topup' | 'refund' | 'compensating';
  refId?: string | null;
  description?: string | null;
  metadata?: unknown;
}
export class WalletCreditError extends Error {
  constructor(
    readonly kind: 'invalid' | 'not_found' | 'conflict' | 'archived',
    message: string
  ) {
    super(message);
    this.name = 'WalletCreditError';
  }
}
export function validateWalletCredit(
  amount: bigint,
  ref: WalletCreditReference,
  key: string
): void {
  if (amount <= 0n) throw new WalletCreditError('invalid', 'Credit amount must be positive');
  if (!key.trim()) throw new WalletCreditError('invalid', 'Idempotency key is required');
  if ((ref.type as string) === WALLET_REVERSAL_TYPE)
    throw new WalletCreditError('invalid', WALLET_REVERSAL_ERRORS.USE_REVERSE_TRANSACTION());
  if (!['topup', 'refund', 'compensating'].includes(ref.type))
    throw new WalletCreditError(
      'invalid',
      'Credit type must be one of: topup, refund, compensating'
    );
}

/** A replay must identify the same completed credit, including its domain reference. */
export function assertMatchingWalletCredit(
  input: unknown,
  walletId: string,
  amount: bigint,
  ref: WalletCreditReference
): void {
  const row = input as {
    wallet_id: string;
    state: string;
    type: string;
    amount: string | bigint;
    ref_id?: string | null;
  };
  if (row.wallet_id !== walletId)
    throw new WalletCreditError('conflict', 'Idempotency key already used for a different wallet');
  if (
    row.state !== 'Completed' ||
    row.type !== ref.type ||
    BigInt(row.amount) !== amount ||
    (row.ref_id ?? null) !== (ref.refId ?? null)
  )
    throw new WalletCreditError(
      'conflict',
      'Idempotency key already used for a different wallet operation'
    );
}

/**
 * Post within the caller's transaction. The caller must hold the profile lock
 * before any invoice/refund/wallet locks, and must roll back on every error.
 * This function never starts, commits, releases or retries a transaction.
 */
export async function postWalletCredit(
  client: WalletCreditClient,
  profile: { id: string; archived: boolean },
  walletId: string,
  amount: bigint,
  ref: WalletCreditReference,
  key: string
): Promise<unknown> {
  validateWalletCredit(amount, ref, key);
  const wallet = (
    await client.query('SELECT * FROM wallets WHERE profile_id = $1 FOR UPDATE', [walletId])
  ).rows[0] as { profile_id: string; version: number } | undefined;
  if (!wallet) throw new WalletCreditError('not_found', `Wallet not found: ${walletId}`);
  if (profile.id !== wallet.profile_id.toLowerCase())
    throw new WalletCreditError('conflict', 'Wallet profile changed; retry');
  const existing = (
    await client.query('SELECT * FROM wallet_transactions WHERE idempotency_key = $1', [key])
  ).rows[0];
  if (existing) {
    assertMatchingWalletCredit(existing, wallet.profile_id, amount, ref);
    return existing;
  }
  if (profile.archived !== false)
    throw new WalletCreditError(
      'archived',
      'Archived profiles cannot receive wallet balance changes'
    );
  const inserted = await client.query(
    `INSERT INTO wallet_transactions
       (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
     VALUES ($1, $2, $3::bigint, 'Completed', $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
     RETURNING *`,
    [
      wallet.profile_id,
      ref.type,
      amount,
      key,
      ref.refId ?? null,
      ref.description ?? null,
      ref.metadata === undefined ? null : JSON.stringify(ref.metadata),
    ]
  );
  const updated = await client.query(
    `WITH active_profile AS MATERIALIZED (
       SELECT id FROM profiles WHERE id = $2 AND NOT archived FOR SHARE
     )
     UPDATE wallets
     SET posted_balance = posted_balance + $1::bigint,
         version = version + 1, updated_at = NOW()
     WHERE profile_id = $2 AND EXISTS (SELECT 1 FROM active_profile)
       AND version = $3 AND posted_balance >= 0
     RETURNING *, (posted_balance - reserved_balance) AS available_balance`,
    [amount, wallet.profile_id, wallet.version]
  );
  if (!updated.rows.length)
    throw new WalletCreditError(
      'conflict',
      'Wallet credit rejected: version mismatch or postedBalance < 0'
    );
  return inserted.rows[0];
}
