import { useAccountTime } from '../hooks/useAccountTime.js';
import { t, type Locale } from '@barghsa/i18n/app';

import type { PendingInvitation } from './InvitationBanner.js';

export function InvitationDetails({
  details,
  locale,
}: {
  details: PendingInvitation;
  locale: Locale;
}) {
  const time = useAccountTime(locale);
  const isRtl = locale === 'fa';
  return (
    <details
      dir={isRtl ? 'rtl' : 'ltr'}
      className="mt-3 rounded border bg-card p-3 text-card-foreground"
    >
      <summary className="cursor-pointer font-medium">
        {t('invitation.details.view', locale)}
      </summary>
      <p className="my-3">{t(`invitation.details.${details.role}`, locale)}</p>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium">{t('invitation.details.inviter', locale)}</dt>
          <dd>{details.inviterName ?? t('invitation.details.unavailable', locale)}</dd>
        </div>
        {details.entity?.nationalIdentifier && (
          <div>
            <dt className="font-medium">{t('invitation.details.nationalIdentifier', locale)}</dt>
            <dd>
              <bdi dir="ltr">{details.entity.nationalIdentifier}</bdi>
            </dd>
          </div>
        )}
        {details.entity?.registrationNumber && (
          <div>
            <dt className="font-medium">{t('invitation.details.registrationNumber', locale)}</dt>
            <dd>
              <bdi dir="ltr">{details.entity.registrationNumber}</bdi>
            </dd>
          </div>
        )}
        <div>
          <dt className="font-medium">{t('invitation.details.date', locale)}</dt>
          <dd>
            <time dateTime={details.createdAt}>
              {time.format(details.createdAt, { dateStyle: 'medium' })}
            </time>
          </dd>
        </div>
        {details.expiresAt && (
          <div>
            <dt className="font-medium">{t('team.expires', locale)}</dt>
            <dd>
              <time dateTime={details.expiresAt}>
                {time.format(details.expiresAt, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            </dd>
          </div>
        )}
      </dl>
    </details>
  );
}
