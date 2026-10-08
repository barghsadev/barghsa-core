import { useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@barghsa/ui';
import { tWorkspace as t, type Locale } from '@barghsa/i18n/workspace-admin';

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
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saved, setSaved] = useState<(T | null)[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setSaved([]);
    void Promise.all(
      rows.map(async (before) => {
        const response = await fetch(`${endpoint}/${encodeURIComponent(before.id)}`, {
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) throw new Error('denied');
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('unavailable');
        const value: unknown = await response.json();
        if (!validate(value) || identity(value) !== identity(before))
          throw new Error('invalid record');
        return value;
      })
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setSaved(result);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof Error && reason.message === 'denied') onDenied();
        else setState('error');
        controller.abort();
      });
    return () => controller.abort();
  }, [endpoint, rows, validate, identity, revision, onDenied]);
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
