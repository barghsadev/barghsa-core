import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { verificationSections } from '../../lib/verification-location.js';

const Verification = lazyRouteComponent(() => import('../../pages/AdminVerificationConfig.js'));

function VerificationRoute() {
  const { section } = Route.useParams();
  const selected = verificationSections.find((id) => id === section);
  if (!selected) throw notFound();
  return <Verification key={selected} section={selected} />;
}

export const Route = createFileRoute('/admin/verification_/$section')({
  component: VerificationRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
