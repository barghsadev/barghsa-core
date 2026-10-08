import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createServerQueryClient } from '../lib/server-query-client.js';
import { useProfileContextRevision } from '../lib/profile-context.js';

const QueryDevtools =
  process.env.NODE_ENV === 'development'
    ? lazy(() =>
        import('@tanstack/react-query-devtools').then((module) => ({
          default: module.ReactQueryDevtools,
        }))
      )
    : null;

function ScopedQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createServerQueryClient);
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      {children}
      {QueryDevtools && !import.meta.env.VITE_E2E && (
        <Suspense fallback={null}>
          <QueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}

/** Profile changes discard the whole cache and cancel requests before reuse. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const revision = useProfileContextRevision();
  return <ScopedQueryProvider key={revision}>{children}</ScopedQueryProvider>;
}
