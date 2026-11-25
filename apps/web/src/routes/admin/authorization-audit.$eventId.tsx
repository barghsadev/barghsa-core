import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { CONFIG_AUDIT_ID } from '@barghsa/shared/admin';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { authorizationAuditSearch } from '../../lib/authorization-audit-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminAuthorizationAudit.js'));

function AuthorizationEventRoute() {
  const { eventId } = Route.useParams();
  return <Page eventId={eventId} filters={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/authorization-audit/$eventId')({
  validateSearch: authorizationAuditSearch,
  beforeLoad: ({ params, search }) => {
    const eventId = params.eventId.toLowerCase();
    if (!CONFIG_AUDIT_ID.test(eventId)) throw notFound();
    if (params.eventId !== eventId) {
      throw redirect({
        to: '/admin/authorization-audit/$eventId',
        params: { eventId },
        search,
        replace: true,
      });
    }
  },
  component: AuthorizationEventRoute,
  pendingComponent: StaffRecordLoading,
});
