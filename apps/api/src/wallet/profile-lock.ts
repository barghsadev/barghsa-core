import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { WalletQueryClient } from './wallet.service.js';

const selectors = {
  profile: '$1',
  transaction: '(SELECT wallet_id FROM wallet_transactions WHERE id = $1)',
  receipt: '(SELECT profile_id FROM bank_receipts WHERE id = $1)',
} as const;

interface LockedWalletProfile {
  id: string;
  archived: boolean;
}

// Transaction owners must acquire this before staff, receipt, ledger, wallet or
// invoice row locks. Keep the lock through commit, including nested wallet calls.
export async function lockWalletProfile(
  client: WalletQueryClient,
  source: keyof typeof selectors,
  id: string
): Promise<LockedWalletProfile> {
  const result = await client.query(
    `SELECT id, archived FROM profiles WHERE id = ${selectors[source]} FOR SHARE`,
    [id]
  );
  const profile = result.rows[0] as LockedWalletProfile | undefined;
  if (!profile) throw new NotFoundException('Wallet profile not found');
  return profile;
}

export class WalletProfileArchivedError extends HttpException {
  constructor() {
    super(
      {
        statusCode: 409,
        error: ErrorCodes.CONFLICT_STATE.code,
        message: 'Archived profiles cannot receive wallet balance changes',
      },
      409
    );
  }
}

// Check after matching replay/no-op branches, before any new balance mutation.
export function assertWalletProfileWritable(profile: LockedWalletProfile): void {
  if (profile.archived !== false) throw new WalletProfileArchivedError();
}

export function assertWalletProfileMatches(profile: LockedWalletProfile, profileId: string): void {
  if (profile.id !== profileId.toLowerCase()) {
    throw new ConflictException('Wallet profile changed; retry');
  }
}
