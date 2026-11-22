import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  documentTemplateQueryOptions,
  documentTemplatesSearch,
} from '../../lib/template-catalogue-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminDocumentTemplatesPage.js'));

function validateSearch(raw: Record<string, unknown>) {
  const selected = raw.selected === 'new' ? 'new' : adminEditorId(raw.selected);
  return {
    ...documentTemplatesSearch(raw),
    selected,
    mode: selected && selected !== 'new' && raw.mode === 'edit' ? 'edit' : undefined,
  };
}

function DocumentTemplatesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(documentTemplateQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => validateSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const select = useCallback(
    (id: string | null, edit: boolean, replace = false) => {
      void navigate({
        search: (raw) =>
          validateSearch({
            ...raw,
            selected: id ?? (edit ? 'new' : undefined),
            mode: edit ? 'edit' : undefined,
          }),
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  return (
    <Page
      queries={queries}
      selection={{
        id: search.selected === 'new' ? null : (search.selected ?? null),
        edit: search.selected === 'new' || search.mode === 'edit',
        set: select,
      }}
    />
  );
}

export const Route = createFileRoute('/admin/document-templates')({
  validateSearch,
  component: DocumentTemplatesRoute,
});
