import { withCsrf } from './csrf.js';
import { DocumentRequestError } from './documents.js';
export class RefundReviewError extends DocumentRequestError {
  constructor(
    status: number,
    code: string | null,
    readonly fields: unknown[] | null
  ) {
    super(status, code);
  }
}
export async function requestRefundReview(
  path: string,
  body: object,
  signal: AbortSignal
): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    throw new RefundReviewError(
      response.status,
      typeof code === 'string' ? code : null,
      response.status === 400 &&
        code === 'VALIDATION:INPUT:INVALID' &&
        Array.isArray(data?.error?.fields)
        ? data.error.fields
        : null
    );
  }
  return data;
}
