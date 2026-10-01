import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@barghsa/ui';
import {
  isConfigAuditPage,
  type ConfigAuditScope,
  type ConfigAuditEntry,
  type ConfigAuditSnapshot,
} from '@barghsa/shared/admin';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';

export function AuditLogViewer(props: {
  scope: ConfigAuditScope;
  refreshKey?: string | number;
  onDenied?: () => void;
}) {
  return <AuditTimeline key={props.scope} {...props} />;
}
function AuditTimeline({
  scope: kind,
  refreshKey,
  onDenied,
}: {
  scope: ConfigAuditScope;
  refreshKey?: string | number;
  onDenied?: () => void;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    time = useAccountTime(),
    id = useId();
  const word = (key: string) => t(`admin.audit.${key}`, locale);
  const [open, setOpen] = useState(false),
    [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<ConfigAuditEntry[]>([]),
    [next, setNext] = useState<string | null>(null),
    [cycle, setCycle] = useState(false);
  const seen = useRef(new Set<string>()),
    handled = useRef<unknown>(null);
  const denial = useRef(onDenied);
  denial.current = onDenied;
  const clear = useCallback(() => {
    setItems([]);
    setCursor(null);
    setNext(null);
    setCycle(false);
    seen.current.clear();
    handled.current = null;
    denial.current?.();
  }, []);
  const boundary = useCatalogueScope(clear);
  const validate = useCallback(
    (value: unknown): value is import('@barghsa/shared/admin').ConfigAuditPage =>
      isConfigAuditPage(value) && value.scope === kind,
    [kind]
  );
  const path = open
    ? `/api/admin/config/audit?scope=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    : null;
  const read = useCatalogueResource(boundary, path, validate);
  useEffect(() => {
    if (!read.data || handled.current === read.data || boundary.denied) return;
    handled.current = read.data;
    if (!cursor) seen.current.clear();
    else seen.current.add(cursor);
    const repeated = !!read.data.nextCursor && seen.current.has(read.data.nextCursor);
    setCycle(repeated);
    setNext(repeated ? null : read.data.nextCursor);
    const page = read.data.items;
    setItems((previous) =>
      cursor
        ? [
            ...previous,
            ...page.filter((row) => !previous.some((existing) => existing.id === row.id)),
          ]
        : page
    );
  }, [read.data, cursor, boundary.denied]);
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    if (!open) return;
    if (cursor) setCursor(null);
    else read.retry();
  }, [refreshKey, open, cursor, read.retry]);
  function refresh() {
    setCycle(false);
    if (boundary.denied) boundary.recover();
    else if (cursor) setCursor(null);
    else read.retry();
  }
  function display(snapshot: ConfigAuditSnapshot) {
    if (!snapshot.recorded) return word('unknown');
    if (snapshot.value === null) return word('none');
    if (typeof snapshot.value === 'boolean') return word(snapshot.value ? 'yes' : 'no');
    if (typeof snapshot.value === 'number') return numbers.number(snapshot.value);
    return snapshot.value || word('emptyValue');
  }
  return (
    <section aria-labelledby={id} className="min-w-0" data-testid="config-audit">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={id}>{word('title')}</h2>
          </CardTitle>
          <CardDescription>{word('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            className="self-start"
            aria-expanded={open}
            aria-controls={`${id}-entries`}
            onClick={() => setOpen((value) => !value)}
          >
            {word(open ? 'hide' : 'show')}
          </Button>
          {open && (
            <div id={`${id}-entries`} className="flex min-w-0 flex-col gap-4">
              {time.notice}
              {read.loading && <p role="status">{word('loading')}</p>}
              {(read.error || cycle || boundary.denied) && (
                <p role="alert">{word(boundary.denied ? 'denied' : 'error')}</p>
              )}
              {!read.loading && !read.error && !boundary.denied && items.length === 0 && (
                <p>{word('empty')}</p>
              )}
              <ol className="flex min-w-0 flex-col gap-4">
                {items.map((entry) => (
                  <li key={entry.id} className="min-w-0 border-s ps-4">
                    <details>
                      <summary className="cursor-pointer rounded py-3 focus-visible:outline-2 focus-visible:outline-ring break-words">
                        <span className="font-medium">{word(entry.event)}</span>{' '}
                        {entry.version !== null && (
                          <Badge variant="outline">
                            {t('admin.settings.version', locale).replace(
                              '{version}',
                              numbers.number(entry.version, { useGrouping: false })
                            )}
                          </Badge>
                        )}
                        <span className="mt-2 block text-sm text-muted-foreground">
                          <time dateTime={entry.createdAt}>{time.format(entry.createdAt)}</time>
                        </span>
                        <span className="mt-1 block text-sm">
                          {word('by')}{' '}
                          <bdi className="break-all">{entry.actorId ?? word('unknownActor')}</bdi>
                        </span>
                      </summary>
                      <div className="flex min-w-0 flex-col gap-4 pb-3">
                        {!entry.detailsAvailable && <p>{word('unavailable')}</p>}
                        {entry.detailsAvailable && entry.changes.length === 0 && (
                          <p>{word('unchanged')}</p>
                        )}
                        {entry.changes.map((change) => (
                          <div key={change.field} className="flex min-w-0 flex-col gap-2">
                            <h3 className="text-sm font-medium">{word(`field.${change.field}`)}</h3>
                            <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                              {(['previous', 'current'] as const).map((key) => (
                                <div key={key} className="min-w-0">
                                  <dt className="text-sm text-muted-foreground">{word(key)}</dt>
                                  <dd className="whitespace-pre-wrap break-words" dir="auto">
                                    {display(change[key])}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ))}
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
        {open && (
          <CardFooter className="flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={read.loading}
              onClick={read.error && cursor ? read.retry : refresh}
            >
              {word(read.error || boundary.denied ? 'retry' : 'refresh')}
            </Button>
            {next && (
              <Button
                type="button"
                variant="outline"
                disabled={read.loading || read.error || cycle || boundary.denied}
                onClick={() => setCursor(next)}
              >
                {word('more')}
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
    </section>
  );
}
