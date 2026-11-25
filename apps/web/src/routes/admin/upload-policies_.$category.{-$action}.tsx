import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { isUploadPolicyCategory } from '@barghsa/shared/admin';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminUploadPoliciesPage.js'));

function UploadPolicyRoute() {
  const { category, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (
    !isUploadPolicyCategory(category) ||
    (action && action !== 'edit' && action !== 'new' && action !== 'history')
  )
    throw notFound();
  return (
    <Page
      key={`${category}/${action ?? ''}`}
      workspace={{
        category,
        view: action === 'history' ? 'history' : action ? 'editor' : 'detail',
        close: () =>
          void navigate({
            to: '/admin/upload-policies/$category/{-$action}',
            params: { category, action: undefined },
          }),
        showVersion: (versionId) =>
          void navigate({
            to: '/admin/upload-policies/$category/versions/$versionId',
            params: { category, versionId },
            replace: true,
          }),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/upload-policies_/$category/{-$action}')({
  component: UploadPolicyRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
