import { useCallback } from 'react';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminContractTemplatesPage.js'));

function ContractTemplatesRoute() {
  const { selected } = Route.useSearch();
  const navigate = Route.useNavigate();
  const select = useCallback(
    (id: string | null, replace = false) => {
      void navigate({ search: { selected: id ?? undefined }, replace, resetScroll: false });
    },
    [navigate]
  );
  return <Page selection={{ id: selected ?? null, set: select }} />;
}

export const Route = createFileRoute('/admin/contract-templates')({
  validateSearch: (raw: Record<string, unknown>) => ({
    selected: raw.selected === 'new' ? 'new' : adminEditorId(raw.selected),
  }),
  component: ContractTemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
