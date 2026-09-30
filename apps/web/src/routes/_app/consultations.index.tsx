import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseDateRangeFilter,
  parseStatusFilter,
  CONSULTATION_REQUEST_STATUSES,
} from '@barghsa/shared/validation';

const ConsultationsPage = lazyRouteComponent(
  () => import('../../pages/ConsultationsPage.js'),
  'ConsultationsPage'
);
function ConsultationsRoute() {
  const { statuses, from, to } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ConsultationsPage
      dateRange={{ from, to }}
      onDateRangeChange={(range) =>
        void navigate({
          search: (current) => ({ ...current, ...range, from: range.from, to: range.to }),
        })
      }
      statuses={parseStatusFilter(statuses, CONSULTATION_REQUEST_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({
          search: (current) => ({ ...current, statuses: selected.join(',') || undefined }),
        })
      }
    />
  );
}

export const Route = createFileRoute('/_app/consultations/')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
    statuses:
      parseStatusFilter(search.statuses, CONSULTATION_REQUEST_STATUSES)?.join(',') || undefined,
  }),
  component: ConsultationsRoute,
});
