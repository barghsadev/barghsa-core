import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';

export function OwnershipBanner() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedOwnershipBanner key={JSON.stringify([actor, revision])} />;
}
function OwnedOwnershipBanner() {
  const client = useQueryClient();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const reader = useId();
  const sequence = useRef(0);
  const locale = useLocale();
  const { pathname } = useLocation();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const key = queryKeys.profiles.authority(
      { context: 'account', ownerId: actor ?? 'current-session', accountId: actor, revision },
      JSON.stringify([reader, 'ownership-transfers', pathname, ++sequence.current])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    setPending(false);
    void client
      .fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: async ({ signal }) => {
          const response = await fetch('/api/profiles/ownership-transfers', {
            credentials: 'include',
            signal,
          });
          if (response.ok) return response.json();
          return null;
        },
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setPending(
            data?.transfers?.some((item: { direction: string }) => item.direction === 'incoming') ??
              false
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [pathname, client, actor, revision, reader]);
  if (!pending || pathname === '/settings/team') return null;
  return (
    <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-sm" role="status">
      <Link to="/settings/team" className="text-blue-900 underline">
        {t('team.banner', locale)}
      </Link>
    </div>
  );
}
