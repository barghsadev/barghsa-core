import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  staffDocumentFilters,
  staffDocumentQueryOptions,
  staffDocumentsSearch,
} from '../../lib/record-list-query.js';
import { createFileRoute, redirect } from '@tanstack/react-router';
import AdminDocumentsPage from '../../pages/AdminDocumentsPage.js';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';

function DocumentsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (raw) => staffDocumentFilters(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(staffDocumentQueryOptions, search, change);
  return (
    <AdminDocumentsPage
      recordSearch={staffDocumentFilters(search)}
      queries={{
        queue,
        selected: null,
        select: (documentId, options = {}) => {
          if (!documentId) return;
          void navigate({
            to: '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}',
            params: { documentId },
            search: staffDocumentFilters({
              ...search,
              ...(options.resetCursor ? { cursor: undefined } : {}),
            }),
            replace: options.replace ?? false,
          });
        },
        apply: (text, filters) =>
          change((raw) => ({
            ...writeListQuery(raw, staffDocumentQueryOptions, { search: text, filters }),
            documentId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/documents/')({
  validateSearch: staffDocumentsSearch,
  beforeLoad: ({ search }) => {
    if (typeof search.documentId === 'string')
      throw redirect({
        to: '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}',
        params: { documentId: search.documentId.toLowerCase() },
        search: staffDocumentFilters(search),
        replace: true,
      });
  },
  component: DocumentsRoute,
  pendingComponent: StaffRecordLoading,
});
