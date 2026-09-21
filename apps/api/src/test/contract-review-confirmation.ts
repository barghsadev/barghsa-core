const captured = new Map<string, string>();

/** Existing HTTP scenarios capture one review per intent and reuse it on retries.
 * Explicit hashes are left untouched so stale/invalid confirmation tests stay real.
 */
export async function contractReviewConfirmation(
  base: string,
  path: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const input = body as Record<string, unknown>;
  if ('expectedReviewHash' in input || typeof input.expectedVersionId !== 'string') return body;
  const match = /^(admin\/)?contracts\/([^/]+)\/(accept|signature-request|signature)$/.exec(path);
  if (!match) return body;
  const prefix = `${base}/api/${match[1] ?? ''}contracts/${match[2]}`;
  const action = match[3]!;
  const selection =
    action === 'accept'
      ? { expectedVersionId: input.expectedVersionId }
      : action === 'signature-request'
        ? {
            action: 'request',
            expectedVersionId: input.expectedVersionId,
            originalDocumentId: input.originalDocumentId,
            expectedRequestId: input.expectedRequestId,
          }
        : {
            action: 'record',
            expectedVersionId: input.expectedVersionId,
            signedDocumentId: input.signedDocumentId,
            requestId: input.requestId,
          };
  const key = JSON.stringify([prefix, action, selection]);
  let hash = captured.get(key);
  if (!hash) {
    const response = await fetch(
      action === 'accept'
        ? `${prefix}/acceptance-review?versionId=${encodeURIComponent(input.expectedVersionId)}`
        : `${prefix}/signature/review`,
      {
        headers,
        ...(action === 'accept' ? {} : { method: 'POST', body: JSON.stringify(selection) }),
      }
    );
    if (response.ok) {
      const review = (await response.json()) as { hash: string };
      hash = review.hash;
      captured.set(key, hash);
    }
  }
  // Still exercise mutation authorization/validation if the read was forbidden.
  return { ...input, expectedReviewHash: hash ?? captured.get(key) ?? '0'.repeat(64) };
}
