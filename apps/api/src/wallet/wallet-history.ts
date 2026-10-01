import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { readWalletBankReceiptHistory } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  parseHistoryQuery,
  parseNumberRange,
  literalSearchPattern,
} from '@barghsa/shared/validation';

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
const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    const day = value.slice(0, 10);
    const parsed = new Date(`${day}T00:00:00.000Z`);
    const offset = value.match(/[+-](\d{2}):?(\d{2})$/);
    const validOffset = !offset || (Number(offset[1]) <= 15 && Number(offset[2]) <= 59);
    return (
      validOffset &&
      Number.isFinite(Date.parse(value)) &&
      !day.startsWith('0000') &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === day
    );
  });
/** Compare accepted ISO instants without dropping PostgreSQL's fractional precision. */
function compareInstants(left: string, right: string): number {
  const split = (value: string) => {
    const fraction = value.match(/\.(\d+)(?=Z|[+-]\d{2}:?\d{2}$)/)?.[1] ?? '';
    return { second: Date.parse(value.replace(/\.\d+(?=Z|[+-]\d{2}:?\d{2}$)/, '')), fraction };
  };
  const a = split(left);
  const b = split(right);
  if (a.second !== b.second) return a.second - b.second;
  const precision = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(precision, '0');
  const bf = b.fraction.padEnd(precision, '0');
  return af === bf ? 0 : af < bf ? -1 : 1;
}
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
    until: timestamp.optional(),
    q: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
    sort: z.enum(['asc', 'desc']).default('desc'),
    cursor: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || compareInstants(q.from, q.to) <= 0)
  .refine((q) => !q.from || !q.until || compareInstants(q.from, q.until) < 0)
  .refine((q) => q.to === undefined || q.until === undefined)
  .refine((q) => parseHistoryQuery(q.q, undefined) !== null)
  .refine((q) => parseNumberRange(q.min, q.max) !== null);
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
  const search = parseHistoryQuery(result.data.q, undefined)!;
  const amount = parseNumberRange(result.data.min, result.data.max)!;
  return { ...result.data, q: search.q, ...amount };
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
        // Preserve legacy cursors when no newly introduced criterion is active.
        ...(query.q || query.min !== undefined || query.max !== undefined || query.until
          ? [
              {
                q: query.q,
                min: query.min ?? null,
                max: query.max ?? null,
                until: query.until ?? null,
              },
            ]
          : []),
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
  if (query.until) where.push(`created_at < ${bind(query.until)}::timestamptz`);
  if (query.min !== undefined) where.push(`abs(amount::numeric) >= ${bind(query.min)}::numeric`);
  if (query.max !== undefined) where.push(`abs(amount::numeric) <= ${bind(query.max)}::numeric`);
  if (query.q) {
    const pattern = bind(literalSearchPattern(query.q));
    where.push(`(id::text ILIKE ${pattern} ESCAPE E'\\\\'
        OR ref_id::text ILIKE ${pattern} ESCAPE E'\\\\'
        OR description ILIKE ${pattern} ESCAPE E'\\\\'
        OR (type = 'topup' AND state IN ('Pending','Released','Rejected')
          AND metadata->>'channel' = 'bank_receipt' AND NOT (metadata ? 'pendingTransactionId')
          AND (metadata#>>'{receipt,bankName}' ILIKE ${pattern} ESCAPE E'\\\\'
            OR metadata#>>'{receipt,payerReference}' ILIKE ${pattern} ESCAPE E'\\\\'))) `);
  }
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
    metadata: unknown;
  }>(
    `SELECT id, type, amount::text, state, ref_id, description, metadata,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM wallet_transactions WHERE ${where.join(' AND ')}
    ORDER BY wallet_transactions.created_at ${direction}, id ${direction} LIMIT ${bind(limit + 1)}`,
    values
  );
  const page = result.rows.slice(0, limit);
  const last = page.at(-1);
  return {
    transactions: page.map((row) => {
      const bankReceipt = readWalletBankReceiptHistory({
        type: row.type,
        state: row.state,
        createdAt: row.created_at,
        metadata: row.metadata,
      });
      return {
        id: row.id,
        type: row.type,
        amount: row.amount,
        state: row.state,
        refId: row.ref_id,
        description: row.description,
        createdAt: row.created_at,
        ...(bankReceipt ? { bankReceipt } : {}),
      };
    }),
    nextCursor:
      result.rows.length > limit && last
        ? Buffer.from(JSON.stringify({ v: 1, scope, at: last.created_at, id: last.id })).toString(
            'base64url'
          )
        : null,
  };
}
