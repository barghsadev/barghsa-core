import { readWithDeadline } from '../lib/server-query-client.js';
import { CommandFeedback } from './CommandFeedback.js';
import { useEffect, useId, useRef, useState } from 'react';
import { LoadingStatus, Button } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { tWorkspace as t, type Locale } from '@barghsa/i18n/workspace-admin';
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

function sameCorrection(first: Correction, second: Correction) {
  return (
    first.id === second.id &&
    first.profileId === second.profileId &&
    first.address === second.address &&
    first.createdAt === second.createdAt
  );
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
  const refreshButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const [rows, setRows] = useState<Correction[]>([]),
    [completed, setCompleted] = useState(false),
    [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0),
    [more, setMore] = useState(false);
  const [access, setAccess] = useState<{ canView: boolean; canRetry: boolean } | null>(null);
  const [draft, setDraft] = useState<{
    row: Correction;
    note: string;
    recovery?: 'refresh' | 'review';
  } | null>(null);
  const [notice, setNotice] = useState(false);
  const [action, setAction] = useState<(TeamAction & { row: Correction; note: string }) | null>(
    null
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setRows([]);
    setAccess(null);
    setMore(false);
    void (async () => {
      try {
        await readWithDeadline(controller.signal, async (signal) => {
          const response = await fetch('/api/admin/failed-notifications/access', {
            signal,
          });
          if (response.status === 401 || response.status === 403) {
            signal.throwIfAborted();
            setAccess({ canView: false, canRetry: false });
            setDraft(null);
            return;
          }
          const permission = await response.json();
          if (
            !response.ok ||
            typeof permission?.canView !== 'boolean' ||
            typeof permission?.canRetry !== 'boolean'
          )
            throw new Error('Invalid access');
          signal.throwIfAborted();
          setAccess(permission);
          if (!permission.canView || !permission.canRetry) setDraft(null);
          if (!permission.canView) return;
          const list = await fetch(
            `/api/admin/notifications/customer-corrections?completed=${completed}&offset=${offset}`,
            { signal }
          );
          if (list.status === 401 || list.status === 403) {
            signal.throwIfAborted();
            setAccess({ canView: false, canRetry: false });
            setDraft(null);
            return;
          }
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
          signal.throwIfAborted();
          const page = result.slice(0, 25);
          setRows(page);
          setMore(result.length > 25);
          if (!completed && permission.canRetry)
            setDraft((current) =>
              current?.recovery === 'refresh' &&
              page.some((row) => sameCorrection(row, current.row))
                ? { ...current, recovery: 'review' }
                : current
            );
        });
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [completed, offset, revision]);
  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  const canEdit =
    draft !== null &&
    access?.canView &&
    access.canRetry &&
    !completed &&
    !loading &&
    !error &&
    draft.recovery !== 'refresh' &&
    rows.some((row) => sameCorrection(row, draft.row));
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
              setLoading(true);
              if (!draft?.recovery) setDraft(null);
              setCompleted(event.target.checked);
              setOffset(0);
              setNotice(false);
            }}
          />
          {label('completed')}
        </label>
        <Button
          ref={refreshButton}
          variant="outline"
          disabled={loading || Boolean(action)}
          onClick={refresh}
        >
          {label('refresh')}
        </Button>
      </div>
      <CommandFeedback message={notice ? label('saved') : null} />
      {draft?.recovery && access?.canView && access.canRetry && (
        <p role="alert">{confirmationText('unconfirmed', locale)}</p>
      )}
      {loading ? (
        <LoadingStatus>{label('loading')}</LoadingStatus>
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
                    disabled={Boolean(action || draft?.recovery)}
                    onClick={() => {
                      setDraft({ row, note: '' });
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
            onClick={() => {
              setLoading(true);
              if (!draft?.recovery) setDraft(null);
              setOffset((value) => Math.max(0, value - 25));
            }}
          >
            {label('previous')}
          </Button>
          <Button
            variant="outline"
            disabled={!more || Boolean(action)}
            onClick={() => {
              setLoading(true);
              if (!draft?.recovery) setDraft(null);
              setOffset((value) => value + 25);
            }}
          >
            {label('next')}
          </Button>
        </div>
      )}
      {draft && access?.canView && access.canRetry && !loading && !error && (
        <form
          className="space-y-2 rounded border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canEdit || !draft.note.trim() || action) return;
            const text = draft.note.trim();
            setAction({
              row: draft.row,
              note: text,
              title: label('resolve'),
              description: `${draft.row.address}. ${label('confirm')}`,
              path: `/api/admin/notifications/customer-corrections/${draft.row.id}/resolve`,
              method: 'POST',
              body: { note: text },
              responseDeadline: true,
              successStatus: 200,
              conflictMessage: label('conflict'),
              forbiddenMessage: label('denied'),
            });
          }}
        >
          <p dir="ltr" className="break-all">
            {draft.row.address}
          </p>
          <label htmlFor={noteId}>{label('note')}</label>
          <textarea
            id={noteId}
            className="block min-h-24 w-full rounded border bg-transparent p-2"
            required
            aria-required="true"
            maxLength={2000}
            value={draft.note}
            disabled={Boolean(action)}
            readOnly={!canEdit || Boolean(draft.recovery)}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
          <div className="flex gap-3">
            <Button
              ref={saveButton}
              type="submit"
              disabled={!canEdit || !draft.note.trim() || Boolean(action)}
            >
              {label('save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(action)}
              onClick={() => setDraft(null)}
            >
              {label('cancel')}
            </Button>
          </div>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          finalFocus={() =>
            saveButton.current?.disabled === false ? saveButton.current : refreshButton.current
          }
          onClose={() => setAction(null)}
          onDenied={() => {
            setDraft(null);
            setAction(null);
            refresh();
          }}
          onUnconfirmed={() => {
            setDraft({ row: action.row, note: action.note, recovery: 'refresh' });
            setAction(null);
          }}
          onSuccess={async (result) => {
            if (
              !isCorrection(result) ||
              !sameCorrection(result, action.row) ||
              !result.resolvedAt ||
              result.resolutionNote !== action.note
            )
              throw new Error('Invalid completion response');
            setAction(null);
            setDraft(null);
            setNotice(true);
            refresh();
          }}
        />
      )}
    </section>
  );
}
