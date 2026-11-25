import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { isUploadPolicyCategory } from '@barghsa/shared/admin';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminUploadPoliciesPage.js'));

function UploadPolicyVersionRoute() {
  const { category, versionId } = Route.useParams();
  if (!isUploadPolicyCategory(category) || !/^[A-Za-z0-9_-]{1,100}$/.test(versionId))
    throw notFound();
  return (
    <Page key={`${category}/${versionId}`} workspace={{ category, view: 'version', versionId }} />
  );
}

export const Route = createFileRoute('/admin/upload-policies_/$category/versions/$versionId')({
  component: UploadPolicyVersionRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
