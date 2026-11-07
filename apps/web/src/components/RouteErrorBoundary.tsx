import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import { ErrorState } from '@barghsa/ui';
import { useState } from 'react';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';
import { RouteFallbackLandmark } from './RouteFallbackLandmark.js';

/** Localized route recovery without exposing internal error details. */
export function RouteErrorBoundary({ error, reset }: ErrorComponentProps) {
  const locale = useLocale();
  const router = useRouter();
  const [reference] = useState(() => crypto.randomUUID());
  const isChunkLoadError =
    error instanceof TypeError &&
    (error.message.includes('Failed to fetch') ||
      error.message === 'Importing a module script failed.' ||
      error.message.includes('loading') ||
      error.message.includes('ChunkLoadError'));
  return (
    <RouteFallbackLandmark>
      <ErrorState
        heading="h1"
        title={feedbackText(isChunkLoadError ? 'chunkTitle' : 'errorTitle', locale)}
        description={feedbackText(
          isChunkLoadError ? 'chunkDescription' : 'errorDescription',
          locale
        )}
        retryLabel={feedbackText('retry', locale)}
        onRetry={() => {
          void router.invalidate().then(reset, () => {});
        }}
        details={{
          label: feedbackText('details', locale),
          code: isChunkLoadError ? 'CHUNK_LOAD_FAILED' : 'ROUTE_RENDER_FAILED',
          referenceLabel: feedbackText('reference', locale),
          reference,
        }}
        supportContact={
          <>
            <Link to="/support" search={{ reference }} className="underline underline-offset-4">
              {feedbackText('support', locale)}
            </Link>
            <Link to="/" className="underline underline-offset-4">
              {feedbackText('home', locale)}
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-11 cursor-pointer underline underline-offset-4"
            >
              {feedbackText('reload', locale)}
            </button>
          </>
        }
      />
    </RouteFallbackLandmark>
  );
}

export function RouteNotFound() {
  const locale = useLocale();
  return (
    <RouteFallbackLandmark>
      <div className="mx-auto w-full max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{feedbackText('notFound', locale)}</h1>
        <p>{feedbackText('notFoundDescription', locale)}</p>
        <Link to="/" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {feedbackText('home', locale)}
        </Link>
      </div>
    </RouteFallbackLandmark>
  );
}

export default RouteErrorBoundary;
