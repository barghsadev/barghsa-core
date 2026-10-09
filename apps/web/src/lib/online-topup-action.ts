import type { OnlineTopUpReview } from '@barghsa/shared/finance';
import { readOnlineTopUpLimitFromErrorBody } from '@barghsa/shared/finance/browser';
import { withCsrf } from './csrf.js';

export type OnlineTopUpActionError =
  'invalid-amount' | 'limit-exceeded' | 'gateway' | 'conflict' | 'maintenance' | 'generic';

type ErrorResult = {
  kind: 'error';
  error: OnlineTopUpActionError;
  enforcedLimit: { onlineTopUpLimit: number; configVersion: number } | null;
};

function errorResult(status: number, payload: unknown): ErrorResult {
  const message = submitErrorMessage(payload);
  const error =
    status === 503
      ? 'maintenance'
      : status === 409
        ? 'conflict'
        : status === 502 || status === 504
          ? 'gateway'
          : status === 400 && /exceeds/i.test(message)
            ? 'limit-exceeded'
            : status === 400
              ? 'invalid-amount'
              : 'generic';
  return {
    kind: 'error',
    error,
    enforcedLimit: error === 'limit-exceeded' ? readOnlineTopUpLimitFromErrorBody(payload) : null,
  };
}

function submitErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const rec = payload as { message?: unknown; error?: unknown };
  if (typeof rec.message === 'string' && rec.message) return rec.message;
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { message?: unknown };
    if (typeof nested.message === 'string' && nested.message) return nested.message;
  }
  return '';
}

function safeGatewayRedirectUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

export async function loadOnlineTopUpReview(
  profileId: string,
  amountIrR: number,
  idempotencyKey: string,
  read: (
    path: string,
    options: RequestInit
  ) => Promise<Pick<Response, 'ok' | 'status' | 'json'>> = fetch
): Promise<
  | ErrorResult
  | {
      kind: 'review';
      review: OnlineTopUpReview;
    }
> {
  const response = await read(`/api/wallet/${profileId}/top-ups/review`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify({ amount: amountIrR, idempotencyKey }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) return errorResult(response.status, payload);
  const { parseOnlineTopUpReview } = await import('@barghsa/shared/finance');
  const review = parseOnlineTopUpReview(payload);
  if (
    !review ||
    review.scope.profileId !== profileId ||
    review.data.profileId !== profileId ||
    review.data.amountIrR !== String(amountIrR)
  )
    return { kind: 'error', error: 'conflict', enforcedLimit: null };
  return { kind: 'review', review };
}

export async function startReviewedOnlineTopUp(
  review: OnlineTopUpReview,
  idempotencyKey: string
): Promise<
  | ErrorResult
  | {
      kind: 'redirect';
      redirectUrl: string;
      transactionId: string | null;
    }
> {
  const response = await fetch(`/api/wallet/${review.data.profileId}/top-ups`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    }),
    body: JSON.stringify({
      amount: review.data.amountIrR,
      expectedReviewHash: review.hash,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    transactionId?: unknown;
    redirectUrl?: unknown;
  };
  if (!response.ok) return errorResult(response.status, payload);
  if (typeof payload.redirectUrl !== 'string' || !safeGatewayRedirectUrl(payload.redirectUrl))
    return { kind: 'error', error: 'gateway', enforcedLimit: null };
  return {
    kind: 'redirect',
    redirectUrl: payload.redirectUrl,
    transactionId: typeof payload.transactionId === 'string' ? payload.transactionId : null,
  };
}
