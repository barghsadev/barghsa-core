import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { termsVersionId, useTosAddress } from '../../lib/tos-location.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminTosPage.js'));

function TosRoute() {
  const set = useTosAddress();
  return <Page workspace={{ editing: null, viewing: null, publishing: null, set }} />;
}

export const Route = createFileRoute('/admin/tos')({
  validateSearch: (raw: Record<string, unknown>) => ({
    editing: termsVersionId(raw.editing),
    viewing: termsVersionId(raw.viewing),
  }),
  beforeLoad: ({ search }) => {
    const id = search.editing || search.viewing;
    if (id)
      throw redirect({
        to: '/admin/tos/versions/$versionId/{-$action}',
        params: { versionId: id, action: search.editing && id !== 'new' ? 'edit' : undefined },
        replace: true,
      });
  },
  component: TosRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
