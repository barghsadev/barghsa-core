import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';
import { Button } from '@barghsa/ui';
import { refreshProfileContext } from '../lib/profile-context.js';
import {
  isPendingInvitations,
  type PendingInvitation,
  type PendingInvitationsResponse,
} from '../lib/invitation-api.js';

const InvitationCards = lazy(() =>
  import('./InvitationCards.js').then((module) => ({ default: module.InvitationCards }))
);

interface InvitationBannerProps {
  locale?: Locale;
  accountId?: string;
}
interface CompletedDecision {
  target: PendingInvitation;
  decision: 'accept' | 'decline';
}

export function InvitationBanner({ locale = 'fa', accountId }: InvitationBannerProps) {
  const currentAccount = useAccountUser();
  const account = accountId ?? currentAccount;
  return account ? <AccountInvitations key={account} locale={locale} /> : null;
}

function AccountInvitations({ locale }: { locale: Locale }) {
  const time = useAccountTime(locale);
  const router = useRouter();
  const [completed, setCompleted] = useState<CompletedDecision[]>([]);
  const [operation, setOperation] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    data: PendingInvitationsResponse | null;
    kind: 'decision' | 'open';
  } | null>(null);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const clear = useCallback(() => {
    request.current?.abort();
    busy.current = false;
    setOperation(null);
    setCompleted([]);
    setFailure(null);
  }, []);
  const scope = useCatalogueScope(clear);
  const resource = useCatalogueResource(scope, '/api/invitations/pending', isPendingInvitations);
  const failed = !!failure && failure.data === resource.data;
  const paused = operation !== null || resource.loading || resource.error || failed || scope.denied;
  const completedIds = new Set(completed.map((c) => c.target.id));
  const invitations = resource.data?.invitations.filter((i) => !completedIds.has(i.id)) ?? [];

  async function run(target: PendingInvitation, action: 'accept' | 'decline' | 'open') {
    if (busy.current || paused) return;
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    const epoch = scope.live.current;
    const current = () => !controller.signal.aborted && scope.live.current === epoch;
    setOperation(`${target.id}:${action}`);
    setFailure(null);
    try {
      const { invitationAction } = await import('../lib/invitation-action.js');
      if (!current()) return;
      const result = await invitationAction(target, action, controller.signal);
      if (!current()) return;
      if (result.denied) {
        scope.deny();
        return;
      }
      if (action === 'open') {
        refreshProfileContext();
        await router.navigate({ to: '/app' });
      } else {
        setCompleted((previous) => [...previous, { target, decision: action }]);
        if (action === 'accept') {
          window.dispatchEvent(new Event('barghsa:profiles-changed'));
          void router.invalidate();
        }
      }
    } catch {
      if (current())
        setFailure({ data: resource.data, kind: action === 'open' ? 'open' : 'decision' });
    } finally {
      if (current()) {
        busy.current = false;
        setOperation(null);
      }
    }
  }

  if (
    !scope.denied &&
    !resource.loading &&
    !resource.error &&
    !failed &&
    !invitations.length &&
    !completed.length
  )
    return null;
  return (
    <section
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="flex flex-col gap-3"
      aria-label={t('invitation.banner.heading', locale)}
    >
      {time.notice}
      {(scope.denied || resource.error || failed) && (
        <div
          role="alert"
          className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col items-start gap-3"
        >
          <p className="text-sm">
            {t(
              scope.denied
                ? 'invitation.banner.denied'
                : resource.error
                  ? 'invitation.banner.loadError'
                  : failure?.kind === 'open'
                    ? 'invitation.banner.openError'
                    : 'invitation.banner.error',
              locale
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={operation !== null || resource.loading}
            onClick={() => (scope.denied ? scope.recover() : resource.retry())}
          >
            {t('team.retry', locale)}
          </Button>
        </div>
      )}
      {resource.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('invitation.banner.loading', locale)}
        </p>
      )}
      {(!!invitations.length || !!completed.length) && (
        <Suspense fallback={<p role="status">{t('invitation.banner.loading', locale)}</p>}>
          <InvitationCards
            invitations={invitations}
            completed={completed}
            locale={locale}
            time={time}
            paused={paused}
            operation={operation}
            run={run}
          />
        </Suspense>
      )}
      {!!resource.data && (!!invitations.length || !!completed.length) && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={operation !== null || resource.loading}
            onClick={resource.retry}
          >
            {t('invitation.banner.refresh', locale)}
          </Button>
        </div>
      )}
    </section>
  );
}
