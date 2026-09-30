import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** Native search/sort fields and independent filter/create/view actions. */
export function ListToolbar({
  search,
  sort,
  filters,
  actions,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  search?: ReactNode;
  sort?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      data-slot="list-toolbar"
      className={cn('flex min-w-0 flex-wrap items-end gap-3', className)}
      {...props}
    >
      {search && <div className="min-w-0 flex-1 basis-full sm:basis-48">{search}</div>}
      {sort && <div className="w-full min-w-0 sm:w-auto">{sort}</div>}
      {filters && (
        <div className="min-w-0 flex-1 basis-full self-start sm:basis-auto">{filters}</div>
      )}
      {actions && <div className="flex flex-wrap items-center gap-3 self-start">{actions}</div>}
      {children}
    </div>
  );
}
