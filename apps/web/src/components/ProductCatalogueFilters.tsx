import { useEffect, useRef, type FormEvent } from 'react';
import { Button, Label, ListSearchInput, ListToolbar, NativeSelect } from '@barghsa/ui';
import {
  CATALOGUE_SEARCH_LIMIT,
  CATALOGUE_SORT_FIELDS,
  CATALOGUE_PAGE_SIZES,
  CATALOGUE_STATUSES,
  parseCatalogueListQuery,
} from '@barghsa/shared/catalogue-query';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { t as workspaceText } from '@barghsa/i18n/workspace';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { CatalogueFieldFeedback, catalogueRootMessage } from './CatalogueEditorFeedback.js';
interface Draft {
  search: string;
  status: string;
  sort: string;
  order: string;
  limit: string;
}
export function ProductCatalogueFilters({
  queries,
  locale,
  disabled,
}: {
  queries: ListQueryBinding;
  locale: 'en' | 'fa';
  disabled: boolean;
}) {
  const copy = (key: string) => tCatalogue(key, locale);
  const numbers = useNumberFormatting(locale);
  const current: Draft = {
    search: queries.query.search,
    status: queries.query.filters.status || '',
    sort: queries.query.sort,
    order: queries.query.order,
    limit: String(queries.query.pageSize),
  };
  const basis = JSON.stringify(current);
  const messages = {
    search: copy('invalidSearch'),
    status: copy('invalidQuery'),
    sort: copy('invalidQuery'),
    order: copy('invalidQuery'),
    limit: copy('invalidQuery'),
  };
  const form = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<Draft>(messages, (value) => {
        if (parseCatalogueListQuery(value as unknown as Record<string, unknown>)) return [];
        return value.search.trim().length > CATALOGUE_SEARCH_LIMIT
          ? ['search']
          : ['status', 'sort', 'order', 'limit'];
      });
    },
    current,
    copy('validationUnavailable')
  );
  const mounted = useRef(true);
  const live = useRef({ disabled, scope: JSON.stringify(queries.query) });
  live.current = { disabled, scope: JSON.stringify(queries.query) };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    form.form.reset(JSON.parse(basis) as Draft);
  }, [basis, form.form.reset]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || form.isPending()) return;
    const scope = live.current.scope;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit((value) => {
        if (!mounted.current || live.current.disabled || live.current.scope !== scope) return;
        const query = parseCatalogueListQuery(value as unknown as Record<string, unknown>);
        if (!query) return;
        queries.setQuery({
          search: query.search,
          sort: query.sort,
          order: query.order,
          filters: { status: query.status },
          pageSize: query.limit,
        });
      })();
    } finally {
      if (mounted.current) form.setValidationPending(false);
    }
  }
  const selects: { field: keyof Draft; options: readonly string[] }[] = [
    { field: 'status', options: ['', ...CATALOGUE_STATUSES] },
    { field: 'sort', options: CATALOGUE_SORT_FIELDS },
    { field: 'order', options: ['desc', 'asc'] },
    { field: 'limit', options: CATALOGUE_PAGE_SIZES.map(String) },
  ];
  const rootError = catalogueRootMessage(form.errors);
  const filterCount = [
    current.status,
    current.sort !== 'createdAt',
    current.order !== 'desc',
    current.limit !== '25',
  ].filter(Boolean).length;
  return (
    <form
      aria-label={copy('listFilters')}
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-busy={form.pending || undefined}
      className="min-w-0"
    >
      {rootError && <p role="alert">{rootError}</p>}
      <fieldset disabled={disabled || form.pending} className="min-w-0">
        <ListToolbar
          className="items-start"
          search={
            <div>
              <ListSearchInput
                label={copy('search')}
                id="product-search"
                {...form.bind('search')}
                value={form.values.search}
                onChange={(event) => form.field('search')[1](event.target.value)}
              />
              {form.errors.search && (
                <CatalogueFieldFeedback
                  id={form.errorId('search')}
                  error={form.errors.search}
                  message={messages.search}
                />
              )}
            </div>
          }
          moreFilters={{
            label: workspaceText('historyFilters.label', locale),
            count: filterCount ? numbers.number(filterCount) : undefined,
            children: (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {selects.map(({ field, options }) => (
                  <div key={field} className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor={`product-filter-${field}`}>{copy(`filter_${field}`)}</Label>
                    <NativeSelect
                      id={`product-filter-${field}`}
                      {...form.bind(field)}
                      value={form.values[field]}
                      onChange={(event) => form.field(field)[1](event.target.value)}
                      className="w-full"
                    >
                      {options.map((value) => (
                        <option key={value} value={value}>
                          {field === 'limit'
                            ? value
                            : copy(value ? `query_${value}` : 'allStatuses')}
                        </option>
                      ))}
                    </NativeSelect>
                    <CatalogueFieldFeedback
                      id={form.errorId(field)}
                      error={form.errors[field]}
                      message={messages[field]}
                    />
                  </div>
                ))}
              </div>
            ),
          }}
          actions={
            <>
              <Button type="submit" variant="secondary" loading={form.pending}>
                {copy('applyFilters')}
              </Button>
              {(filterCount > 0 || current.search || form.form.formState.isDirty) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    form.form.reset({
                      search: '',
                      status: '',
                      sort: 'createdAt',
                      order: 'desc',
                      limit: '25',
                    });
                    queries.setQuery({
                      search: '',
                      sort: 'createdAt',
                      order: 'desc',
                      filters: { status: '' },
                      pageSize: 25,
                    });
                  }}
                >
                  {copy('clearFilters')}
                </Button>
              )}
            </>
          }
        />
      </fieldset>
    </form>
  );
}
