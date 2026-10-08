import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@barghsa/ui';
import { tWorkspace as t, type Locale } from '@barghsa/i18n/workspace-admin';

import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';

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
        showCloseButton={false}
        className="max-h-[85dvh] overflow-y-auto"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>{word('title')}</DialogTitle>
          <DialogDescription>{word('description')}</DialogDescription>
        </DialogHeader>
        {state === 'loading' && <p role="status">{word('loading')}</p>}
        {state === 'error' && <p role="alert">{word('error')}</p>}
        {state === 'ready' && (
          <ul className="space-y-3 break-words" aria-label={word('saved')}>
            {rows.map((before, index) => (
              <li key={before.id} className="rounded border p-3">
                {saved[index] ? (
                  renderRecord(saved[index], true)
                ) : (
                  <>
                    {renderRecord(before, false)}
                    <p>{word('missing')}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={state === 'loading'}
            onClick={() => setRevision((value) => value + 1)}
          >
            {word('retry')}
          </Button>
          <Button disabled={state !== 'ready'} onClick={onReviewed}>
            {word('reviewed')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
