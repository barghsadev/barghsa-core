import { useEffect, useId, useState } from 'react';
import { Button } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

interface Correction {
  id: string;
  address: string;
  profileId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export function CustomerCorrectionsSection({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        {t('admin.notifications.corrections.title', locale)}
      </summary>
      {open && <CustomerCorrectionsPanel locale={locale} />}
    </details>
  );
}
function isCorrection(value: unknown): value is Correction {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const uuid = (item: unknown) =>
    typeof item === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item);
  const date = (item: unknown) => typeof item === 'string' && Number.isFinite(Date.parse(item));
  return (
    uuid(row.id) &&
    typeof row.address === 'string' &&
    row.address.length > 0 &&
    (row.profileId === null || uuid(row.profileId)) &&
    date(row.createdAt) &&
    (row.resolvedAt === null
      ? row.resolutionNote === null
      : date(row.resolvedAt) && typeof row.resolutionNote === 'string')
  );
}

export default function CustomerCorrectionsPanel({ locale }: { locale: Locale }) {
  const label = (key: string) => t(`admin.notifications.corrections.${key}`, locale);
  const time = useAccountTime(locale),
    noteId = useId();
  const [rows, setRows] = useState<Correction[]>([]),
    [completed, setCompleted] = useState(false),
    [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0),
    [more, setMore] = useState(false);
  const [access, setAccess] = useState<{ canView: boolean; canRetry: boolean } | null>(null);
  const [editing, setEditing] = useState<Correction | null>(null),
    [note, setNote] = useState(''),
    [notice, setNotice] = useState(false);
  const [action, setAction] = useState<(TeamAction & { id: string; note: string }) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setRows([]);
    setAccess(null);
    setEditing(null);
    setNote('');
    setMore(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/failed-notifications/access', {
          signal: controller.signal,
        });
        const permission = await response.json();
        if (
          !response.ok ||
          typeof permission?.canView !== 'boolean' ||
          typeof permission?.canRetry !== 'boolean'
        )
          throw new Error('Invalid access');
        if (controller.signal.aborted) return;
        setAccess(permission);
        if (!permission.canView) return;
        const list = await fetch(
          `/api/admin/notifications/customer-corrections?completed=${completed}&offset=${offset}`,
          { signal: controller.signal }
        );
        const result: unknown = await list.json();
        if (
          !list.ok ||
          !Array.isArray(result) ||
          result.length > 26 ||
          !result.every(isCorrection) ||
          new Set(result.map((row) => row.id)).size !== result.length ||
          result.some((row) => Boolean(row.resolvedAt) !== completed)
        )
          throw new Error('Invalid correction list');
        if (!controller.signal.aborted) {
          setRows(result.slice(0, 25));
          setMore(result.length > 25);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [completed, offset, revision]);
  return (
    <section
      className="space-y-3 pt-4"
      aria-label={label('title')}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <p>{label('description')}</p>
      {time.notice}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={completed}
            disabled={Boolean(action)}
            onChange={(event) => {
              setCompleted(event.target.checked);
              setOffset(0);
              setNotice(false);
            }}
          />
          {label('completed')}
        </label>
        <Button
          variant="outline"
          disabled={loading || Boolean(action)}
          onClick={() => setRevision((value) => value + 1)}
        >
          {label('refresh')}
        </Button>
      </div>
      {notice && <p role="status">{label('saved')}</p>}
      {loading ? (
        <p role="status">{label('loading')}</p>
      ) : error ? (
        <p role="alert">{label('error')}</p>
      ) : access?.canView === false ? (
        <p role="alert">{label('denied')}</p>
      ) : rows.length === 0 ? (
        <p>{label('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="space-y-2 rounded border p-3">
              <p className="break-all font-medium" dir="ltr">
                {row.address}
              </p>
              <p className="text-sm">
                <time dateTime={row.createdAt}>{time.format(row.createdAt)}</time>
              </p>
              {row.resolvedAt ? (
                <>
                  <p className="whitespace-pre-wrap break-words">{row.resolutionNote}</p>
                  <time dateTime={row.resolvedAt}>{time.format(row.resolvedAt)}</time>
                </>
              ) : (
                access?.canRetry && (
                  <Button
                    variant="outline"
                    disabled={Boolean(action)}
                    onClick={() => {
                      setEditing(row);
                      setNote('');
                      setNotice(false);
                    }}
                  >
                    {label('resolve')}
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && access?.canView && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            disabled={offset === 0 || Boolean(action)}
            onClick={() => setOffset((value) => Math.max(0, value - 25))}
          >
            {label('previous')}
          </Button>
          <Button
            variant="outline"
            disabled={!more || Boolean(action)}
            onClick={() => setOffset((value) => value + 25)}
          >
            {label('next')}
          </Button>
        </div>
      )}
      {editing && access?.canRetry && (
        <form
          className="space-y-2 rounded border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!note.trim() || action) return;
            const text = note.trim();
            setAction({
              id: editing.id,
              note: text,
              title: label('resolve'),
              description: `${editing.address}. ${label('confirm')}`,
              path: `/api/admin/notifications/customer-corrections/${editing.id}/resolve`,
              method: 'POST',
              body: { note: text },
              conflictMessage: label('conflict'),
              forbiddenMessage: label('denied'),
            });
          }}
        >
          <p dir="ltr" className="break-all">
            {editing.address}
          </p>
          <label htmlFor={noteId}>{label('note')}</label>
          <textarea
            id={noteId}
            className="block min-h-24 w-full rounded border bg-transparent p-2"
            required
            maxLength={2000}
            value={note}
            disabled={Boolean(action)}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex gap-3">
            <Button type="submit" disabled={!note.trim() || Boolean(action)}>
              {label('save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(action)}
              onClick={() => setEditing(null)}
            >
              {label('cancel')}
            </Button>
          </div>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            if (
              !isCorrection(result) ||
              result.id !== action.id ||
              !result.resolvedAt ||
              result.resolutionNote !== action.note
            )
              throw new Error('Invalid completion response');
            setAction(null);
            setEditing(null);
            setNotice(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}
