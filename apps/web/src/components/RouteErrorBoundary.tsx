import { ErrorComponentProps, Link } from '@tanstack/react-router'

/**
 * Accessible route-level error boundary for lazy-loaded modules.
 * Displays a clear error message with a retry/reload option.
 */
export function RouteErrorBoundary({ error, reset }: ErrorComponentProps) {
  const isChunkLoadError =
    error instanceof TypeError &&
    (error.message?.includes('Failed to fetch') ||
      error.message?.includes('loading') ||
      error.message?.includes('ChunkLoadError'))

  return (
    <div
      className="flex items-center justify-center min-h-[300px] p-8"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-xl font-semibold text-red-700">
          {isChunkLoadError
            ? 'Failed to load this page'
            : 'An unexpected error occurred'}
        </h2>
        <p className="text-gray-600">
          {isChunkLoadError
            ? 'A part of the application could not be loaded. This may be due to a network issue or a new deployment.'
            : 'Please try again. If the problem persists, contact support.'}
        </p>
        <div className="flex justify-center gap-4">
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Try again
          </button>
          <Link
            to="/"
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Go home
          </Link>
        </div>
        {process.env.NODE_ENV === 'development' && error && (
          <pre className="mt-4 p-4 bg-gray-100 rounded text-xs text-left overflow-auto max-h-32">
            {error.message}
            {error.stack ? `\n${error.stack}` : ''}
          </pre>
        )}
      </div>
    </div>
  )
}