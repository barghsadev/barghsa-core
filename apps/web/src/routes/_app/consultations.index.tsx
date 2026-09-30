import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { parseStatusFilter, CONSULTATION_REQUEST_STATUSES } from '@barghsa/shared/validation';

const ConsultationsPage = lazyRouteComponent(
  () => import('../../pages/ConsultationsPage.js'),
  'ConsultationsPage'
);
function ConsultationsRoute() {
  const { statuses } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ConsultationsPage
      statuses={parseStatusFilter(statuses, CONSULTATION_REQUEST_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({ search: { statuses: selected.join(',') || undefined } })
      }
    />
  );
}

export const Route = createFileRoute('/_app/consultations/')({
  validateSearch: (search: Record<string, unknown>) => ({
    statuses:
      parseStatusFilter(search.statuses, CONSULTATION_REQUEST_STATUSES)?.join(',') || undefined,
  }),
  component: ConsultationsRoute,
});
