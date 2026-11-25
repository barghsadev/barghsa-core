import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { SERVICE_WORKFLOW_KEYS } from '@barghsa/shared/admin';
import { RouteErrorBoundary, RouteNotFound } from '../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminServiceTargetsPage.js'));

function ServiceTargetSection() {
  const { section, workflow: workflowParam } = Route.useParams();
  if (section !== 'workflows' && section !== 'response-times' && section !== 'escalation')
    return <RouteNotFound />;
  const workflow = SERVICE_WORKFLOW_KEYS.find((key) => key === workflowParam);
  if (workflowParam && (section !== 'workflows' || !workflow)) return <RouteNotFound />;
  return <Page key={workflow ?? section} view={section} {...(workflow && { workflow })} />;
}

export const Route = createFileRoute('/admin/service-targets_/$section/{-$workflow}')({
  component: ServiceTargetSection,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
