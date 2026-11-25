import { lazy, Suspense } from 'react';
import { t, type Locale } from '@barghsa/i18n/terms';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SkeletonText,
} from '@barghsa/ui';
import { Loader2Icon } from 'lucide-react';

const TosContent = lazy(() => import('./TosContent.js'));

export default function TosReviewDialog({
  locale,
  currentTos,
  error,
  loadingTos,
  accepting,
  acceptanceUnconfirmed,
  contentReady,
  markRendered,
  handleAccept,
  reviewAfterChecking,
  close,
}: {
  locale: Locale;
  currentTos: { versionId: string; updatedAt: string; content: string } | null;
  error: string | null;
  loadingTos: boolean;
  accepting: boolean;
  acceptanceUnconfirmed: boolean;
  contentReady: boolean;
  markRendered: () => void;
  handleAccept: () => void;
  reviewAfterChecking: () => void;
  close: () => void;
}) {
  const time = useAccountTime(locale);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-1.5rem)] flex-col gap-3 sm:max-h-[min(80dvh,48rem)] sm:max-w-xl sm:gap-4"
        closeLabel={t('tos.modal.close', locale)}
      >
        <DialogHeader className="shrink-0 gap-1 pointer-coarse:pe-[2.75rem]">
          <DialogTitle className="text-lg leading-snug font-semibold">
            {t('tos.modal.title', locale)}
          </DialogTitle>
          {currentTos && (
            <DialogDescription className="flex flex-wrap items-baseline gap-x-3 gap-y-0 text-xs">
              <bdi className="wrap-anywhere font-medium">{currentTos.versionId}</bdi>
              <span>
                {t('tos.page.lastUpdated', locale).replace(
                  '{date}',
                  time.format(currentTos.updatedAt, { dateStyle: 'long' })
                )}
              </span>
            </DialogDescription>
          )}
          {time.notice}
        </DialogHeader>

        {loadingTos && (
          <div role="status" aria-label={t('tos.page.loading', locale)} className="py-3">
            <SkeletonText lines={3} className="w-full max-w-md" />
          </div>
        )}
        {currentTos && !loadingTos && (
          <section
            aria-label={t('tos.modal.document', locale)}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the terms independently.
            tabIndex={0}
            className="min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-lg border bg-background px-3 py-2 wrap-anywhere focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none sm:px-5 sm:py-4 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm"
          >
            <Suspense
              fallback={
                <p role="status" className="sr-only">
                  {t('tos.page.loading', locale)}
                </p>
              }
            >
              <TosContent content={currentTos.content} language={locale} onReady={markRendered} />
            </Suspense>
          </section>
        )}

        <DialogFooter className="shrink-0 flex-col py-3 sm:flex-col">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant={error || acceptanceUnconfirmed ? 'outline' : 'default'}
              className="min-h-11 flex-auto sm:flex-none"
              onClick={handleAccept}
              disabled={
                accepting ||
                acceptanceUnconfirmed ||
                loadingTos ||
                !!error ||
                !currentTos ||
                !contentReady
              }
            >
              {accepting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                  {t('tos.modal.accepting', locale)}
                </>
              ) : (
                t('tos.modal.accept', locale)
              )}
            </Button>
            {(error || acceptanceUnconfirmed) && (
              <Button
                className="min-h-11 flex-auto whitespace-normal sm:flex-none"
                onClick={reviewAfterChecking}
              >
                {t(acceptanceUnconfirmed ? 'tos.banner.retry' : 'tos.page.retry', locale)}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
