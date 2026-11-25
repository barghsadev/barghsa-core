import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../../pages/AccountRecoveryPage.js'));

function CreateRecoveryRoute() {
  const navigate = Route.useNavigate();
  return (
    <Page
      entry={{
        mode: 'create',
        openCase: (caseId) =>
          void navigate({ to: '/admin/crm/recovery/$caseId', params: { caseId }, replace: true }),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/crm/recovery/new')({
  component: CreateRecoveryRoute,
  pendingComponent: StaffRecordLoading,
});
