import { lazy, Suspense, useCallback, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  ListFilterPanel,
  ListPage,
  ListRefreshButton,
  LoadingStatus,
} from '@barghsa/ui';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import {
  isConfigAuditPage,
  type ConfigAuditEntry,
  type ConfigAuditPage,
} from '@barghsa/shared/admin';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNavigation } from '../hooks/useNavigation.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  authorizationAuditFilterKeys,
  authorizationAuditSearch,
  type AuthorizationAuditFilters,
} from '../lib/authorization-audit-query.js';

interface AuditProps {
  filters: AuthorizationAuditFilters;
  eventId?: string;
  onApply?: (filters: AuthorizationAuditFilters) => void;
}

const AuditFilterFields = lazy(() => import('../components/AuthorizationAuditFilterFields.js'));

function AuditFilters({
  filters,
  onApply,
}: {
  filters: AuthorizationAuditFilters;
  onApply: (filters: AuthorizationAuditFilters) => void;
}) {
  const locale = useLocale();
  const { number } = useNumberFormatting(locale);
  const word = (key: string) => t(`admin.audit.authorization.${key}`, locale);
  const copy = (key: string) => appText(`historyFilters.${key}`, locale);
  const [draft, setDraft] = useState(filters);
  const trimmed = { ...draft, actor: draft.actor?.trim(), action: draft.action?.trim() };
  const parsed = authorizationAuditSearch(trimmed);
  const displayDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const chips = authorizationAuditFilterKeys.flatMap((key) => {
    const value = filters[key];
    if (!value) return [];
    const name = word(`filter.${key}`);
    const shown = key === 'from' || key === 'through' ? displayDate.format(new Date(value)) : value;
    return [
      {
        id: key,
        label: `${name}: ${shown}`,
        ...(shown.length > 24 ? { displayLabel: `${name}: ${shown.slice(0, 24)}…` } : {}),
        onRemove: () => {
          const next = { ...filters };
          delete next[key];
          onApply(next);
        },
      },
    ];
  });
  const count = number(chips.length);
  const invalid = authorizationAuditFilterKeys.filter(
    (key) => trimmed[key] && trimmed[key] !== parsed[key]
  );

  return (
    <ListFilterPanel
      activeCount={chips.length}
      countLabel={count}
      labels={{
        filters: copy('label'),
        clear: copy('clearAll'),
        activeCount: copy('activeCount').replace('{count}', count),
        selected: copy('selected'),
        remove: copy('remove'),
      }}
      chips={chips}
      onClear={() => onApply({})}
      drawer={{
        dir: locale === 'fa' ? 'rtl' : 'ltr',
        onOpen: () => setDraft(filters),
        onApply: () => onApply(parsed),
        labels: {
          apply: copy('apply'),
          cancel: copy('cancel'),
          close: copy('close'),
          description: copy('description'),
        },
      }}
    >
      <Suspense fallback={<LoadingStatus>{word('filter.loading')}</LoadingStatus>}>
        <AuditFilterFields
          draft={draft}
          invalid={invalid}
          onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
        />
      </Suspense>
    </ListFilterPanel>
  );
}

export default function AdminAuthorizationAudit(props: AuditProps) {
  const locale = useLocale();
  const account = useAccountUser();
  const revision = useProfileContextRevision();
  const allowed = useNavigation()?.paths.includes('/admin/authorization-audit');
  if (!account || !allowed) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold">{t('admin.audit.authorization.title', locale)}</h1>
        <Alert variant="destructive">{t('admin.audit.authorization.denied', locale)}</Alert>
      </div>
    );
  }
  return (
    <AuditPage key={JSON.stringify([account, revision, props.eventId, props.filters])} {...props} />
  );
}

function field(entry: ConfigAuditEntry, name: string) {
  const value = entry.changes.find((change) => change.field === name)?.current;
  return value?.recorded && typeof value.value === 'string' ? value.value : null;
}

function AuditPage({ filters, eventId, onApply }: AuditProps) {
  const { format, notice } = useAccountTime();
  const locale = useLocale();
  const word = (key: string) => t(`admin.audit.authorization.${key}`, locale);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const clear = useCallback(() => setCursors([]), []);
  const scope = useCatalogueScope(clear);
  const criteria = new URLSearchParams({ scope: 'authorization' });
  if (eventId) criteria.set('eventId', eventId);
  else {
    for (const [key, value] of Object.entries(filters)) if (value) criteria.set(key, value);
    if (cursor) criteria.set('cursor', cursor);
  }
  const validate = useCallback(
    (value: unknown): value is ConfigAuditPage =>
      isConfigAuditPage(value) &&
      value.scope === 'authorization' &&
      (!eventId ||
        (value.items.length <= 1 &&
          value.nextCursor === null &&
          value.items.every((entry) => entry.id === eventId))),
    [eventId]
  );
  const read = useCatalogueResource(scope, `/api/admin/config/audit?${criteria}`, validate);
  const items = read.data?.items ?? [];
  const entry = eventId ? items[0] : null;
  const next = read.data?.nextCursor;
  const repeated = !!next && cursors.includes(next);
  const denied = scope.denied;
  const stateLabel = denied ? 'denied' : 'error';
  const retry = () => {
    if (denied) scope.recover();
    else read.retry();
  };
  return (
    <section dir={locale === 'fa' ? 'rtl' : 'ltr'} className="mx-auto min-w-0 max-w-6xl space-y-5">
      {eventId && (
        <Link
          to="/admin/authorization-audit"
          search={filters}
          className="text-sm text-primary underline underline-offset-4"
        >
          {word('title')}
        </Link>
      )}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold">{word(eventId ? 'record' : 'title')}</h1>
          {!eventId && <p className="text-sm text-muted-foreground">{word('description')}</p>}
        </div>
        {!denied && !read.error && (
          <ListRefreshButton label={word('refresh')} refreshing={read.loading} onClick={retry} />
        )}
      </header>
      {!eventId && !denied && onApply && <AuditFilters filters={filters} onApply={onApply} />}
      {notice}
      {read.loading &&
        (eventId ? (
          <RecordDetailSkeleton label={word('loading')} />
        ) : (
          <RecordListSkeleton label={word('loading')} view="card" headings={[]} />
        ))}
      {(read.error || denied || repeated) && (
        <Alert variant="destructive" className="space-y-2">
          <p>{word(stateLabel)}</p>
          <Button variant="outline" onClick={retry}>
            {word('retry')}
          </Button>
        </Alert>
      )}
      {!read.loading && !read.error && !denied && items.length === 0 && (
        <p className="rounded-lg border bg-card p-4">{word(eventId ? 'unavailable' : 'empty')}</p>
      )}
      {!eventId && items.length > 0 && (
        <ol className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <div className="min-w-0 space-y-1">
                <Link
                  to="/admin/authorization-audit/$eventId"
                  params={{ eventId: item.id }}
                  search={filters}
                  className="font-medium text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
                >
                  <bdi>{field(item, 'action') ?? word('record')}</bdi>
                </Link>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {field(item, 'resource') ?? '—'}
                </p>
              </div>
              <div className="min-w-0 space-y-1 text-sm">
                <Badge variant="destructive">{word('deniedBadge')}</Badge>
                <p className="[overflow-wrap:anywhere]">
                  <bdi>{field(item, 'reason') ?? '—'}</bdi>
                </p>
              </div>
              <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
                <time dateTime={item.createdAt}>{format(item.createdAt)}</time>
                <p className="[overflow-wrap:anywhere]">
                  <bdi>{item.actorId ?? word('unknownActor')}</bdi>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {entry && (
        <article className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">
                <bdi>{field(entry, 'action') ?? word('record')}</bdi>
              </h2>
              <p className="mt-1 text-sm wrap-anywhere text-muted-foreground">
                <bdi>{field(entry, 'resource') ?? '—'}</bdi>
              </p>
            </div>
            <Badge variant="destructive">{word('deniedBadge')}</Badge>
          </div>
          <dl className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{word('occurred')}</dt>
              <dd>
                <time dateTime={entry.createdAt}>{format(entry.createdAt)}</time>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('filter.actor')}</dt>
              <dd className="[overflow-wrap:anywhere]">
                {entry.actorId && authorizationAuditSearch({ actor: entry.actorId }).actor ? (
                  <Link
                    to="/admin/authorization-audit"
                    search={{ actor: entry.actorId }}
                    className="text-primary underline"
                  >
                    <bdi>{entry.actorId}</bdi>
                  </Link>
                ) : (
                  <bdi>{entry.actorId ?? word('unknownActor')}</bdi>
                )}
              </dd>
            </div>
            {(['reason', 'correlationId'] as const).map((key) => (
              <div key={key}>
                <dt className="text-muted-foreground">{word(`field.${key}`)}</dt>
                <dd className="[overflow-wrap:anywhere]">
                  <bdi>{field(entry, key) ?? '—'}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </article>
      )}
      {!eventId && !denied && (
        <ListPage.Pagination
          kind="cursor"
          loading={read.loading}
          label={word('pagination')}
          hasMore={!!next && !repeated && !read.error}
          nextLabel={word('older')}
          onNext={() => {
            if (next) setCursors((previous) => [...previous, next]);
          }}
          previous={{
            enabled: !!cursor && !read.error,
            label: word('newer'),
            onClick: () => setCursors((previous) => previous.slice(0, -1)),
          }}
        />
      )}
    </section>
  );
}
