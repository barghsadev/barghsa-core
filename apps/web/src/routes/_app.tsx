import { createFileRoute } from '@tanstack/react-router';
import { DashboardLayout } from '../pages/DashboardLayout.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.js';

/**
 * Customer dashboard layout — renders the dashboard sidebar (with profile
 * switcher) around all authenticated customer pages (T-03.03.01).
 */
export const Route = createFileRoute('/_app')({
  component: DashboardLayout,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
