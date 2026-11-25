import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { AsyncView } from './workflow';
import { Button } from './button';
import { ListToolbar } from './list-toolbar';
import { Pagination } from './pagination';
import { ResultGlyph } from './page-states';

function decorateListMessage(content: ReactNode, error = false) {
  if (
    error &&
    isValidElement<ComponentProps<'div'>>(content) &&
    content.type === 'div' &&
    content.props.role === 'alert'
  ) {
    return cloneElement(
      content,
      {
        className: cn(
          'flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm',
          content.props.className,
          'space-y-0'
        ),
      },
      <>
        <ResultGlyph error />
        <div className="min-w-0 space-y-2">{content.props.children}</div>
      </>
    );
  }
  const paragraph =
    isValidElement<ComponentProps<'p'>>(content) && content.type === 'p' ? content : null;
  if (!paragraph && typeof content !== 'string') return content;
  const body = (
    <>
      <ResultGlyph error={error} />
      <span className="min-w-0">{paragraph ? paragraph.props.children : content}</span>
    </>
  );
  const className = cn(
    'flex min-h-20 items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm',
    paragraph?.props.className
  );
  return paragraph ? (
    cloneElement(paragraph, { className }, body)
  ) : (
    <p className={className}>{body}</p>
  );
}

function ListPageRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="list-page" className={cn('min-w-0 space-y-4', className)} {...props} />;
}

/** Initial states replace content; page loads and their failures retain accepted rows. */
export function ListPageContent({
  retainContent = false,
  ...props
}: ComponentProps<typeof AsyncView> & { retainContent?: boolean }) {
  const errorView = decorateListMessage(props.errorView, true);
  return (
    <div
      data-slot="list-content"
      className="min-w-0 space-y-4"
      aria-busy={props.loading || undefined}
    >
      {retainContent && (props.loading ? props.loadingView : props.error ? errorView : null)}
      <AsyncView
        {...props}
        loading={props.loading && !retainContent}
        error={props.error && !retainContent}
        empty={props.empty && !retainContent}
        errorView={errorView}
        emptyView={decorateListMessage(props.emptyView)}
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
      previous?: { enabled: boolean; label: string; onClick: () => void };
    };

export function ListPagination(props: ListPaginationProps) {
  if (props.kind === 'page') {
    const { kind: _kind, ...pagination } = props;
    return <Pagination {...pagination} />;
  }
  if (!props.hasMore && !props.previous?.enabled) return null;
  return (
    <nav data-slot="list-pagination" aria-label={props.label} className="flex flex-wrap gap-2">
      {props.previous && (
        <Button
          type="button"
          variant="outline"
          disabled={props.loading || !props.previous.enabled}
          onClick={props.previous.onClick}
        >
          {props.previous.label}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        loading={props.loading}
        disabled={!props.hasMore}
        onClick={props.onNext}
      >
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
