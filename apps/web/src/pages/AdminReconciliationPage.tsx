import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Button,
  ListPage,
  ScrollArea,
  datePickerAtTime,
  datePickerCalendarDate,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
interface Item {
  id: string;
  exceptionType: string;
  severity: string;
  status: string;
  description: string;
  details: Record<string, unknown> | null;
  assignedToUsername: string | null;
  resolvedByUsername: string | null;
  resolutionNote: string | null;
  createdAt: string;
}
const statuses = ['open', 'investigating', 'resolved', 'closed'];
const severities = ['low', 'medium', 'high', 'critical'];
const pageSize = 25;
export default function AdminReconciliationPage() {
  const time = useAccountTime();
  const locale = useLocale(),
    label = (key: string) => t(`admin.reconciliation.${key}`, locale);
  const [status, setStatus] = useState('open'),
    [severity, setSeverity] = useState('');
  const [from, setFrom] = useState(''),
    [before, setBefore] = useState(''),
    [invalid, setInvalid] = useState(false);
  const [query, setQuery] = useState('status=open'),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [canView, setCanView] = useState(false),
    [canResolve, setCanResolve] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null),
    [note, setNote] = useState(''),
    [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const [accessLoading, setAccessLoading] = useState(true),
    [accessError, setAccessError] = useState(false),
    [accessRevision, setAccessRevision] = useState(0),
    [accessVersion, setAccessVersion] = useState(0),
    [acceptedScope, setAcceptedScope] = useState('');
  const accessValid = useRef(false);
  const resolveAllowed = useRef(false);
  const workGeneration = useRef(0);
  const reviewed = useRef<Item | null>(null);
  const visibleItems = acceptedScope === query ? items : [];
  function clearWork() {
    ++workGeneration.current;
    reviewed.current = null;
    setSelected(null);
    setNote('');
    setAction(null);
  }
  function denyAccess() {
    accessValid.current = false;
    resolveAllowed.current = false;
    setCanView(false);
    setCanResolve(false);
    setItems([]);
    setSaved(false);
    clearWork();
  }
  useEffect(
    () => () => {
      ++workGeneration.current;
    },
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    accessValid.current = false;
    setAccessLoading(true);
    setAccessError(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/reconciliation/items/access', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('Access unavailable');
        const permission = (await response.json()) as { canView: boolean; canResolve: boolean };
        if (controller.signal.aborted) return;
        if (typeof permission.canView !== 'boolean' || typeof permission.canResolve !== 'boolean')
          throw new Error('Invalid access');
        if (!permission.canView) {
          denyAccess();
          return;
        }
        accessValid.current = true;
        resolveAllowed.current = permission.canResolve;
        setCanView(true);
        setCanResolve(permission.canResolve);
        if (!permission.canResolve && reviewed.current) clearWork();
        setAccessVersion((v) => v + 1);
      } catch {
        if (!controller.signal.aborted) setAccessError(true);
      } finally {
        if (!controller.signal.aborted) {
          setAccessLoading(false);
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [accessRevision]);
  useEffect(() => {
    if (!canView || !accessValid.current || accessLoading) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/reconciliation/items?${query}&limit=${pageSize}&offset=${offset}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if ([401, 403].includes(response.status)) {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error('List unavailable');
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid list');
        if (controller.signal.aborted || !accessValid.current) return;
        if (
          reviewed.current &&
          !rows.some((row) => JSON.stringify(row) === JSON.stringify(reviewed.current))
        )
          clearWork();
        setAcceptedScope(query);
        setItems(rows);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, offset, revision, canView, accessVersion, accessLoading]);
  function refreshAccess() {
    accessValid.current = false;
    setAccessLoading(true);
    setAccessError(false);
    setAccessRevision((v) => v + 1);
  }
  function filterInstant(value: string): Date | undefined {
    if (time.status !== 'ready') return undefined;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return undefined;
    const date = datePickerCalendarDate(match[1]!, time.timezone);
    return date && datePickerAtTime(date, Number(match[2]), Number(match[3]), time.timezone);
  }
  function filter(event: FormEvent) {
    event.preventDefault();
    const fromInstant = from ? filterInstant(from) : undefined;
    const beforeInstant = before ? filterInstant(before) : undefined;
    if (
      (from && !fromInstant) ||
      (before && !beforeInstant) ||
      (fromInstant && beforeInstant && fromInstant >= beforeInstant)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSaved(false);
    setOffset(0);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (severity) params.set('severity', severity);
    if (fromInstant) params.set('createdFrom', fromInstant.toISOString());
    if (beforeInstant) params.set('createdBefore', beforeInstant.toISOString());
    const nextQuery = params.toString();
    if (nextQuery !== query) clearWork();
    setQuery(nextQuery);
    setRevision((v) => v + 1);
  }
  function prepare(verb: string) {
    if (
      !selected ||
      loading ||
      error ||
      !accessValid.current ||
      !resolveAllowed.current ||
      !(verb === 'investigate'
        ? selected.status === 'open'
        : verb === 'resolve'
          ? ['open', 'investigating'].includes(selected.status)
          : selected.status !== 'closed') ||
      (verb !== 'investigate' && !note.trim())
    )
      return;
    ++workGeneration.current;
    reviewed.current = selected;
    setAction({
      title: label(verb),
      description: `${selected.description}. ${label('confirm')}${verb === 'investigate' ? '' : ` ${note.trim()}`}`,
      path: `/api/admin/reconciliation/items/${selected.id}/${verb}`,
      method: 'POST',
      body: verb === 'investigate' ? {} : { note: note.trim() },
      conflictMessage: label('changed'),
      forbiddenMessage: label('denied'),
    });
    setSelected(null);
  }
  const recoveryView = (accessError || error) && (
    <div role="alert" className="space-y-2">
      <p>{label(accessError ? 'accessError' : 'error')}</p>
      <Button
        variant="outline"
        onClick={accessError ? refreshAccess : () => setRevision((v) => v + 1)}
      >
        {label(accessError ? 'accessRetry' : 'retry')}
      </Button>
    </div>
  );
  const date = (value: string) => time.format(value);
  const actionGeneration = workGeneration.current;
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header>
        <h1 className="text-2xl font-semibold">{label('title')}</h1>
        <p className="text-muted-foreground">{label('description')}</p>
      </header>
      <ListPage>
        <ListPage.Toolbar>
          <Button
            variant="outline"
            disabled={loading || accessLoading}
            onClick={() => {
              setOffset(0);
              refreshAccess();
            }}
          >
            {label('refresh')}
          </Button>
          <form
            onSubmit={filter}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 rounded-lg border bg-card text-card-foreground p-4"
          >
            {[
              ['status', status, setStatus, statuses],
              ['severity', severity, setSeverity, severities],
            ].map(([key, value, setter, values]) => (
              <div className="min-w-0 space-y-1" key={String(key)}>
                <Label htmlFor={`rex-${key}`}>{label(String(key))}</Label>
                <select
                  id={`rex-${key}`}
                  className="block w-full min-w-0 rounded border bg-card p-2"
                  value={String(value)}
                  onChange={(e) => (setter as typeof setStatus)(e.target.value)}
                >
                  <option value="">{label('all')}</option>
                  {(values as string[]).map((v) => (
                    <option key={v} value={v}>
                      {label(v)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="min-w-0">
              <Label htmlFor="rex-from">{label('from')}</Label>
              <Input
                id="rex-from"
                type="datetime-local"
                className="min-w-0 w-full"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="rex-before">{label('before')}</Label>
              <Input
                id="rex-before"
                type="datetime-local"
                className="min-w-0 w-full"
                value={before}
                onChange={(e) => setBefore(e.target.value)}
              />
            </div>
            <Button type="submit">{label('apply')}</Button>
            <p className="sm:col-span-2 xl:col-span-5 text-sm text-muted-foreground">
              {time.status === 'ready' && label('timeHint').replace('{zone}', time.timezone)}
            </p>
            {invalid && <p role="alert">{label('invalidDates')}</p>}
          </form>
        </ListPage.Toolbar>
        {accessError && (
          <div role="alert" className="space-y-2">
            <p>{label('accessError')}</p>
            <Button variant="outline" onClick={refreshAccess}>
              {label('accessRetry')}
            </Button>
          </div>
        )}
        {saved && <p role="status">{label('saved')}</p>}
        <ListPage.Content
          loading={loading || accessLoading}
          error={error || (!accessLoading && !accessError && !canView)}
          empty={!visibleItems.length}
          retainContent={!!visibleItems.length && canView}
          loadingView={<p role="status">{label('loading')}</p>}
          errorView={
            <div role="alert" className="space-y-2">
              <p>{label(canView ? 'error' : 'forbidden')}</p>
              {canView && (
                <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
                  {label('retry')}
                </Button>
              )}
            </div>
          }
          emptyView={!accessError && <p>{label('empty')}</p>}
        >
          <ScrollArea
            scrollbarOrientation="horizontal"
            className="min-w-0 max-w-full rounded-lg border bg-card text-card-foreground"
            role="region"
            aria-label={label('tableTitle')}
          >
            <table className="w-full min-w-[40rem] text-start">
              <caption className="sr-only">{label('title')}</caption>
              <thead>
                <tr>
                  {['details', 'severity', 'status', 'created', 'assigned'].map((key) => (
                    <th scope="col" key={key} className="p-3 text-start">
                      {label(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-3">
                      <Button
                        variant="link"
                        onClick={() => {
                          ++workGeneration.current;
                          reviewed.current = item;
                          setSelected(item);
                          setNote('');
                          setSaved(false);
                        }}
                      >
                        {item.description}
                      </Button>
                      <p className="text-sm text-muted-foreground">{label(item.exceptionType)}</p>
                    </td>
                    <td className="p-3">{label(item.severity)}</td>
                    <td className="p-3">{label(item.status)}</td>
                    <td className="p-3 whitespace-nowrap">{date(item.createdAt)}</td>
                    <td className="p-3">{item.assignedToUsername ?? label('unassigned')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          label={label('pages')}
          loading={loading || accessLoading}
          hasMore={canView && !error && !accessError && visibleItems.length >= pageSize}
          nextLabel={label('next')}
          onNext={() => setOffset((v) => v + pageSize)}
          previous={{
            enabled: canView && !error && !accessError && offset > 0,
            label: label('previous'),
            onClick: () => setOffset((v) => Math.max(0, v - pageSize)),
          }}
        />
      </ListPage>
      {selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) clearWork();
          }}
        >
          <DialogContent
            className="max-h-[85dvh] overflow-y-auto"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
          >
            <DialogHeader>
              <DialogTitle>{label('details')}</DialogTitle>
              <DialogDescription>{selected.description}</DialogDescription>
            </DialogHeader>
            <p>
              {label(selected.status)} · {label(selected.severity)}
            </p>
            <pre
              dir="ltr"
              className="overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs"
            >
              {JSON.stringify(selected.details ?? {}, null, 2)}
            </pre>
            {selected.resolutionNote && (
              <div>
                <h3 className="font-medium">{label('resolution')}</h3>
                <p className="whitespace-pre-wrap">{selected.resolutionNote}</p>
                <p>{selected.resolvedByUsername}</p>
              </div>
            )}
            {recoveryView}
            {canResolve && selected.status !== 'closed' && (
              <div className="space-y-3">
                {selected.status === 'open' && (
                  <Button
                    disabled={loading || error || accessLoading || accessError}
                    onClick={() => prepare('investigate')}
                  >
                    {label('investigate')}
                  </Button>
                )}
                <Label htmlFor="rex-note">{label('note')}</Label>
                <textarea
                  id="rex-note"
                  className="block min-h-24 w-full rounded border p-2"
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-3">
                  {['open', 'investigating'].includes(selected.status) && (
                    <Button
                      disabled={!note.trim() || loading || error || accessLoading || accessError}
                      onClick={() => prepare('resolve')}
                    >
                      {label('resolve')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={!note.trim() || loading || error || accessLoading || accessError}
                    onClick={() => prepare('close')}
                  >
                    {label('close')}
                  </Button>
                </div>
              </div>
            )}
            <Button variant="outline" onClick={clearWork}>
              {label('dismiss')}
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          summary={recoveryView}
          confirmationDisabled={loading || error || accessLoading || accessError || !canResolve}
          onClose={() => {
            if (actionGeneration === workGeneration.current) clearWork();
          }}
          onSuccess={async () => {
            if (
              actionGeneration !== workGeneration.current ||
              !accessValid.current ||
              !resolveAllowed.current
            )
              return;
            clearWork();
            setSaved(true);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
