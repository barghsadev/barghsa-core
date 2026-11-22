import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import type { TosWorkspace } from '../../pages/AdminTosPage.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminTosPage.js'));

function termsAddress(raw: Record<string, unknown>) {
  const id = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
  return { editing: id(raw.editing), viewing: id(raw.viewing) };
}

function TosRoute() {
  const search = termsAddress(Route.useSearch());
  const navigate = Route.useNavigate();
  const set = useCallback<TosWorkspace['set']>(
    (patch, replace = false) => {
      void navigate({
        search: (raw) => termsAddress({ ...raw, ...patch }),
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  return (
    <Page workspace={{ editing: search.editing ?? null, viewing: search.viewing ?? null, set }} />
  );
}

export const Route = createFileRoute('/admin/tos')({
  component: TosRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
