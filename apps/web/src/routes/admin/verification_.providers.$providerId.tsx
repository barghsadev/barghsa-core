import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { verificationProviderId } from '../../lib/verification-location.js';

const Verification = lazyRouteComponent(() => import('../../pages/AdminVerificationConfig.js'));

function VerificationProviderRoute() {
  const { providerId } = Route.useParams();
  if (!verificationProviderId(providerId)) throw notFound();
  return <Verification key={providerId} section="providers" providerId={providerId} />;
}

export const Route = createFileRoute('/admin/verification_/providers/$providerId')({
  component: VerificationProviderRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
