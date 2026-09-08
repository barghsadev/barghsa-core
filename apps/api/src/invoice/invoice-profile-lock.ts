import { HttpException, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';

const profileSelectors = {
  profile: '$1',
  order: '(SELECT profile_id FROM orders WHERE id=$1)',
  invoice: '(SELECT profile_id FROM invoices WHERE id=$1)',
} as const;

/** Inside a transaction, take this lock before staff, order, invoice or wallet locks.
 * Caller-owned transactions must follow the same order before entering invoice creation.
 */
export async function lockInvoiceProfile(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> },
  source: keyof typeof profileSelectors,
  id: string
): Promise<string> {
  const result = await client.query(
    'SELECT id, archived FROM profiles WHERE id=' + profileSelectors[source] + ' FOR SHARE',
    [id]
  );
  const profile = result.rows[0] as { id: string; archived: boolean } | undefined;
  if (!profile) throw new NotFoundException('Invoice target not found');
  if (profile.archived !== false)
    throw new HttpException(
      {
        statusCode: 409,
        error: ErrorCodes.CONFLICT_STATE.code,
        message: 'Archived profiles cannot receive new invoices',
      },
      409
    );
  return profile.id;
}
