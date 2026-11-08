import { useLayoutEffect, useRef, useState } from 'react';
import { commercialFetch } from '../lib/commercial-fetch.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';

type Result<Receipt> =
  | { status: 'confirmed'; receipt: Receipt }
  | { status: 'unconfirmed' | 'conflict' | 'rejected' | 'obsolete' };

/** An ambiguous submission can only replay the exact reviewed request. */
export function useReviewedSubmission<Receipt>(
  path: string,
  profileId: string | null,
  parseReceipt: (value: unknown) => Receipt,
  { addIdempotencyKey = false } = {}
) {
  const attempt = useRef<AbortController | null>(null);
  const held = useRef<{ profileId: string; body: string } | null>(null);
  const prepared = useRef<{ fingerprint: string; body: string } | null>(null);
  const [unconfirmedProfile, setUnconfirmedProfile] = useState<string | null>(null);
  useLayoutEffect(() => {
    setUnconfirmedProfile(null);
    return () => {
      attempt.current?.abort();
      attempt.current = null;
      held.current = null;
      prepared.current = null;
    };
  }, [profileId]);

  async function send(
    input: object | undefined,
    isCurrent: () => boolean
  ): Promise<Result<Receipt>> {
    if (!profileId || attempt.current || !isCurrent()) return { status: 'obsolete' };
    const replay = held.current;
    if (replay ? input || replay.profileId !== profileId : !input) return { status: 'obsolete' };
    if (input) {
      const fingerprint = JSON.stringify(input);
      if (prepared.current?.fingerprint !== fingerprint)
        prepared.current = {
          fingerprint,
          body: addIdempotencyKey
            ? JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() })
            : fingerprint,
        };
    }
    const body = replay?.body ?? prepared.current?.body;
    if (!body) return { status: 'obsolete' };
    const controller = new AbortController();
    attempt.current = controller;
    const current = () => !controller.signal.aborted && isCurrent();
    try {
      const response = await readWithDeadline(controller.signal, async (signal) => {
        const response = await commercialFetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body,
          signal,
        });
        return {
          status: response.status,
          receipt: response.ok ? parseReceipt(await response.json()) : null,
        };
      });
      if (!current()) return { status: 'obsolete' };
      if (response.receipt !== null) {
        held.current = null;
        setUnconfirmedProfile(null);
        return { status: 'confirmed', receipt: response.receipt };
      }
      if (!replay && [400, 401, 403, 404, 409, 422, 429].includes(response.status))
        return { status: response.status === 409 ? 'conflict' : 'rejected' };
    } catch {
      if (!current()) return { status: 'obsolete' };
    } finally {
      if (attempt.current === controller) attempt.current = null;
    }
    held.current = { profileId, body };
    setUnconfirmedProfile(profileId);
    return { status: 'unconfirmed' };
  }

  return {
    send,
    resetPreparation() {
      if (!held.current && !attempt.current) prepared.current = null;
    },
    unconfirmed: profileId !== null && unconfirmedProfile === profileId,
  };
}
