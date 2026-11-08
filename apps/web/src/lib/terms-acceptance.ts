import { withCsrf } from './csrf.js';

export async function acceptReviewedTerms(versionId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await fetch(`/api/tos/accept/${encodeURIComponent(versionId)}`, {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    signal,
  });
  if (!response.ok) return response.status < 500 ? 'denied' : 'unconfirmed';

  const receipt: unknown = await response.json().catch(() => null);
  return receipt &&
    typeof receipt === 'object' &&
    'acceptedVersionId' in receipt &&
    receipt.acceptedVersionId === versionId
    ? 'accepted'
    : 'invalid';
}
