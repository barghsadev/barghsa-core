import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  customerDocumentQueryOptions,
  customerDocumentsSearch,
} from '../../lib/record-list-query.js';
import { useProfileContextReset } from '../../lib/profile-context.js';
import { createFileRoute } from '@tanstack/react-router';
import DocumentsPage from '../../pages/DocumentsPage.js';
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
      search: (raw) => customerDocumentsSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(customerDocumentQueryOptions, search, change);
  useProfileContextReset(() => {
    change((raw) => ({ ...raw, cursor: undefined, documentId: undefined }), { replace: true });
  });
  return (
    <DocumentsPage
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
            ...writeListQuery(raw, customerDocumentQueryOptions, { search: text, filters }),
            documentId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/_app/documents')({
  validateSearch: customerDocumentsSearch,
  component: DocumentsRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
