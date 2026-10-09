import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';

/** Native wallet quotes and readonly saving/solar previews; never financial commands. */
export function useOwnedFinancialRead(
  actor: string | null,
  revision: number,
  readScope: string,
  profileId?: string
) {
  const identity = JSON.stringify([actor, revision, readScope, profileId]);
  const client = useQueryClient();
  const reader = useId();
  const latest = useRef(identity);
  latest.current = identity;
  const alive = useRef(true);
  const sequence = useRef(0);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    const owned = requests.current;
    return () => {
      alive.current = false;
      for (const controller of owned) controller.abort();
      owned.clear();
    };
  }, [client, identity]);
  return useCallback(
    async (
      path: string,
      options: RequestInit = {},
      decodeErrors = false,
      invalidJson: unknown = null
    ) => {
      const url = new URL(path, 'http://barghsa.local');
      const wallet = /^\/api\/invoices\/[^/?]+\/wallet-payment$/.test(url.pathname);
      const saving =
        /^\/api\/staff\/saving\/orders\/[^/?]+\/(?:financial-review|amend-hardware-review|cancel-hardware-upgrade-review|stages\/[^/?]+\/(?:complete|skip)\/review)$/.test(
          url.pathname
        );
      const solar = /^\/api\/admin\/solar\/requests\/[^/?]+\/create-contract\/review$/.test(
        url.pathname
      );
      const consultation =
        /^\/api\/admin\/consultations\/requests\/[^/?]+\/(?:fee-review|paid-fee-review|paid-resolution-review)$/.test(
          url.pathname
        );
      const topup = /^\/api\/wallet\/([^/?]+)\/(?:top-ups|bank-receipt-top-ups)\/review$/.exec(
        url.pathname
      );
      const savingCustomer = /^\/api\/saving\/orders\/[^/?]+\/change-quote$/.test(url.pathname);
      const method = options.method ?? 'GET';
      if (
        !path.startsWith('/api/') ||
        !(wallet
          ? method === 'GET' && options.body === undefined
          : (saving || solar || consultation || topup || savingCustomer) && method === 'POST')
      )
        throw new Error('Invalid financial read');
      const external = options.signal;
      const authority = {
        context: wallet
          ? ('account' as const)
          : topup || savingCustomer
            ? ('customer' as const)
            : ('staff' as const),
        ownerId: topup
          ? topup[1]!
          : savingCustomer
            ? (profileId ?? actor ?? 'account-session')
            : (actor ?? 'account-session'),
        accountId: actor,
        revision,
      };
      const key = wallet
        ? queryKeys.invoices.detail(authority, path)
        : saving || savingCustomer
          ? queryKeys.saving.detail(authority, path)
          : consultation
            ? queryKeys.consultations.detail(authority, path)
            : topup
              ? queryKeys.wallet.detail(authority, path)
              : queryKeys.solar.detail(authority, path);
      const controller = new AbortController();
      const queryKey: ServerQueryKey = [...key, JSON.stringify([reader, path, ++sequence.current])];
      const cancel = () => void client.cancelQueries({ queryKey, exact: true });
      const abort = () => controller.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      external?.addEventListener('abort', abort, { once: true });
      requests.current.add(controller);
      const current = () =>
        alive.current &&
        latest.current === identity &&
        !controller.signal.aborted &&
        !external?.aborted;
      try {
        if (!current()) throw new Error('Obsolete financial read');
        const packet = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const ownedSignal = external ? AbortSignal.any([external, signal]) : signal;
            const response = await fetch(path, { ...options, signal: ownedSignal });
            if (!current() || signal.aborted) throw new Error('Obsolete financial read');
            const data =
              response.ok ||
              (decodeErrors && (!saving || ![401, 403, 404].includes(response.status)))
                ? decodeErrors
                  ? ((await response.json().catch(() => invalidJson)) as unknown)
                  : ((await response.json()) as unknown)
                : null;
            if (!current() || signal.aborted) throw new Error('Obsolete financial read');
            return { ok: response.ok, status: response.status, data };
          },
        });
        if (!current()) throw new Error('Obsolete financial read');
        return { ok: packet.ok, status: packet.status, json: async () => packet.data };
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        external?.removeEventListener('abort', abort);
        requests.current.delete(controller);
      }
    },
    [client, identity, reader, actor, revision, profileId]
  );
}
