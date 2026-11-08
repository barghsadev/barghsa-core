import { useLayoutEffect, useRef, useState } from 'react';
import { commercialFetch } from '../lib/commercial-fetch.js';
import { withCsrf } from '../lib/csrf.js';
import { electricityOrderReceipt } from '../lib/form-receipt.js';
import { readWithDeadline } from '../lib/server-query-client.js';

type Result =
  | { status: 'confirmed'; receipt: ReturnType<typeof electricityOrderReceipt> }
  | { status: 'unconfirmed' | 'quote-changed' | 'rejected' | 'obsolete' };

/** An ambiguous submission can only replay the exact reviewed order. */
export function useElectricityOrderSubmission(
  mode: 'simple' | 'advanced',
  profileId: string | null
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

  async function send(input: object | undefined, isCurrent: () => boolean): Promise<Result> {
    if (!profileId || attempt.current || !isCurrent()) return { status: 'obsolete' };
    const replay = held.current;
    if (replay ? input || replay.profileId !== profileId : !input) return { status: 'obsolete' };
    if (input) {
      const fingerprint = JSON.stringify(input);
      if (prepared.current?.fingerprint !== fingerprint)
        prepared.current = {
          fingerprint,
          body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
        };
    }
    const body = replay?.body ?? prepared.current?.body;
    if (!body) return { status: 'obsolete' };
    const controller = new AbortController();
    attempt.current = controller;
    const current = () => !controller.signal.aborted && isCurrent();
    try {
      const response = await readWithDeadline(controller.signal, async (signal) => {
        const response = await commercialFetch(`/api/electricity/orders/${mode}`, {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body,
          signal,
        });
        return {
          status: response.status,
          receipt: response.ok ? electricityOrderReceipt(await response.json()) : null,
        };
      });
      if (!current()) return { status: 'obsolete' };
      if (response.receipt) {
        held.current = null;
        setUnconfirmedProfile(null);
        return { status: 'confirmed', receipt: response.receipt };
      }
      if (!replay && [400, 401, 403, 404, 409, 422, 429].includes(response.status))
        return { status: response.status === 409 ? 'quote-changed' : 'rejected' };
    } catch {
      if (!current()) return { status: 'obsolete' };
    } finally {
      if (attempt.current === controller) attempt.current = null;
    }
    held.current = { profileId, body };
    setUnconfirmedProfile(profileId);
    return { status: 'unconfirmed' };
  }

  return { send, unconfirmed: profileId !== null && unconfirmedProfile === profileId };
}
