import { lazyRouteComponent, useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { useListQuery } from '../hooks/useListQuery.js';
import {
  productCatalogueLocationSearch,
  productCatalogueQueryOptions,
  type ProductCatalogueType,
} from '../lib/catalogue-category-query.js';
import type { CatalogueView, SavingConfigurationEditor } from '../pages/AdminCataloguePage.js';

const Page = lazyRouteComponent(() => import('../pages/AdminCataloguePage.js'));

export function CatalogueRouteWorkspace({
  category,
  search,
  view,
  productId,
  configurationEditor,
}: {
  category: ProductCatalogueType;
  search: Record<string, unknown>;
  view: CatalogueView;
  productId?: string;
  configurationEditor?: SavingConfigurationEditor;
}) {
  const navigate = useNavigate();
  const focusCategory = useRef(false);
  const queries = useListQuery(
    productCatalogueQueryOptions,
    { ...search, type: category },
    (update, options) => {
      void navigate({
        to: '/admin/catalogue/$category',
        params: { category },
        search: (current) => productCatalogueLocationSearch(update({ ...current, type: category })),
        replace: options?.replace ?? false,
        resetScroll: false,
      });
    }
  );
  const list = () =>
    void navigate({
      to: '/admin/catalogue/$category',
      params: { category },
      search,
    });
  return (
    <Page
      key={JSON.stringify([category, view, productId, configurationEditor])}
      view={view}
      {...(configurationEditor && { configurationEditor })}
      initialType={category}
      focusCategory={focusCategory.current}
      {...(view === 'list' ? { queries } : {})}
      routeSearch={search}
      onTypeChange={(next) => {
        focusCategory.current = true;
        void navigate({
          to: '/admin/catalogue/$category',
          params: { category: next },
          search: { ...search, page: undefined },
        });
      }}
      selection={{
        id: view === 'new' ? 'new' : (productId ?? null),
        set: (selected, replace) => {
          if (!selected) list();
          else if (selected === 'new')
            void navigate({
              to: '/admin/catalogue/$category/new',
              params: { category },
              search,
              replace,
            });
          else
            void navigate({
              to: '/admin/catalogue/$category/$productId/edit',
              params: { category, productId: selected },
              search,
              replace,
            });
        },
      }}
      onRecordSaved={(id) =>
        void navigate({
          to: '/admin/catalogue/$category/$productId',
          params: { category, productId: id },
          search,
          replace: true,
        })
      }
    />
  );
}
