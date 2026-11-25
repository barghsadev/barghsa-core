import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { isAgentSlotKey } from '../../lib/agent-slot-keys.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminAgentSlotsPage.js'));

function SlottedAgentRoute() {
  const { slotKey, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (!isAgentSlotKey(slotKey) || (action && action !== 'edit')) throw notFound();
  const page = (
    <Page
      key={`${slotKey}/${action ?? ''}`}
      workspace={{
        view: action === 'edit' ? 'edit' : 'detail',
        slotKey,
        showAssignment: (replace = false) =>
          void navigate({
            to: '/admin/agent-slots/$slotKey/{-$action}',
            params: { slotKey, action: undefined },
            replace,
          }),
      }}
    />
  );
  return action === 'edit' ? (
    page
  ) : (
    <AdminAiSections section="/admin/agent-slots">{page}</AdminAiSections>
  );
}

export const Route = createFileRoute('/admin/agent-slots_/$slotKey/{-$action}')({
  component: SlottedAgentRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
