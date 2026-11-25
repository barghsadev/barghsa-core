import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../../pages/AccountRecoveryPage.js'));

function LookupRecoveryRoute() {
  const navigate = Route.useNavigate();
  return (
    <Page
      entry={{
        mode: 'lookup',
        openCase: (caseId) =>
          void navigate({ to: '/admin/crm/recovery/$caseId', params: { caseId } }),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/crm/recovery/')({
  component: LookupRecoveryRoute,
  pendingComponent: StaffRecordLoading,
});
