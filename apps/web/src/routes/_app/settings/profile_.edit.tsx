import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';

export const Route = createFileRoute('/_app/settings/profile_/edit')({
  component: lazyRouteComponent(
    () => import('../../../pages/SettingsProfilePage.js'),
    'SettingsProfilePage'
  ),
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
