import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';

interface VerificationStatusResponse {
  activeProfileId: string | null;
  profileStatus: string | null;
  isVerified: boolean;
  verificationRequired: boolean;
  verificationMethod: 'api' | 'manual';
  canAutoVerify: boolean;
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
  const client = useQueryClient();
  const reader = useId();
  const sequence = useRef(0);
  const [status, setStatus] = useState<VerificationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });

  const locale = useLocale();
  const isRtl = locale === 'fa';

  useEffect(() => {
    const controller = new AbortController();
    const key = queryKeys.profiles.authority(
      { context: 'account', ownerId: accountId ?? 'current-session', accountId, revision },
      JSON.stringify([reader, 'verification-status', pathname, locale, ++sequence.current])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    setLoading(true);
    setStatus(null);

    async function fetchStatus() {
      try {
        const response = await client.fetchQuery({
          queryKey: key,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const response = await fetch('/api/profiles/verification-status', {
              method: 'GET',
              credentials: 'include',
              signal,
              headers: { Accept: 'application/json', 'Accept-Language': locale },
            });
            return {
              ok: response.ok,
              status: response.status,
              data: response.ok ? ((await response.json()) as VerificationStatusResponse) : null,
            };
          },
        });

        // Not authenticated — no banner
        if (response.status === 401) {
          if (!controller.signal.aborted) setLoading(false);
          return;
        }

        if (!response.ok) {
          if (!controller.signal.aborted) setLoading(false);
          return;
        }

        const data = response.data;
        if (!controller.signal.aborted) {
          setStatus(data);
          setLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchStatus();

    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [locale, pathname, client, accountId, revision, reader]);

  // Don't render anything while loading, or if no status data, or if dismissed
  if (loading || !status) return null;

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
  if (noticeKey && noticeContent) {
    return (
      <section
        data-testid="verification-notice"
        role={status.isVerified ? 'status' : 'alert'}
        dir={isRtl ? 'rtl' : 'ltr'}
        className="border-b border-border bg-muted px-4 py-3 text-sm text-foreground"
      >
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="font-medium">{noticeContent.title}</p>
            <p className="whitespace-pre-line break-words">{noticeContent.body}</p>
            <div className="flex flex-wrap gap-4 text-xs">
              <Link to="/settings/profile" className="underline underline-offset-2">
                {t('settings.profile.title', locale)}
              </Link>
              {!status.isVerified && (
                <Link to="/tickets" className="underline underline-offset-2">
                  {t('verification.banner.support', locale)}
                </Link>
              )}
              <Link to="/notifications" className="underline underline-offset-2">
                {t('notifications.viewAll', locale)}
              </Link>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(noticeKey)}
            aria-label={t('verification.banner.dismiss', locale)}
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

  // Don't render if no active profile at all. Capture the non-null status
  // for use inside the handleAutoVerify closure, which TypeScript cannot
  // narrow across function boundaries.
  if (!status.activeProfileId) return null;
  const currentStatus = status;

  async function handleAutoVerify() {
    if (!currentStatus.activeProfileId) return;
    setVerifying(true);
    setHasError(false);

    try {
      const response = await fetch(`/api/profiles/${currentStatus.activeProfileId}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json', 'Accept-Language': locale }),
      });

      if (response.ok) {
        setVerified(true);
        // Refresh the page after a brief delay to reflect the new status
        setTimeout(() => {
          router.invalidate();
        }, 1500);
      } else {
        setVerifying(false);
        setHasError(true);
      }
    } catch {
      setVerifying(false);
      setHasError(true);
    }
  }

  if (verified) {
    return (
      <div
        className="bg-success-soft border-success/20 border px-4 py-3 text-sm text-success"
        role="alert"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span>{t('verification.banner.verified', locale)}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-warning-soft border-warning/20 border-b px-4 py-3 text-sm text-warning"
      role="alert"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex flex-col gap-1">
          <span>{t('verification.banner.title', locale)}</span>
          {!currentStatus.canAutoVerify && (
            <span className="text-xs">{t('verification.banner.manualHelp', locale)}</span>
          )}
          <Link to="/tickets" className="text-xs underline underline-offset-2">
            {t('verification.banner.support', locale)}
          </Link>
          {hasError && (
            <span className="text-xs text-destructive">
              {t('verification.banner.error', locale)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {currentStatus.canAutoVerify && (
            <button
              onClick={handleAutoVerify}
              disabled={verifying}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {verifying
                ? t('verification.banner.verifying', locale)
                : t('verification.banner.verify', locale)}
            </button>
          )}
          <button
            onClick={() => setDismissed(bannerKey)}
            className="text-warning hover:text-amber-800"
            aria-label={t('verification.banner.dismiss', locale)}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
