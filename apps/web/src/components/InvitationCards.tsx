import { t, type Locale } from '@barghsa/i18n/workspace';
import { Button } from '@barghsa/ui';
import { InvitationDetails } from './InvitationDetails.js';
import type { PendingInvitation } from '../lib/invitation-api.js';
import type { useAccountTime } from '../hooks/useAccountTime.js';

// Loaded only after the account has a validated invitation to display.
export function InvitationCards({
  invitations,
  completed,
  locale,
  time,
  paused,
  operation,
  run,
}: {
  invitations: PendingInvitation[];
  completed: { target: PendingInvitation; decision: 'accept' | 'decline' }[];
  locale: Locale;
  time: Pick<ReturnType<typeof useAccountTime>, 'format'>;
  paused: boolean;
  operation: string | null;
  run: (target: PendingInvitation, action: 'accept' | 'decline' | 'open') => Promise<void>;
}) {
  return (
    <>
      {invitations.map((inv) => (
        <div
          key={inv.id}
          role="alert"
          className="rounded-xl border bg-card p-4 text-card-foreground"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 flex flex-col gap-2 [overflow-wrap:anywhere]">
              <p className="font-semibold">
                {t('invitation.banner.title', locale)
                  .replace('{entity}', inv.profileName)
                  .replace('{role}', t(`team.${inv.role}`, locale))}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t('invitation.banner.invitedBy', locale).replace(
                    '{name}',
                    inv.inviterName ?? t('invitation.banner.unknownInviter', locale)
                  )}
                </span>
                <span>
                  {t('invitation.banner.date', locale).replace(
                    '{date}',
                    time.format(inv.createdAt, { dateStyle: 'medium' })
                  )}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={paused}
                onClick={() => void run(inv, 'accept')}
              >
                {t(
                  operation === `${inv.id}:accept`
                    ? 'invitation.banner.accepting'
                    : 'invitation.banner.accept',
                  locale
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={paused}
                onClick={() => void run(inv, 'decline')}
              >
                {t(
                  operation === `${inv.id}:decline`
                    ? 'invitation.banner.declining'
                    : 'invitation.banner.decline',
                  locale
                )}
              </Button>
            </div>
          </div>
          <InvitationDetails details={inv} locale={locale} time={time} />
        </div>
      ))}
      {completed.map(({ target, decision }) => (
        <div
          key={target.id}
          className="rounded-xl border bg-card p-4 text-card-foreground flex flex-wrap items-center justify-between gap-4"
        >
          <div
            role="status"
            className="min-w-0 flex-1 flex flex-col gap-1 [overflow-wrap:anywhere]"
          >
            <p className="font-semibold">{target.profileName}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                decision === 'accept' ? 'invitation.banner.accepted' : 'invitation.banner.declined',
                locale
              )}
            </p>
          </div>
          {decision === 'accept' && (
            <Button
              type="button"
              size="sm"
              disabled={paused}
              onClick={() => void run(target, 'open')}
            >
              {t(
                operation === `${target.id}:open`
                  ? 'invitation.banner.opening'
                  : 'invitation.banner.open',
                locale
              )}
            </Button>
          )}
        </div>
      ))}
    </>
  );
}
