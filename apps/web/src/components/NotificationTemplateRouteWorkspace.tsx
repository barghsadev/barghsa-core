import { lazyRouteComponent, useNavigate } from '@tanstack/react-router';
import { useListQuery } from '../hooks/useListQuery.js';
import { previewQueryOptions } from '../lib/notification-panel-query.js';
import {
  notificationTemplateQueryOptions,
  notificationTemplatesSearch,
} from '../lib/template-catalogue-query.js';

import {
  notificationTemplateRoutes,
  type NotificationTemplateView,
} from '../lib/template-catalogue-routes.js';

const Page = lazyRouteComponent(() => import('../pages/AdminNotificationsPage.js'));

export function NotificationTemplateRouteWorkspace({
  view,
  templateId,
  search,
}: {
  view: NotificationTemplateView;
  templateId?: string;
  search: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const updateSearch = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) => {
    void navigate({
      to: view === 'compare' ? '/admin/notifications/preview' : '/admin/notifications',
      search: (raw) => notificationTemplatesSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  };
  const queries = useListQuery(notificationTemplateQueryOptions, search, updateSearch);
  const previewQueries = useListQuery(previewQueryOptions, search, updateSearch);
  return (
    <Page
      key={view + (templateId ?? '')}
      view={view}
      {...(templateId ? { templateId } : {})}
      routeSearch={search}
      queries={queries}
      previewQueries={previewQueries}
      onSettled={(id) => {
        if (id) {
          void navigate({
            to: notificationTemplateRoutes.detail,
            params: { templateId: id },
            search,
            replace: true,
          });
        } else {
          void navigate({ to: '/admin/notifications', search, replace: true });
        }
      }}
    />
  );
}
