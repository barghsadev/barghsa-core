import { type ErrorComponentProps, Link } from '@tanstack/react-router';
import { ErrorState } from '@barghsa/ui';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';

/** Localized route recovery without exposing internal error details. */
export function RouteErrorBoundary({ error, reset }: ErrorComponentProps) {
  const locale = useLocale();
  const isChunkLoadError =
    error instanceof TypeError &&
    (error.message.includes('Failed to fetch') ||
      error.message.includes('loading') ||
      error.message.includes('ChunkLoadError'));
  return (
    <ErrorState
      title={feedbackText(isChunkLoadError ? 'chunkTitle' : 'errorTitle', locale)}
      description={feedbackText(isChunkLoadError ? 'chunkDescription' : 'errorDescription', locale)}
      retryLabel={feedbackText('retry', locale)}
      onRetry={reset}
      supportContact={
        <>
          <Link to="/support" className="underline underline-offset-4">
            {feedbackText('support', locale)}
          </Link>
          <Link to="/" className="underline underline-offset-4">
            {feedbackText('home', locale)}
          </Link>
        </>
      }
    />
  );
}
