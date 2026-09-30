import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
import { AsyncView } from './workflow';
import { Button } from './button';
import { ListToolbar } from './list-toolbar';
import { Pagination } from './pagination';

function ListPageRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="list-page" className={cn('min-w-0 space-y-4', className)} {...props} />;
}

/** Initial states replace content; page loads and their failures retain accepted rows. */
export function ListPageContent({
  retainContent = false,
  ...props
}: ComponentProps<typeof AsyncView> & { retainContent?: boolean }) {
  return (
    <div
      data-slot="list-content"
      className="min-w-0 space-y-4"
      aria-busy={props.loading || undefined}
    >
      {retainContent && (props.loading ? props.loadingView : props.error ? props.errorView : null)}
      <AsyncView
        {...props}
        loading={props.loading && !retainContent}
        error={props.error && !retainContent}
        empty={props.empty && !retainContent}
      />
    </div>
  );
}

type ListPaginationProps =
  | ({ kind: 'page' } & ComponentProps<typeof Pagination>)
  | {
      kind: 'cursor';
      hasMore: boolean;
      loading: boolean;
      onNext: () => void;
      label: string;
      nextLabel: string;
    };

export function ListPagination(props: ListPaginationProps) {
  if (props.kind === 'page') {
    const { kind: _kind, ...pagination } = props;
    return <Pagination {...pagination} />;
  }
  if (!props.hasMore) return null;
  return (
    <nav data-slot="list-pagination" aria-label={props.label}>
      <Button type="button" variant="outline" loading={props.loading} onClick={props.onNext}>
        {props.nextLabel}
      </Button>
    </nav>
  );
}

export const ListPage = Object.assign(ListPageRoot, {
  Toolbar: ListToolbar,
  Content: ListPageContent,
  Pagination: ListPagination,
});
