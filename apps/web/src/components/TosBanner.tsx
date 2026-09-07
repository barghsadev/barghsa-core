import { useRouterState } from '@tanstack/react-router';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { t, type Locale } from '@barghsa/i18n/terms';
import { Button } from '@barghsa/ui';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui';
import { AlertCircleIcon, CheckIcon, Loader2Icon } from 'lucide-react';
import { withCsrf } from '../lib/csrf.js';

const TosContent = lazy(() => import('./TosContent.js'));

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
export function TosBanner({ locale = 'fa' }: TosBannerProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const automaticReviewAllowed =
    !/^(?:\/(?:auth|account-recovery|support|tickets|terms|invoices|contracts)|\/admin\/(?:tickets|invoices))(?:\/|$)/.test(
      pathname
    );
  const reviewRequest = useRef(0);
  const statusRequest = useRef(0);
  const time = useAccountTime(locale);
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
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedAutoModal, setDismissedAutoModal] = useState(false);

  // ── Check TOS acceptance status ─────────────────────────────────

  const checkTosStatus = useCallback(async () => {
    const request = ++statusRequest.current;
    setChecking(true);
    try {
      const response = await fetch('/api/auth/user');
      if (request !== statusRequest.current) return;
      if (response.status === 401) {
        setRequiresAcceptance(false);
        setStatusFailed(false);
        setShowModal(false);
        return;
      }
      if (!response.ok) throw new Error('Consent status unavailable');
      const data: unknown = await response.json();
      if (request !== statusRequest.current) return;
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
    } catch {
      if (request === statusRequest.current) setStatusFailed(true);
    } finally {
      if (request === statusRequest.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkTosStatus();
    return () => {
      statusRequest.current++;
    };
  }, [checkTosStatus, pathname]);

  // ── Fetch current TOS content for modal ─────────────────────────

  const openReviewModal = useCallback(async () => {
    const request = ++reviewRequest.current;
    setShowModal(true);
    setLoadingTos(true);
    setCurrentTos(null);
    setRenderedVersion(null);
    setError(null);

    try {
      const response = await fetch(`/api/tos/current?locale=${locale}`);
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
  }, [locale]);

  // ── Auto-open modal on first non-exempt page visit ─────────────

  useEffect(() => {
    if (automaticReviewAllowed && requiresAcceptance && !dismissedAutoModal) {
      openReviewModal();
    }
  }, [automaticReviewAllowed, requiresAcceptance, dismissedAutoModal, openReviewModal]);

  useEffect(() => {
    if (!automaticReviewAllowed) {
      reviewRequest.current++;
      setShowModal(false);
      setLoadingTos(false);
    }
  }, [automaticReviewAllowed]);
  useEffect(
    () => () => {
      reviewRequest.current++;
    },
    []
  );

  // ── Accept TOS ──────────────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (!currentTos || renderedVersion !== renderKey) return;

    setAccepting(true);
    setError(null);

    try {
      const response = await fetch(`/api/tos/accept/${encodeURIComponent(currentTos.id)}`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
      });

      if (!response.ok) {
        setError(t('tos.modal.error', locale));
        return;
      }

      statusRequest.current++;
      setChecking(false);
      setStatusFailed(false);
      setAccepted(true);
      setRequiresAcceptance(false);

      // Close modal after brief success state
      setTimeout(() => {
        setShowModal(false);
        setAccepted(false);
      }, 1500);
    } catch {
      setError(t('tos.modal.error', locale));
    } finally {
      setAccepting(false);
    }
  }, [currentTos, locale, renderedVersion, renderKey]);

  // ── Render ──────────────────────────────────────────────────────

  if (statusFailed) {
    return (
      <div
        role="status"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        className="flex flex-wrap items-center justify-between gap-3 border-b bg-amber-50 px-4 py-3 text-sm"
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
        className="sticky top-0 z-40 flex items-center justify-between gap-4 bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm"
        role="alert"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center gap-2">
          <AlertCircleIcon className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800">{t('tos.banner.text', locale)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="default" size="sm" onClick={openReviewModal}>
            {t('tos.banner.review', locale)}
          </Button>
        </div>
      </div>

      {/* Review modal */}
      <Dialog
        open={showModal}
        onOpenChange={(open) => {
          if (!open && !accepted) {
            setDismissedAutoModal(true);
          }
          setShowModal(open);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('tos.modal.title', locale)}</DialogTitle>
            {currentTos && (
              <DialogDescription>
                {t('tos.page.lastUpdated', locale).replace(
                  '{date}',
                  time.format(currentTos.updatedAt, { dateStyle: 'long' })
                )}
              </DialogDescription>
            )}
          </DialogHeader>

          {time.notice}
          {/* TOS content area */}
          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[50vh] border rounded-md p-4 bg-white">
            {loadingTos && (
              <div className="flex items-center justify-center h-full">
                <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="flex items-center justify-center h-full text-red-500">
                <p>{error}</p>
              </div>
            )}
            {currentTos && !loadingTos && !error && (
              <Suspense fallback={<p role="status">{t('tos.page.loading', locale)}</p>}>
                <TosContent content={currentTos.content} language={locale} onReady={markRendered} />
              </Suspense>
            )}
          </div>

          <DialogFooter>
            {accepted ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckIcon className="h-4 w-4" />
                <span>{t('tos.modal.success', locale)}</span>
              </div>
            ) : (
              <Button
                onClick={handleAccept}
                disabled={
                  accepting || loadingTos || !!error || !currentTos || renderedVersion !== renderKey
                }
              >
                {accepting ? (
                  <>
                    <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                    {t('tos.modal.accepting', locale)}
                  </>
                ) : (
                  t('tos.modal.accept', locale)
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
