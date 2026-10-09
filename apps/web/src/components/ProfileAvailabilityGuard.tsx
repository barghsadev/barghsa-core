import { useEffect, useId, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';

/** Mounted only on customer routes requiring a profile by the root route. */
export function ProfileAvailabilityGuard({
  accountId,
  pathname,
  revision,
}: {
  accountId: string | null;
  pathname: string;
  revision: number;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const reader = useId();
  const sequence = useRef(0);
  useEffect(() => {
    // App routes block rendering in their beforeLoad guard; do not repeat that request here.
    if (pathname === '/app' || pathname.startsWith('/app/')) return;
    const controller = new AbortController();
    const key = queryKeys.profiles.authority(
      { context: 'account', ownerId: accountId ?? 'current-session', accountId, revision },
      JSON.stringify([reader, 'navigation-profile-check', pathname, ++sequence.current])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    async function check() {
      try {
        const response = await client.fetchQuery({
          queryKey: key,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const response = await fetch('/api/profiles', {
              method: 'GET',
              signal,
              credentials: 'include',
              headers: { Accept: 'application/json' },
            });
            return {
              status: response.status,
              ok: response.ok,
              data: response.ok
                ? ((await response.json()) as {
                    profiles: Array<{ id: string; isDefault: boolean }>;
                    hasDefault: boolean;
                    activeProfileId: string | null;
                  })
                : null,
            };
          },
        });
        // Not authenticated — no redirect needed
        if (response.status === 401) return;
        if (!response.ok) {
          console.warn('[profile guard] non-401 response', response.status);
          return;
        }
        const data = response.data;
        // No profiles → redirect to onboarding
        if (controller.signal.aborted) return;
        if (data!.profiles.length === 0) {
          router.navigate({ to: '/onboarding', replace: true });
          return;
        }
        // An unavailable explicit context must be selected again by the user.
        // Profile creation already establishes the initial default on the server.
        // Multiple profiles — proceed normally
      } catch (error) {
        if (!controller.signal.aborted) console.warn('[profile guard] network error', error);
      }
    }
    void check();
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [pathname, router, revision, accountId, client, reader]);
  return null;
}
