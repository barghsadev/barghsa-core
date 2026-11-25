import { lazyRouteComponent, useNavigate } from '@tanstack/react-router';
import { useListQuery } from '../hooks/useListQuery.js';
import {
  documentTemplateQueryOptions,
  documentTemplatesSearch,
} from '../lib/template-catalogue-query.js';

import {
  documentTemplateRoutes,
  type DocumentTemplateView,
} from '../lib/template-catalogue-routes.js';

const Page = lazyRouteComponent(() => import('../pages/AdminDocumentTemplatesPage.js'));

export function DocumentTemplateRouteWorkspace({
  view,
  templateId,
  versionId,
  search,
}: {
  view: DocumentTemplateView;
  templateId?: string;
  versionId?: string;
  search: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const routes = documentTemplateRoutes;
  const queries = useListQuery(documentTemplateQueryOptions, search, (update, options) => {
    void navigate({
      to: routes.list,
      search: (raw) => documentTemplatesSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const routeSearch = documentTemplatesSearch(search);
  return (
    <Page
      key={view + (templateId ?? '') + (versionId ?? '')}
      view={view}
      {...(templateId ? { templateId } : {})}
      {...(versionId ? { versionId } : {})}
      routeSearch={routeSearch}
      queries={queries}
      onSettled={(id, version) => {
        if (id && version) {
          void navigate({
            to: routes.version,
            params: { templateId: id, version },
            search: routeSearch,
            replace: true,
          });
        } else if (id) {
          void navigate({
            to: routes.detail,
            params: { templateId: id },
            search: routeSearch,
            replace: true,
          });
        } else {
          void navigate({ to: routes.list, search: routeSearch, replace: true });
        }
      }}
    />
  );
}
