import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  LoadingStatus,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@barghsa/ui';
import { CircleHelpIcon, RefreshCwIcon } from 'lucide-react';
import { tWorkspace as t, type Locale } from '@barghsa/i18n/workspace-admin';

import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';

export function OperationalCommandChecks({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <details className="text-sm text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm py-2">
        {t('admin.operationalReview.checks', locale)}
      </summary>
      <div className="flex flex-wrap gap-2 py-2">{children}</div>
    </details>
  );
}

export function OperationalCommandRecords<T extends { id: string }>({
  locale,
  current = false,
  rows,
  render,
}: {
  locale: Locale;
  current?: boolean;
  rows: readonly T[];
  render: (row: T, index: number) => ReactNode;
}) {
  return (
    <ul
      aria-label={t(
        current ? 'admin.operationalReview.saved' : 'admin.operationalReview.selected',
        locale
      )}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll long selections.
      tabIndex={0}
      className="min-h-0 max-h-[35dvh] divide-y overflow-y-auto overscroll-contain rounded-lg border bg-muted/25 text-sm [overflow-wrap:anywhere]"
    >
      {rows.map((row, index) => (
        <li key={row.id} className="space-y-1 px-3 py-2.5">
          {render(row, index)}
        </li>
      ))}
    </ul>
  );
}

/** Read the exact captured targets; a queue page cannot establish their saved status. */
export function OperationalCommandReview<T extends { id: string }>({
  locale,
  endpoint,
  rows,
  validate,
  identity,
  renderRecord,
  onDenied,
  onReviewed,
}: {
  locale: Locale;
  endpoint: string;
  rows: readonly T[];
  validate: (value: unknown) => value is T;
  identity: (row: T) => string;
  renderRecord: (row: T, available: boolean) => ReactNode;
  onDenied: () => void;
  onReviewed: () => void;
}) {
  const word = (key: string) => t(`admin.operationalReview.${key}`, locale);
  const [revision, setRevision] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const reader = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const inputs = useRef({ rows, validate, identity, onDenied, revision: 0 });
  if (
    inputs.current.rows !== rows ||
    inputs.current.validate !== validate ||
    inputs.current.identity !== identity ||
    inputs.current.onDenied !== onDenied
  )
    inputs.current = { rows, validate, identity, onDenied, revision: inputs.current.revision + 1 };
  const query = useServerDetailQuery<(T | null)[]>({
    queryKey: queryKeys.operations.detail(
      { context: 'staff', ownerId: reader, accountId, revision: profileRevision },
      JSON.stringify([endpoint, rows.map(identity), inputs.current.revision, revision])
    ),
    manual: true,
    read: async (signal) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      try {
        return await Promise.all(
          rows.map(async (before) => {
            const response = await fetch(`${endpoint}/${encodeURIComponent(before.id)}`, {
              signal: controller.signal,
            });
            if (response.status === 401 || response.status === 403)
              throw new ServerQueryError(response.status);
            if (response.status === 404) return null;
            if (!response.ok) throw new ServerQueryError(response.status);
            const value: unknown = await response.json();
            if (!validate(value) || identity(value) !== identity(before))
              throw new Error('invalid record');
            return value;
          })
        );
      } catch (error) {
        controller.abort();
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
  });
  useEffect(() => {
    if (
      query.error instanceof ServerQueryError &&
      (query.error.status === 401 || query.error.status === 403)
    )
      onDenied();
  }, [query.error, onDenied]);
  const state = query.isPending || query.isFetching ? 'loading' : query.isError ? 'error' : 'ready';
  const saved = query.data ?? [];
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        size="lg"
        showCloseButton={false}
        initialFocus={title}
        className="top-[50dvh] flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader className="shrink-0 border-b bg-muted/30 p-4 sm:px-5">
          <DialogTitle ref={title} tabIndex={-1} className="flex items-center gap-2 leading-snug">
            <CircleHelpIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            {word('title')}
          </DialogTitle>
          <DialogDescription>{word('description')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 p-4 sm:px-5">
          {state === 'loading' && <LoadingStatus>{word('loading')}</LoadingStatus>}
          {state === 'error' && <Alert variant="warning">{word('error')}</Alert>}
          {state === 'ready' && (
            <OperationalCommandRecords
              locale={locale}
              current
              rows={rows}
              render={(before, index) =>
                saved[index] ? (
                  renderRecord(saved[index], true)
                ) : (
                  <>
                    {renderRecord(before, false)}
                    <p className="text-xs text-muted-foreground">{word('missing')}</p>
                  </>
                )
              }
            />
          )}
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 flex-row flex-wrap justify-end rounded-none px-4 py-3 sm:px-5">
          <Button
            variant={state === 'error' ? 'outline' : 'ghost'}
            disabled={state === 'loading'}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCwIcon aria-hidden="true" />
            {word('retry')}
          </Button>
          <Button disabled={state !== 'ready'} onClick={onReviewed}>
            {word('reviewed')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
