import { parseTemplateEventKey } from '@barghsa/shared/notifications';
import { listChoice, parseListQuery, type ListQueryOptions } from './list-query.js';
import { notificationPanelSearch } from './notification-panel-query.js';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [30],
  defaultPageSize: 30,
  pagination: 'page',
};
export const documentTemplateQueryOptions: ListQueryOptions = {
  ...base,
  searchLimit: 100,
  filters: { category: listChoice(['general', 'contract', 'invoice']) },
};
export const notificationTemplateQueryOptions: ListQueryOptions = {
  ...base,
  filters: {
    eventKey: parseTemplateEventKey,
    locale: listChoice(['fa', 'en']),
    channel: listChoice(['email', 'sms', 'in_app']),
    status: listChoice(['draft', 'active', 'archived']),
  },
};
function catalogueSearch(
  raw: Record<string, unknown>,
  options: ListQueryOptions
): Record<string, unknown> {
  const query = parseListQuery(raw, options);
  return {
    ...(options.searchLimit ? { q: query.search || undefined } : {}),
    ...Object.fromEntries(
      Object.entries(query.filters).map(([key, value]) => [key, value || undefined])
    ),
  };
}
export const documentTemplatesSearch = (raw: Record<string, unknown>) =>
  catalogueSearch(raw, documentTemplateQueryOptions);
export const notificationTemplatesSearch = (raw: Record<string, unknown>) => ({
  ...catalogueSearch(raw, notificationTemplateQueryOptions),
  ...notificationPanelSearch(raw),
});
