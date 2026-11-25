import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { termsVersionId, useTosAddress } from '../../lib/tos-location.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminTosPage.js'));

function TosVersionRoute() {
  const { versionId, action } = Route.useParams();
  const set = useTosAddress();
  if (
    !termsVersionId(versionId) ||
    (action && (versionId === 'new' || (action !== 'edit' && action !== 'publish')))
  )
    throw notFound();
  const editing = action === 'edit' || versionId === 'new' ? versionId : null;
  return (
    <Page
      key={`${versionId}/${action ?? ''}`}
      workspace={{
        editing,
        viewing: !editing && !action ? versionId : null,
        publishing: action === 'publish' ? versionId : null,
        set,
      }}
    />
  );
}

export const Route = createFileRoute('/admin/tos_/versions/$versionId/{-$action}')({
  component: TosVersionRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
