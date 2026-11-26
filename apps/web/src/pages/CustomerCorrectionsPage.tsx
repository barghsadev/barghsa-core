import { useEffect, useId, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, MailX, RefreshCw } from 'lucide-react';
import { Alert, Button, Label, LoadingStatus, Textarea, buttonVariants } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
import { tWorkspace as t, type Locale } from '@barghsa/i18n/workspace-admin';
import CustomerCorrectionsPanel from '../components/CustomerCorrectionsPanel.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  customerCorrectionsApi,
  customerCorrectionsRoute,
  isCustomerCorrection,
  readCustomerCorrectionAccess,
  sameCorrection,
  type CustomerCorrection,
  type CustomerCorrectionSearch,
} from '../lib/customer-corrections.js';
import { readWithDeadline } from '../lib/server-query-client.js';

type CapturedOutcome = { row: CustomerCorrection; note: string };
type ReadResult =
  | { kind: 'ready'; row: CustomerCorrection; canRetry: boolean }
  | { kind: 'denied' }
  | { kind: 'missing' };

export default function CustomerCorrectionsPage({
  correctionId,
  editing,
  search,
  onSearchChange,
}: {
  correctionId?: string;
  editing: boolean;
  search: CustomerCorrectionSearch;
  onSearchChange: (search: CustomerCorrectionSearch) => void;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const scope = JSON.stringify([actor, revision, correctionId, editing]);
  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-4" data-slot="correction-record">
      <div>
        {correctionId ? (
          <Link
            to={customerCorrectionsRoute}
            params={{ correctionId: undefined, action: undefined }}
            search={search}
            className="touch-action inline-flex min-h-11 items-center gap-2 rounded text-sm text-primary underline-offset-4 hover:underline"
          >
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
            {notificationFormText('correctionsBack', locale)}
          </Link>
        ) : (
          <Link
            to="/admin/failed-notifications"
            className="touch-action inline-flex min-h-11 items-center gap-2 rounded text-sm text-primary underline-offset-4 hover:underline"
          >
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
            {notificationFormText('correctionsNotifications', locale)}
          </Link>
        )}
      </div>
      {correctionId ? (
        <CorrectionRecord
          key={scope}
          correctionId={correctionId}
          editing={editing}
          search={search}
          locale={locale}
        />
      ) : (
        <>
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">
              {t('admin.notifications.corrections.title', locale)}
            </h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t('admin.notifications.corrections.description', locale)}
            </p>
          </header>
          <CustomerCorrectionsPanel
            key={JSON.stringify([scope, search.completed, search.offset])}
            locale={locale}
            search={search}
            onSearchChange={onSearchChange}
          />
        </>
      )}
    </div>
  );
}

function CorrectionRecord({
  correctionId,
  editing,
  search,
  locale,
}: {
  correctionId: string;
  editing: boolean;
  search: CustomerCorrectionSearch;
  locale: Locale;
}) {
  const label = (key: string) => t(`admin.notifications.corrections.${key}`, locale);
  const time = useAccountTime(locale);
  const fieldId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const firstFocus = useRef(true);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [note, setNote] = useState('');
  const [review, setReview] = useState<(CapturedOutcome & { action: TeamAction }) | null>(null);
  const [held, setHeld] = useState<(CapturedOutcome & { checked: boolean }) | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPhase('loading');
    void readWithDeadline(controller.signal, async (signal): Promise<ReadResult> => {
      const access = await readCustomerCorrectionAccess(signal);
      if (!access.canView) return { kind: 'denied' };
      const response = await fetch(`${customerCorrectionsApi}/${correctionId}`, { signal });
      if (response.status === 401 || response.status === 403) return { kind: 'denied' };
      if (response.status === 404) return { kind: 'missing' };
      const row: unknown = await response.json();
      if (!response.ok || !isCustomerCorrection(row) || row.id !== correctionId)
        throw new Error('Invalid correction record');
      return { kind: 'ready', row, canRetry: access.canRetry };
    }).then(
      (next) => {
        if (controller.signal.aborted) return;
        setResult(next);
        setPhase('ready');
        if (next.kind !== 'ready' || !next.canRetry) {
          setNote('');
          setHeld(null);
          setSaved(false);
        } else {
          setHeld((current) =>
            current ? { ...current, checked: sameCorrection(current.row, next.row) } : null
          );
        }
      },
      () => {
        if (!controller.signal.aborted) setPhase('error');
      }
    );
    return () => controller.abort();
  }, [correctionId, revision]);

  const row = result?.kind === 'ready' ? result.row : null;
  const canRetry = result?.kind === 'ready' && result.canRetry;
  const showEditor = editing && row !== null && !row.resolvedAt && canRetry;
  const confirmed = saved || (held?.checked && row?.resolvedAt && row.resolutionNote === held.note);
  const canReview = phase === 'ready' && showEditor && (!held || held.checked) && !review;
  useEffect(() => {
    if (firstFocus.current && phase === 'ready') {
      firstFocus.current = false;
      (showEditor ? noteInput.current : heading.current)?.focus();
    }
  }, [phase, showEditor]);
  function refresh() {
    setPhase('loading');
    setHeld((current) => (current ? { ...current, checked: false } : null));
    setRevision((value) => value + 1);
  }
  const recovering = Boolean(held && !confirmed && row && !row.resolvedAt);
  const refreshControl = (
    <Button
      ref={refreshButton}
      variant={recovering ? 'outline' : 'ghost'}
      size={recovering ? 'sm' : 'icon'}
      className="shrink-0"
      aria-label={label('refresh')}
      title={label('refresh')}
      disabled={phase === 'loading' || review !== null}
      onClick={refresh}
    >
      <RefreshCw aria-hidden="true" />
      {recovering && label('refresh')}
    </Button>
  );

  return (
    <section className="min-w-0 space-y-4" aria-label={label('title')}>
      <RecordCommandGuard blocked={() => review !== null} />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 ref={heading} tabIndex={-1} className="min-w-0 text-2xl font-semibold">
          {editing && !row?.resolvedAt
            ? label('resolve')
            : notificationFormText('correctionDetails', locale)}
        </h1>
        {refreshControl}
      </header>
      {phase === 'loading' && <LoadingStatus>{label('loading')}</LoadingStatus>}
      {phase === 'error' && <Alert variant="destructive">{label('error')}</Alert>}
      {phase === 'ready' && result?.kind === 'missing' && (
        <Alert variant="destructive">{notificationFormText('correctionMissing', locale)}</Alert>
      )}
      {phase === 'ready' && (result?.kind === 'denied' || (editing && row && !canRetry)) && (
        <Alert variant="destructive">{label('denied')}</Alert>
      )}
      <CommandFeedback message={confirmed ? label('saved') : null} />
      {recovering && <Alert variant="destructive">{confirmationText('unconfirmed', locale)}</Alert>}
      {row && (
        <div className={recordEditorSurface}>
          <div className="space-y-3 px-4 py-4 sm:px-6">
            <dl className="grid gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:gap-5">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {notificationFormText('correctionAddress', locale)}
                </dt>
                <dd className="wrap-anywhere text-sm font-semibold">
                  <bdi dir="ltr">{row.address}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {notificationFormText('correctionReported', locale)}
                </dt>
                <dd className="text-sm">
                  <time dateTime={row.createdAt}>{time.format(row.createdAt)}</time>
                </dd>
              </div>
            </dl>
            {showEditor && (
              <p className="flex items-start gap-2 rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                <MailX className="size-4 shrink-0" aria-hidden="true" />
                {notificationFormText('correctionSuppressed', locale)}
              </p>
            )}
            {time.notice}
          </div>
          {row.resolvedAt ? (
            <div className="space-y-2 border-t px-4 py-4 sm:px-6">
              <h2 className="text-sm font-semibold">{label('note')}</h2>
              <p className="whitespace-pre-wrap wrap-anywhere text-sm">{row.resolutionNote}</p>
              <p className="text-xs text-muted-foreground">
                {notificationFormText('correctionResolved', locale)}{' '}
                <time dateTime={row.resolvedAt}>{time.format(row.resolvedAt)}</time>
              </p>
            </div>
          ) : showEditor ? (
            <form
              aria-label={label('resolve')}
              className="border-t"
              onSubmit={(event) => {
                event.preventDefault();
                const outcome = note.trim();
                if (!canReview || !outcome) return;
                setNote(outcome);
                setReview({
                  row,
                  note: outcome,
                  action: {
                    title: label('resolve'),
                    description: `${row.address}. ${label('confirm')}`,
                    path: `${customerCorrectionsApi}/${row.id}/resolve`,
                    method: 'POST',
                    body: { note: outcome },
                    responseDeadline: true,
                    successStatus: 200,
                    conflictMessage: notificationFormText('correctionConflict', locale),
                    forbiddenMessage: label('denied'),
                  },
                });
              }}
            >
              <div className={`${recordEditorField} px-4 py-4 sm:px-6`}>
                <Label htmlFor={fieldId} className="text-sm font-semibold">
                  {label('note')}
                </Label>
                <p id={`${fieldId}-help`} className="pb-1 text-xs text-muted-foreground">
                  {notificationFormText('correctionNotePrompt', locale)}
                </p>
                <Textarea
                  id={fieldId}
                  ref={noteInput}
                  rows={2}
                  required
                  aria-required="true"
                  aria-describedby={`${fieldId}-help`}
                  autoComplete="off"
                  dir="auto"
                  maxLength={2000}
                  value={note}
                  readOnly={Boolean(held) || phase !== 'ready'}
                  disabled={review !== null}
                  className="min-h-16"
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <RecordEditorActions
                secondary={
                  <Link
                    to={customerCorrectionsRoute}
                    params={{ correctionId, action: undefined }}
                    search={search}
                    className={buttonVariants({ variant: 'ghost' })}
                  >
                    {confirmationText('cancel', locale)}
                  </Link>
                }
              >
                <Button ref={submitButton} type="submit" disabled={!canReview || !note.trim()}>
                  {notificationFormText('correctionReview', locale)}
                </Button>
              </RecordEditorActions>
            </form>
          ) : canRetry && phase === 'ready' ? (
            <RecordEditorActions>
              <Link
                to={customerCorrectionsRoute}
                params={{ correctionId, action: 'resolve' }}
                search={search}
                className={buttonVariants()}
              >
                {label('resolve')}
              </Link>
            </RecordEditorActions>
          ) : null}
        </div>
      )}
      {review && (
        <TeamActionDialog
          action={review.action}
          summary={
            <div className="space-y-1 rounded-lg border bg-muted/25 p-3 text-sm">
              <p className="font-medium">{label('note')}</p>
              <p className="whitespace-pre-wrap wrap-anywhere">{review.note}</p>
            </div>
          }
          finalFocus={() =>
            submitButton.current?.disabled === false ? submitButton.current : refreshButton.current
          }
          onClose={() => setReview(null)}
          onDenied={() => {
            setReview(null);
            setResult(null);
            setNote('');
            setHeld(null);
            setSaved(false);
            refresh();
          }}
          onUnconfirmed={() => {
            setHeld({ row: review.row, note: review.note, checked: false });
            setReview(null);
          }}
          onSuccess={async (response) => {
            if (
              !isCustomerCorrection(response) ||
              !sameCorrection(response, review.row) ||
              !response.resolvedAt ||
              response.resolutionNote !== review.note
            )
              throw new Error('Invalid completion response');
            setResult({ kind: 'ready', row: response, canRetry: true });
            setReview(null);
            setHeld(null);
            setNote('');
            setSaved(true);
          }}
        />
      )}
    </section>
  );
}
