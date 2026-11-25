import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(
  () => import('../../../pages/SettingsProfilePage.js'),
  'SettingsProfilePage'
);

export const Route = createFileRoute('/_app/settings/profile')({
  component: () => <Page edit={false} />,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
