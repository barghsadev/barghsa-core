import { useOwnedGateRead } from '../hooks/useOwnedGateRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { sendToast } from '../lib/toast-api.js';
import { useRouterState } from '@tanstack/react-router';
import { useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { t, type Locale } from '@barghsa/i18n/terms';
import { Button } from '@barghsa/ui';
import { AlertCircleIcon } from 'lucide-react';
import { readWithDeadline } from '../lib/server-query-client.js';

const TosReviewDialog = lazy(() => import('./TosReviewDialog.js'));

// ─── Types ────────────────────────────────────────────────────────────

interface CurrentTosResponse {
  id: string;
  content: string;
  versionId: string;
  updatedAt: string;
  publishedAt: string;
}

// ─── Props ────────────────────────────────────────────────────────────

interface TosBannerProps {
  locale?: Locale;
}

// ─── Component ────────────────────────────────────────────────────────

/**
 * TOS re-acceptance banner (T-04.01.03).
 *
 * Fetches the current user info and shows a sticky banner at the top of
 * dashboard pages when the user needs to re-accept updated Terms of Service.
 * The [Review] button opens a modal showing the full TOS with an accept button.
 * The modal also opens automatically on the first non-exempt page visit when
 * re-acceptance is required, with an explicit dismiss from the user suppressing
 * further auto-opens within the same session.
 *
 * Support and legal-record routes retain manual review without an automatic modal.
 * Status failures offer a non-blocking retry; navigation checks status again.
 */
export function TosBanner(props: TosBannerProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedTosBanner key={JSON.stringify([actor, revision])} {...props} />;
}
function OwnedTosBanner({ locale = 'fa' }: TosBannerProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const readStatus = useOwnedGateRead(JSON.stringify([actor, revision, pathname]), actor, revision);
  const readReview = useOwnedGateRead(JSON.stringify([actor, revision, locale]), actor, revision);
  const statusController = useRef<AbortController | null>(null);
  const reviewController = useRef<AbortController | null>(null);
  const automaticReviewAllowed =
    !/^(?:\/(?:auth|account-recovery|support|tickets|terms|invoices|contracts)|\/admin\/(?:tickets|invoices))(?:\/|$)/.test(
      pathname
    );
  const reviewRequest = useRef(0);
  const statusRequest = useRef(0);
  const [requiresAcceptance, setRequiresAcceptance] = useState(false);
  const [checking, setChecking] = useState(true);
  const [statusFailed, setStatusFailed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [currentTos, setCurrentTos] = useState<CurrentTosResponse | null>(null);
  const [loadingTos, setLoadingTos] = useState(false);
  const [renderedVersion, setRenderedVersion] = useState<string | null>(null);
  const renderKey = currentTos ? `${currentTos.id}:${locale}` : null;
  const markRendered = useCallback(() => setRenderedVersion(renderKey), [renderKey]);
  const [accepting, setAccepting] = useState(false);
  const acceptanceRequest = useRef<AbortController | null>(null);
  const [acceptanceUnconfirmed, setAcceptanceUnconfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedAutoModal, setDismissedAutoModal] = useState(false);

  // ── Check TOS acceptance status ─────────────────────────────────

  const checkTosStatus = useCallback(async () => {
    statusController.current?.abort();
    const controller = new AbortController();
    statusController.current = controller;
    const request = ++statusRequest.current;
    setChecking(true);
    try {
      const response = await readStatus('/api/auth/user', { signal: controller.signal });
      if (request !== statusRequest.current) return null;
      if (response.status === 401) {
        setRequiresAcceptance(false);
        setStatusFailed(false);
        setShowModal(false);
        return false;
      }
      if (!response.ok) throw new Error('Consent status unavailable');
      const data: unknown = await response.json();
      if (request !== statusRequest.current) return null;
      if (
        !data ||
        typeof data !== 'object' ||
        !('userId' in data) ||
        typeof data.userId !== 'string' ||
        !data.userId ||
        !('requiresTosAcceptance' in data) ||
        typeof data.requiresTosAcceptance !== 'boolean'
      ) {
        throw new Error('Invalid consent status');
      }
      setRequiresAcceptance(data.requiresTosAcceptance);
      setStatusFailed(false);
      if (!data.requiresTosAcceptance) setShowModal(false);
      return data.requiresTosAcceptance;
    } catch {
      if (request === statusRequest.current) setStatusFailed(true);
      return null;
    } finally {
      if (request === statusRequest.current) setChecking(false);
    }
  }, [readStatus]);

  useEffect(() => {
    void checkTosStatus();
    return () => {
      statusController.current?.abort();
      statusRequest.current++;
    };
  }, [checkTosStatus, pathname]);

  // ── Fetch current TOS content for modal ─────────────────────────

  const openReviewModal = useCallback(async () => {
    reviewController.current?.abort();
    const controller = new AbortController();
    reviewController.current = controller;
    const request = ++reviewRequest.current;
    setShowModal(true);
    setLoadingTos(true);
    setCurrentTos(null);
    setRenderedVersion(null);
    setError(null);

    try {
      const response = await readReview(`/api/tos/current?locale=${locale}`, {
        signal: controller.signal,
      });
      if (request !== reviewRequest.current) return;
      if (!response.ok) {
        setError(t('tos.page.error', locale));
        return;
      }
      const data: unknown = await response.json();
      if (request !== reviewRequest.current) return;
      if (!data || typeof data !== 'object') throw new Error('Invalid terms response');
      const version = data as Partial<CurrentTosResponse>;
      if (
        typeof version.id !== 'string' ||
        !version.id ||
        typeof version.versionId !== 'string' ||
        !version.versionId ||
        typeof version.content !== 'string' ||
        !version.content.trim() ||
        typeof version.updatedAt !== 'string' ||
        typeof version.publishedAt !== 'string'
      )
        throw new Error('Invalid terms response');
      setCurrentTos(version as CurrentTosResponse);
    } catch {
      if (request === reviewRequest.current) setError(t('tos.page.error', locale));
    } finally {
      if (request === reviewRequest.current) setLoadingTos(false);
    }
  }, [locale, readReview]);

  const reviewAfterChecking = async () => {
    if (acceptanceUnconfirmed) {
      const required = await checkTosStatus();
      if (required === null) return;
      setAcceptanceUnconfirmed(false);
      if (!required) return;
    }
    await openReviewModal();
  };

  useEffect(() => {
    let cancelled = false;
    const reviewRequired = () => {
      void checkTosStatus().then((required) => {
        if (cancelled || !required) return;
        setAcceptanceUnconfirmed(false);
        setDismissedAutoModal(true);
        void openReviewModal();
      });
    };
    window.addEventListener('barghsa:tos-required', reviewRequired);
    return () => {
      cancelled = true;
      window.removeEventListener('barghsa:tos-required', reviewRequired);
    };
  }, [checkTosStatus, openReviewModal]);

  // ── Auto-open modal on first non-exempt page visit ─────────────

  useEffect(() => {
    if (automaticReviewAllowed && requiresAcceptance && !dismissedAutoModal) {
      openReviewModal();
    }
  }, [automaticReviewAllowed, requiresAcceptance, dismissedAutoModal, openReviewModal]);

  useEffect(() => {
    if (!automaticReviewAllowed) {
      reviewController.current?.abort();
      reviewRequest.current++;
      setShowModal(false);
      setLoadingTos(false);
    }
  }, [automaticReviewAllowed]);
  useLayoutEffect(
    () => () => {
      acceptanceRequest.current?.abort();
      reviewController.current?.abort();
      reviewRequest.current++;
    },
    [readReview]
  );

  // ── Accept TOS ──────────────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (
      !currentTos ||
      renderedVersion !== renderKey ||
      acceptanceRequest.current ||
      acceptanceUnconfirmed
    )
      return;

    const controller = new AbortController();
    acceptanceRequest.current = controller;
    const review = reviewRequest.current;
    const current = () =>
      !controller.signal.aborted &&
      review === reviewRequest.current &&
      revision === getProfileContextRevision();
    const failed = (needsStatus: boolean, uncertainMessage = needsStatus) => {
      if (!current()) return;
      setAcceptanceUnconfirmed(needsStatus);
      const message = t(uncertainMessage ? 'tos.modal.unconfirmed' : 'tos.modal.error', locale);
      setError(message);
      sendToast(uncertainMessage ? 'warning' : 'error', message);
    };

    setAccepting(true);
    setError(null);

    try {
      const outcome = await readWithDeadline(controller.signal, async (signal) => {
        const { acceptReviewedTerms } = await import('../lib/terms-acceptance.js');
        return acceptReviewedTerms(currentTos.id, signal);
      });

      if (!current()) return;
      if (outcome !== 'accepted') return failed(outcome !== 'denied', outcome === 'unconfirmed');

      statusController.current?.abort();
      statusRequest.current++;
      setChecking(false);
      setStatusFailed(false);
      setRequiresAcceptance(false);
      setShowModal(false);
      sendToast('success', t('tos.modal.success', locale));
    } catch {
      failed(true);
    } finally {
      if (acceptanceRequest.current === controller) {
        acceptanceRequest.current = null;
        if (revision === getProfileContextRevision()) setAccepting(false);
      }
    }
  }, [acceptanceUnconfirmed, currentTos, locale, renderedVersion, renderKey, revision]);

  // ── Render ──────────────────────────────────────────────────────

  if (statusFailed) {
    return (
      <div
        role="status"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted text-foreground px-4 py-3 text-sm"
      >
        <span>{t('tos.banner.checkFailed', locale)}</span>
        <Button size="sm" variant="outline" disabled={checking} onClick={checkTosStatus}>
          {t('tos.banner.retry', locale)}
        </Button>
      </div>
    );
  }

  if (checking || !requiresAcceptance) {
    return null;
  }

  return (
    <>
      {/* Sticky banner */}
      <div
        className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 bg-muted text-foreground border-b px-4 py-3 text-sm"
        role="alert"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center gap-2">
          <AlertCircleIcon className="h-4 w-4 text-foreground shrink-0" />
          <span className="text-foreground">{t('tos.banner.text', locale)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="default" size="sm" onClick={reviewAfterChecking}>
            {t('tos.banner.review', locale)}
          </Button>
        </div>
      </div>

      {showModal && (
        <Suspense
          fallback={
            <p role="status" className="sr-only">
              {t('tos.page.loading', locale)}
            </p>
          }
        >
          <TosReviewDialog
            locale={locale}
            currentTos={currentTos}
            error={error}
            loadingTos={loadingTos}
            accepting={accepting}
            acceptanceUnconfirmed={acceptanceUnconfirmed}
            contentReady={renderedVersion === renderKey}
            markRendered={markRendered}
            handleAccept={() => void handleAccept()}
            reviewAfterChecking={() => void reviewAfterChecking()}
            close={() => {
              reviewController.current?.abort();
              reviewRequest.current++;
              setLoadingTos(false);
              setDismissedAutoModal(true);
              setShowModal(false);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
