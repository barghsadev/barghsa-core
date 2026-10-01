import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import { staffDocumentQueryOptions, staffDocumentsSearch } from '../../lib/record-list-query.js';
import { createFileRoute } from '@tanstack/react-router';
import AdminDocumentsPage from '../../pages/AdminDocumentsPage.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

function DocumentsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (raw) => staffDocumentsSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(staffDocumentQueryOptions, search, change);
  return (
    <AdminDocumentsPage
      queries={{
        queue,
        selected: typeof search.documentId === 'string' ? search.documentId : null,
        select: (id, options = {}) =>
          change(
            (raw) => ({
              ...raw,
              documentId: id ?? undefined,
              ...(options.resetCursor ? { cursor: undefined } : {}),
            }),
            options
          ),
        apply: (text, filters) =>
          change((raw) => ({
            ...writeListQuery(raw, staffDocumentQueryOptions, { search: text, filters }),
            documentId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/documents')({
  validateSearch: staffDocumentsSearch,
  component: DocumentsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
