import { createFileRoute, redirect } from '@tanstack/react-router';
import { adminEditorId } from '../../lib/admin-editor-search.js';
import {
  productCatalogueLocationSearch,
  productCatalogueType,
} from '../../lib/catalogue-category-query.js';

export const Route = createFileRoute('/admin/catalogue')({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...productCatalogueLocationSearch(raw),
    type: productCatalogueType(raw.type),
    selected: raw.selected === 'new' ? 'new' : adminEditorId(raw.selected),
  }),
  beforeLoad: ({ search: { type, selected, ...search } }) => {
    const category = type ?? 'consultation';
    if (selected === 'new' && category !== 'electricity')
      throw redirect({
        to: '/admin/catalogue/$category/new',
        params: { category },
        search,
        replace: true,
      });
    if (selected && selected !== 'new')
      throw redirect({
        to: '/admin/catalogue/$category/$productId/edit',
        params: { category, productId: selected },
        search,
        replace: true,
      });
    throw redirect({
      to: '/admin/catalogue/$category',
      params: { category },
      search,
      replace: true,
    });
  },
});
