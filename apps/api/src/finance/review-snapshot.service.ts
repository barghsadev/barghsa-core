import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { FinancialReviewScope, FinancialReviewSnapshot } from '@barghsa/shared/finance';

/** Reject values that JSON would silently omit, round or replace. */
function canonical(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new TypeError('Financial review requires finite, exact JSON values');
    return value;
  }
  if (typeof value !== 'object' || ancestors.has(value))
    throw new TypeError('Financial review requires acyclic JSON values');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Financial review requires plain JSON objects');
  ancestors.add(value);
  const result = Array.isArray(value)
    ? Array.from(value, (item) => canonical(item, ancestors))
    : Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical((value as Record<string, unknown>)[key], ancestors)])
      );
  ancestors.delete(value);
  return result;
}

function conflict(): never {
  throw new ConflictException({ error: ErrorCodes.CONFLICT_STATE.code });
}

/** Command adapters supply authoritative data while holding their transaction's locks. */
@Injectable()
export class ReviewSnapshotService {
  create<T extends object>(scope: FinancialReviewScope, data: T): FinancialReviewSnapshot<T> {
    if (!scope.action.trim() || !scope.profileId || !scope.resourceId)
      throw new TypeError('Financial review requires a complete command scope');
    const body = canonical({ schemaVersion: 1, scope, data }) as Omit<
      FinancialReviewSnapshot<T>,
      'hash'
    >;
    return {
      ...body,
      hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    };
  }

  assertConfirmed(snapshot: FinancialReviewSnapshot<object>, expectedHash: string): void {
    if (
      !/^[a-f0-9]{64}$/.test(expectedHash) ||
      snapshot.schemaVersion !== 1 ||
      snapshot.hash !== expectedHash ||
      this.create(snapshot.scope, snapshot.data).hash !== expectedHash
    )
      conflict();
  }

  /** Replay checks the persisted pre-payment review, not today's changed invoice/balance. */
  assertStored(
    metadata: unknown,
    expectedHash: string,
    scope: FinancialReviewScope
  ): FinancialReviewSnapshot<object> {
    try {
      const stored = (metadata as { financialReview?: FinancialReviewSnapshot<object> } | null)
        ?.financialReview;
      if (
        !stored ||
        stored.scope.action !== scope.action ||
        stored.scope.profileId !== scope.profileId ||
        stored.scope.resourceId !== scope.resourceId
      )
        conflict();
      this.assertConfirmed(stored, expectedHash);
      return stored;
    } catch {
      return conflict();
    }
  }
}
