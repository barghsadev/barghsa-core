import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminVatPage.js'));
function VatRoute() {
  const raw: Record<string, unknown> = Route.useSearch();
  const { mode, selected } = raw;
  let id: string | null = null;
  if (mode === 'rate' || mode === 'override') id = mode;
  if (
    (mode === 'endRate' || mode === 'endOverride') &&
    typeof selected === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(selected)
  ) {
    id = `${mode}/${selected}`;
  }
  const navigate = Route.useNavigate();
  const set = useCallback(
    (key: string | null, replace = false) => {
      const [mode, selected] = key?.split('/') ?? [];
      void navigate({ search: { mode, selected }, replace, resetScroll: false });
    },
    [navigate]
  );
  return <Page selection={{ id, set }} />;
}

export const Route = createFileRoute('/admin/vat')({
  component: VatRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
