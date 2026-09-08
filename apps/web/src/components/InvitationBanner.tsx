import { useAccountTime } from '../hooks/useAccountTime.js';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';
import { Button } from '@barghsa/ui';
import { InvitationDetails } from './InvitationDetails.js';
import { withCsrf } from '../lib/csrf.js';

// ─── Types ────────────────────────────────────────────────────────────

export interface PendingInvitation {
  id: string;
  profileId: string;
  profileName: string;
  role: string;
  invitedBy: string;
  inviterName: string | null;
  createdAt: string;
  expiresAt: string | null;
  entity?: { nationalIdentifier: string | null; registrationNumber: string | null };
}

interface PendingInvitationsResponse {
  invitations: PendingInvitation[];
}

interface ActionState {
  accepting: boolean;
  declining: boolean;
  done: boolean;
  doneAction: 'accept' | 'decline' | null;
}

const defaultActionState = (): ActionState => ({
  accepting: false,
  declining: false,
  done: false,
  doneAction: null,
});

// ─── Props ────────────────────────────────────────────────────────────

interface InvitationBannerProps {
  locale?: Locale;
}

// ─── Component ────────────────────────────────────────────────────────

/**
 * InvitationBanner (T-05.04.03).
 *
 * Fetches pending invitations for the current user and shows a banner
 * at the top of dashboard pages when there are pending invitations.
 * Each invitation shows the legal entity name, role, and inviter info,
 * with Accept and Decline buttons.
 */
export function InvitationBanner({ locale = 'fa' }: InvitationBannerProps) {
  const time = useAccountTime(locale);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const router = useRouter();

  const isRtl = locale === 'fa';

  // ── Fetch pending invitations ─────────────────────────────────

  const fetchInvitations = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch('/api/invitations/pending', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 401) {
        setInvitations([]);
        setLoading(false);
        return;
      }

      if (!response.ok) throw new Error('Invitation list unavailable');

      const data: PendingInvitationsResponse = await response.json();
      setInvitations(data.invitations);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const handleDecision = useCallback(
    async (inviteId: string, decision: 'accept' | 'decline') => {
      setActionStates((previous) => ({
        ...previous,
        [inviteId]: {
          ...(previous[inviteId] ?? defaultActionState()),
          accepting: decision === 'accept',
          declining: decision === 'decline',
        },
      }));
      setError(null);
      try {
        const response = await fetch(`/api/invitations/${inviteId}/${decision}`, {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
        });
        if (!response.ok) throw new Error('Invitation decision failed');
        setActionStates((previous) => ({
          ...previous,
          [inviteId]: { accepting: false, declining: false, done: true, doneAction: decision },
        }));
        window.dispatchEvent(new Event('barghsa:profiles-changed'));
        void router.invalidate();
      } catch {
        setError(t('invitation.banner.error', locale));
        setActionStates((previous) => ({
          ...previous,
          [inviteId]: {
            ...(previous[inviteId] ?? defaultActionState()),
            accepting: false,
            declining: false,
          },
        }));
      }
    },
    [locale, router]
  );

  // ── Render ────────────────────────────────────────────────────

  if (loading) return null;
  if (loadError)
    return (
      <div
        role="alert"
        dir={isRtl ? 'rtl' : 'ltr'}
        className="rounded-lg border bg-card p-3 text-card-foreground"
      >
        <p>{t('invitation.banner.loadError', locale)}</p>
        <Button variant="outline" onClick={() => void fetchInvitations()}>
          {t('team.retry', locale)}
        </Button>
      </div>
    );
  if (invitations.length === 0) {
    return null;
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      {time.notice}
      {error && (
        <div
          className="bg-red-50 border border-red-200 shadow-sm rounded-lg px-4 py-2 text-sm text-red-700 mb-2"
          role="alert"
        >
          {error}
        </div>
      )}

      {invitations.map((inv) => {
        const state = actionStates[inv.id] ?? defaultActionState();

        if (state.done) {
          return (
            <div
              key={inv.id}
              className="bg-green-50 border border-green-200 shadow-sm rounded-lg px-4 py-3 text-sm text-green-800"
              role="alert"
            >
              {state.doneAction === 'accept'
                ? t('invitation.banner.accepted', locale)
                : t('invitation.banner.declined', locale)}
            </div>
          );
        }

        const displayDate = time.format(inv.createdAt, { dateStyle: 'medium' });

        return (
          <div
            key={inv.id}
            className="bg-blue-50 border border-blue-200 shadow-sm rounded-lg px-4 py-3 text-sm"
            role="alert"
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-blue-900">
                  {t('invitation.banner.title', locale)
                    .replace('{entity}', inv.profileName)
                    .replace('{role}', t(`team.${inv.role}`, locale))}
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-700">
                  <span>
                    {t('invitation.banner.invitedBy', locale).replace(
                      '{name}',
                      inv.inviterName ?? inv.invitedBy
                    )}
                  </span>
                  <span>{t('invitation.banner.date', locale).replace('{date}', displayDate)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleDecision(inv.id, 'accept')}
                  disabled={state.accepting || state.declining}
                >
                  {state.accepting
                    ? t('invitation.banner.accepting', locale)
                    : t('invitation.banner.accept', locale)}
                </Button>
                <Button
                  variant="outline"
                  className="bg-background text-foreground"
                  size="sm"
                  onClick={() => handleDecision(inv.id, 'decline')}
                  disabled={state.accepting || state.declining}
                >
                  {state.declining
                    ? t('invitation.banner.declining', locale)
                    : t('invitation.banner.decline', locale)}
                </Button>
              </div>
            </div>
            <InvitationDetails details={inv} locale={locale} />
          </div>
        );
      })}
    </div>
  );
}
