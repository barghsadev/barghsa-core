import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseDateRangeFilter,
  parseStatusFilter,
  SOLAR_REQUEST_STATUSES,
} from '@barghsa/shared/validation';
const SolarRequestsPage = lazyRouteComponent(
  () => import('../../pages/SolarRequestsPage.js'),
  'SolarRequestsPage'
);
function SolarRequestsRoute() {
  const { statuses, from, to } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SolarRequestsPage
      dateRange={{ from, to }}
      onDateRangeChange={(range) =>
        void navigate({
          search: (current) => ({ ...current, ...range, from: range.from, to: range.to }),
        })
      }
      statuses={parseStatusFilter(statuses, SOLAR_REQUEST_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({
          search: (current) => ({ ...current, statuses: selected.join(',') || undefined }),
        })
      }
    />
  );
}
export const Route = createFileRoute('/_app/solar/requests/')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
    statuses: parseStatusFilter(search.statuses, SOLAR_REQUEST_STATUSES)?.join(',') || undefined,
  }),
  component: SolarRequestsRoute,
});
