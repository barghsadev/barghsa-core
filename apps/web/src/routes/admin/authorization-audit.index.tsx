import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { authorizationAuditSearch } from '../../lib/authorization-audit-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminAuthorizationAudit.js'));

function AuthorizationAuditRoute() {
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  return <Page filters={filters} onApply={(search) => void navigate({ search })} />;
}

export const Route = createFileRoute('/admin/authorization-audit/')({
  validateSearch: authorizationAuditSearch,
  component: AuthorizationAuditRoute,
  pendingComponent: StaffRecordLoading,
});
