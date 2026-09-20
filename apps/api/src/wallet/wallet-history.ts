import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';

const types = [
  'topup',
  'payment',
  'refund',
  'reservation',
  'release',
  'reversal',
  'compensating',
] as const;
const states = [
  'Pending',
  'Reserved',
  'Completed',
  'Failed',
  'Rejected',
  'Released',
  'Reversed',
] as const;
const timestamp = z.string().datetime({ offset: true });
const querySchema = z
  .object({
    limit: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .transform(Number)
      .pipe(z.number().max(100))
      .optional(),
    type: z.enum(types).optional(),
    state: z.enum(states).optional(),
    from: timestamp.optional(),
    to: timestamp.optional(),
    sort: z.enum(['asc', 'desc']).default('desc'),
    cursor: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to));
const cursorSchema = z
  .object({ v: z.literal(1), scope: z.string(), at: timestamp, id: z.string().uuid() })
  .strict();

function invalid(): never {
  throw new HttpException(
    {
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
      message: 'Invalid wallet history query or cursor',
    },
    400
  );
}

export function parseWalletHistoryQuery(raw: unknown) {
  const result = querySchema.safeParse(raw);
  if (!result.success) invalid();
  return result.data;
}
type HistoryQuery = ReturnType<typeof parseWalletHistoryQuery>;

/** Keyset pagination preserves PostgreSQL microseconds and uses id to break timestamp ties. */
export async function readWalletHistory(
  client: Pick<PoolClient, 'query'>,
  profileId: string,
  query: HistoryQuery
) {
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        profileId,
        query.type ?? null,
        query.state ?? null,
        query.from ?? null,
        query.to ?? null,
        query.sort,
      ])
    )
    .digest('hex');
  const values: unknown[] = [profileId];
  const where = ['wallet_id = $1'];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.type) where.push(`type = ${bind(query.type)}`);
  if (query.state) where.push(`state = ${bind(query.state)}`);
  if (query.from) where.push(`created_at >= ${bind(query.from)}::timestamptz`);
  if (query.to) where.push(`created_at <= ${bind(query.to)}::timestamptz`);
  if (query.cursor) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
    } catch {
      invalid();
    }
    const cursor = cursorSchema.safeParse(decoded);
    if (!cursor.success || cursor.data.scope !== scope) invalid();
    where.push(
      `(created_at, id) ${query.sort === 'asc' ? '>' : '<'} (${bind(cursor.data.at)}::timestamptz, ${bind(cursor.data.id)}::uuid)`
    );
  }
  const limit = query.limit ?? 50;
  const direction = query.sort === 'asc' ? 'ASC' : 'DESC';
  const result = await client.query<{
    id: string;
    type: string;
    amount: string;
    state: string;
    ref_id: string | null;
    description: string | null;
    created_at: string;
  }>(
    `SELECT id, type, amount::text, state, ref_id, description,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM wallet_transactions WHERE ${where.join(' AND ')}
    ORDER BY wallet_transactions.created_at ${direction}, id ${direction} LIMIT ${bind(limit + 1)}`,
    values
  );
  const page = result.rows.slice(0, limit);
  const last = page.at(-1);
  return {
    transactions: page.map((row) => ({
      id: row.id,
      type: row.type,
      amount: row.amount,
      state: row.state,
      refId: row.ref_id,
      description: row.description,
      createdAt: row.created_at,
    })),
    nextCursor:
      result.rows.length > limit && last
        ? Buffer.from(JSON.stringify({ v: 1, scope, at: last.created_at, id: last.id })).toString(
            'base64url'
          )
        : null,
  };
}
