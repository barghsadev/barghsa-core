import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n';
import {
  Button,
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
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setItems([]);
    setSelected(null);
    setCanResolve(false);
    setCanView(false);
    void (async () => {
      try {
        const access = await fetch('/api/admin/reconciliation/items/access', {
          signal: controller.signal,
        });
        if (!access.ok) throw new Error('Access unavailable');
        const permission = (await access.json()) as { canView: boolean; canResolve: boolean };
        if (controller.signal.aborted) return;
        setCanView(permission.canView);
        setCanResolve(permission.canResolve);
        if (!permission.canView) return;
        const response = await fetch(
          `/api/admin/reconciliation/items?${query}&limit=${pageSize}&offset=${offset}`,
          { signal: controller.signal }
        );
        if (response.status === 403) {
          setCanView(false);
          return;
        }
        if (!response.ok) throw new Error('List unavailable');
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid list');
        if (!controller.signal.aborted) setItems(rows);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, offset, revision]);
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
    setQuery(params.toString());
    setRevision((v) => v + 1);
  }
  function prepare(verb: string) {
    if (!selected || (verb !== 'investigate' && !note.trim())) return;
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
  const date = (value: string) => time.format(value);
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header>
        <h1 className="text-2xl font-semibold">{label('title')}</h1>
        <p className="text-muted-foreground">{label('description')}</p>
      </header>
      <form
        onSubmit={filter}
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"
      >
        {[
          ['status', status, setStatus, statuses],
          ['severity', severity, setSeverity, severities],
        ].map(([key, value, setter, values]) => (
          <div className="space-y-1" key={String(key)}>
            <Label htmlFor={`rex-${key}`}>{label(String(key))}</Label>
            <select
              id={`rex-${key}`}
              className="block rounded border p-2"
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
        <div>
          <Label htmlFor="rex-from">{label('from')}</Label>
          <Input
            id="rex-from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rex-before">{label('before')}</Label>
          <Input
            id="rex-before"
            type="datetime-local"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
          />
        </div>
        <Button type="submit">{label('apply')}</Button>
        <p className="w-full text-sm text-muted-foreground">
          {time.status === 'ready' && label('timeHint').replace('{zone}', time.timezone)}
        </p>
        {invalid && <p role="alert">{label('invalidDates')}</p>}
      </form>
      {saved && <p role="status">{label('saved')}</p>}
      {loading ? (
        <p role="status">{label('loading')}</p>
      ) : error ? (
        <div role="alert">
          {label('error')}{' '}
          <Button onClick={() => setRevision((v) => v + 1)}>{label('retry')}</Button>
        </div>
      ) : !canView ? (
        <p role="alert">{label('forbidden')}</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p>{label('empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full text-start">
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
                  {items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-3">
                        <Button
                          variant="link"
                          onClick={() => {
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
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset((v) => Math.max(0, v - pageSize))}
            >
              {label('previous')}
            </Button>
            <Button
              variant="outline"
              disabled={items.length < pageSize}
              onClick={() => setOffset((v) => v + pageSize)}
            >
              {label('next')}
            </Button>
          </div>
        </>
      )}
      {selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
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
            {canResolve && selected.status !== 'closed' && (
              <div className="space-y-3">
                {selected.status === 'open' && (
                  <Button onClick={() => prepare('investigate')}>{label('investigate')}</Button>
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
                    <Button disabled={!note.trim()} onClick={() => prepare('resolve')}>
                      {label('resolve')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={!note.trim()}
                    onClick={() => prepare('close')}
                  >
                    {label('close')}
                  </Button>
                </div>
              </div>
            )}
            <Button variant="outline" onClick={() => setSelected(null)}>
              {label('dismiss')}
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSaved(true);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
