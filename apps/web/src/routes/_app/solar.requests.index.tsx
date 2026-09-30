import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { parseStatusFilter, SOLAR_REQUEST_STATUSES } from '@barghsa/shared/validation';
const SolarRequestsPage = lazyRouteComponent(
  () => import('../../pages/SolarRequestsPage.js'),
  'SolarRequestsPage'
);
function SolarRequestsRoute() {
  const { statuses } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SolarRequestsPage
      statuses={parseStatusFilter(statuses, SOLAR_REQUEST_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({ search: { statuses: selected.join(',') || undefined } })
      }
    />
  );
}
export const Route = createFileRoute('/_app/solar/requests/')({
  validateSearch: (search: Record<string, unknown>) => ({
    statuses: parseStatusFilter(search.statuses, SOLAR_REQUEST_STATUSES)?.join(',') || undefined,
  }),
  component: SolarRequestsRoute,
});
