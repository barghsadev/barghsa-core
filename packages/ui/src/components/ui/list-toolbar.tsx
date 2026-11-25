import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { RefreshCwIcon, SearchIcon, SlidersHorizontalIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';

export function ListSearchInput({
  label,
  placeholder = label,
  className,
  dir,
  ...props
}: ComponentProps<typeof Input> & { label: string }) {
  return (
    <div dir={dir} className="relative min-w-0">
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        dir={dir}
        aria-label={label}
        placeholder={placeholder}
        className={cn('ps-9', className)}
        {...props}
      />
    </div>
  );
}

export function ListRefreshButton({
  label,
  refreshing = false,
  className,
  disabled,
  ...props
}: Pick<
  ComponentProps<typeof Button>,
  'onClick' | 'disabled' | 'className' | 'ref' | 'focusableWhenDisabled'
> & {
  label: string;
  refreshing?: boolean;
}) {
  return (
    <Button
      data-list-refresh=""
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      aria-busy={refreshing || undefined}
      disabled={disabled || refreshing}
      className={cn('text-muted-foreground', className)}
      {...props}
    >
      <RefreshCwIcon
        aria-hidden="true"
        className={refreshing ? 'motion-safe:animate-spin' : undefined}
      />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

/** Native search/sort fields and independent filter/create/view actions. */
export function ListToolbar({
  search,
  sort,
  filters,
  moreFilters,
  actions,
  refresh,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  search?: ReactNode;
  sort?: ReactNode;
  filters?: ReactNode;
  moreFilters?: { label: string; count?: string | undefined; children: ReactNode } | undefined;
  actions?: ReactNode;
  refresh?: ReactNode;
}) {
  const filterId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  return (
    <div
      data-slot="list-toolbar"
      className={cn(
        'flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2 [&>[data-list-refresh]]:ms-auto',
        className
      )}
      {...props}
    >
      {filters && <div className="min-w-0 grow basis-full self-end lg:basis-72">{filters}</div>}
      {search && (
        <div
          data-slot="list-toolbar-search"
          className="min-w-0 grow basis-full sm:basis-60 [&_[data-slot=list-search-label]]:sr-only"
        >
          {search}
        </div>
      )}
      {sort && (
        <div className="min-w-0 max-w-full [&_[data-slot=list-sort-label]]:sr-only">{sort}</div>
      )}
      {moreFilters && (
        <Button
          type="button"
          variant="outline"
          aria-label={moreFilters.label}
          aria-expanded={filtersOpen}
          aria-controls={filterId}
          aria-describedby={moreFilters.count ? `${filterId}-count` : undefined}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontalIcon data-icon="inline-start" aria-hidden="true" />
          {moreFilters.label}
          {moreFilters.count && (
            <Badge id={`${filterId}-count`} variant="secondary">
              {moreFilters.count}
            </Badge>
          )}
        </Button>
      )}
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      {children}
      {refresh && <div className="ms-auto shrink-0">{refresh}</div>}
      {moreFilters && (
        <div
          id={filterId}
          hidden={!filtersOpen}
          className="min-w-0 basis-full rounded-lg border bg-card p-3 sm:p-4"
        >
          {moreFilters.children}
        </div>
      )}
    </div>
  );
}
