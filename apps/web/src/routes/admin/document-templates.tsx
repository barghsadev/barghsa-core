import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  documentTemplateQueryOptions,
  documentTemplatesSearch,
} from '../../lib/template-catalogue-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminDocumentTemplatesPage.js'));
function DocumentTemplatesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(documentTemplateQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => documentTemplatesSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}

export const Route = createFileRoute('/admin/document-templates')({
  validateSearch: documentTemplatesSearch,
  component: DocumentTemplatesRoute,
});
