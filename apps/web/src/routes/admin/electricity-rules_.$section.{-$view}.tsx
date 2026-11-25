import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(
  () => import('../../pages/AdminElectricityRulesPage.js'),
  'RoutedElectricitySettings'
);

export const Route = createFileRoute('/admin/electricity-rules_/$section/{-$view}')({
  component: RulesSectionRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function RulesSectionRoute() {
  const { section, view } = Route.useParams();
  return <Page key={section + '/' + view} sectionParam={section} viewParam={view} />;
}
