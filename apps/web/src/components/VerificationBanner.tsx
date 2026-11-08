import { feedbackText } from '@barghsa/i18n/feedback';
import { useManualServerRead } from '../hooks/useServerQuery.js';
import { queryKeys } from '../lib/query-keys.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { useEffect, useState } from 'react';
import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';
import { WaitingForBarghsa } from '@barghsa/ui';
import { workflowFeedback } from '@barghsa/i18n/workflow-feedback';
import { useAccountTime } from '../hooks/useAccountTime.js';

interface VerificationStatusResponse {
  activeProfileId: string | null;
  profileStatus: string | null;
  isVerified: boolean;
  verificationRequired: boolean;
  verificationMethod: 'api' | 'manual';
  canAutoVerify: boolean;
  verificationSubmittedAt?: string | null;
  verificationNotice?: {
    id: string;
    localizedContent: Record<string, { title: string; body: string }>;
  } | null;
}

/**
 * VerificationBanner (T-03.01.02).
 *
 * Fetches the profile verification status from the API and shows a
 * dismissible banner when the active profile is not verified and the
 * system requires verification. Includes an auto-verify button when
 * the verification method is 'api'.
 *
 * Renders nothing when:
 * - The user is not authenticated (API returns 401)
 * - The profile is already verified
 * - Verification is not required by the system
 */
export function VerificationBanner({ accountId = null }: { accountId?: string | null } = {}) {
  const revision = useProfileContextRevision();
  return (
    <OwnedVerificationBanner
      key={JSON.stringify([accountId, revision])}
      accountId={accountId}
      revision={revision}
    />
  );
}
function OwnedVerificationBanner({
  accountId,
  revision,
}: {
  accountId: string | null;
  revision: number;
}) {
  const read = useManualServerRead();
  const [status, setStatus] = useState<VerificationStatusResponse | null>(null);
  const [verification, setVerification] = useState<'idle' | 'working' | 'verified' | 'error'>(
    'idle'
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });

  const locale = useLocale();
  const dir = locale === 'fa' ? 'rtl' : 'ltr';
  const copy = (key: string) => t(`verification.banner.${key}`, locale);

  useEffect(() => {
    const controller = new AbortController();
    const key = queryKeys.profiles.authority(
      { context: 'account', ownerId: accountId ?? 'current-session', accountId, revision },
      JSON.stringify(['verification-status', pathname, locale])
    );
    setStatus(null);

    void read(key, controller.signal, async (signal) => {
      const response = await fetch('/api/profiles/verification-status', {
        credentials: 'include',
        signal,
        headers: { Accept: 'application/json', 'Accept-Language': locale },
      });
      return response.ok ? ((await response.json()) as VerificationStatusResponse) : null;
    })
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch(() => {
        // The previous status was cleared before the read.
      });
    return () => controller.abort();
  }, [locale, pathname, read, accountId, revision]);

  // Don't render anything while loading, or if no status data, or if dismissed
  if (!status) return null;

  const notice = status.verificationNotice;
  const noticeContent = notice?.localizedContent?.[locale];
  const noticeKey =
    notice &&
    typeof notice.id === 'string' &&
    typeof noticeContent?.title === 'string' &&
    typeof noticeContent?.body === 'string'
      ? notice.id
      : null;
  const bannerKey = noticeKey ?? status.activeProfileId;
  if (!bannerKey || dismissed === bannerKey) return null;
  if (
    status.profileStatus === 'PENDING_VERIFICATION' &&
    !status.isVerified &&
    status.verificationRequired
  ) {
    return (
      <VerificationWaiting
        status={status}
        locale={locale}
        title={noticeContent?.title}
        body={noticeContent?.body}
        onDismiss={() => setDismissed(bannerKey)}
      />
    );
  }
  if (noticeKey && noticeContent) {
    return (
      <section
        data-testid="verification-notice"
        role={status.isVerified ? 'status' : 'alert'}
        dir={dir}
        className="border-b border-border bg-muted px-4 py-3 text-sm text-foreground"
      >
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="font-medium">{noticeContent.title}</p>
            <p className="whitespace-pre-line break-words">{noticeContent.body}</p>
            <VerificationLinks
              locale={locale}
              compact
              support={status.isVerified ? null : copy('support')}
            />
          </div>
          <button
            type="button"
            onClick={() => setDismissed(noticeKey)}
            aria-label={copy('dismiss')}
            className="shrink-0 rounded p-1 focus-visible:outline-2 focus-visible:outline-ring"
          >
            ✕
          </button>
        </div>
      </section>
    );
  }

  // Don't render if profile is verified or verification is not required
  if (status.isVerified || !status.verificationRequired) return null;

  const profileId = status.activeProfileId;
  if (!profileId) return null;

  async function handleAutoVerify() {
    setVerification('working');

    try {
      const response = await fetch(`/api/profiles/${profileId}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json', 'Accept-Language': locale }),
      });

      if (response.ok) {
        setVerification('verified');
        // Refresh the page after a brief delay to reflect the new status
        setTimeout(() => {
          router.invalidate();
        }, 1500);
      } else {
        setVerification('error');
      }
    } catch {
      setVerification('error');
    }
  }

  const verified = verification === 'verified';
  return (
    <div
      className={
        verified
          ? 'bg-success-soft border-success/20 border px-4 py-3 text-sm text-success'
          : 'bg-warning-soft border-warning/20 border-b px-4 py-3 text-sm text-warning'
      }
      role="alert"
      dir={dir}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        {verified ? (
          <span>{copy('verified')}</span>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span>{copy('title')}</span>
              {!status.canAutoVerify && <span className="text-xs">{copy('manualHelp')}</span>}
              <Link to="/tickets" className="text-xs underline underline-offset-2">
                {copy('support')}
              </Link>
              {verification === 'error' && (
                <span className="text-xs text-destructive">{copy('error')}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {status.canAutoVerify && (
                <button
                  onClick={handleAutoVerify}
                  disabled={verification === 'working'}
                  className="min-h-11 rounded bg-foreground px-3 py-1 text-xs font-medium text-background hover:underline disabled:opacity-50"
                >
                  {copy(verification === 'working' ? 'verifying' : 'verify')}
                </button>
              )}
              <button
                onClick={() => setDismissed(bannerKey)}
                className="text-warning hover:underline"
                aria-label={copy('dismiss')}
              >
                ✕
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VerificationLinks({
  locale,
  support,
  compact = false,
}: {
  locale: 'en' | 'fa';
  support: string | null;
  compact?: boolean;
}) {
  const linkClass = compact ? 'underline underline-offset-2' : 'underline';
  return (
    <div className={compact ? 'flex flex-wrap gap-4 text-xs' : 'flex flex-wrap gap-4'}>
      <Link to="/settings/profile" className={linkClass}>
        {t('settings.profile.title', locale)}
      </Link>
      {support && (
        <Link to="/tickets" className={linkClass}>
          {support}
        </Link>
      )}
      <Link to="/notifications" className={linkClass}>
        {t('notifications.viewAll', locale)}
      </Link>
    </div>
  );
}

function VerificationWaiting({
  status,
  locale,
  title,
  body,
  onDismiss,
}: {
  status: VerificationStatusResponse;
  locale: 'en' | 'fa';
  title: string | undefined;
  body: string | undefined;
  onDismiss: () => void;
}) {
  const time = useAccountTime(locale);
  return (
    <section
      data-testid="verification-notice"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="relative border-b px-4 py-3 pe-16"
    >
      {time.notice}
      <WaitingForBarghsa
        title={workflowFeedback('waiting', locale)}
        description={body ?? t('verification.banner.manualHelp', locale)}
        update={title ?? t('verification.banner.title', locale)}
        submittedAt={
          status.verificationSubmittedAt
            ? `${workflowFeedback('submitted', locale)}: ${time.format(status.verificationSubmittedAt)}`
            : workflowFeedback('submissionUnknown', locale)
        }
        expectedResponse={workflowFeedback('responseUnknown', locale)}
        help={<VerificationLinks locale={locale} support={feedbackText('support', locale)} />}
      />
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('verification.banner.dismiss', locale)}
        className="absolute end-5 top-5 size-11 rounded focus-visible:outline-2 focus-visible:outline-ring"
      >
        ✕
      </button>
    </section>
  );
}
