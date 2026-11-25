import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  solarRequestsQueryOptions,
  solarFilesQueryOptions,
  solarDocumentsSearch,
} from '../../lib/solar-staff-query.js';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
const Page = lazyRouteComponent(
  () => import('../../pages/AdminSolarDocumentsPage.js'),
  'AdminSolarDocumentsPage'
);
function DocumentsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const updateSearch = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) => {
    void navigate({
      search: (raw) => solarDocumentsSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  };
  const requests = useListQuery(solarRequestsQueryOptions, search, updateSearch);
  const files = useListQuery(solarFilesQueryOptions, search, updateSearch);
  return (
    <Page
      queueSearch={search}
      queries={{ requests, files, reset: () => updateSearch(() => ({})) }}
    />
  );
}
export const Route = createFileRoute('/admin/solar-requests/')({
  validateSearch: solarDocumentsSearch,
  component: DocumentsRoute,
  pendingComponent: StaffRecordLoading,
});
