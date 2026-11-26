import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { tSolar } from '@barghsa/i18n/solar';
import { contractText } from '@barghsa/i18n/contracts';
import { tSolarStaffRecord } from '@barghsa/i18n/solar-staff-record';
import { RefreshCw } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  ListPage,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import {
  solarMilestonePaths,
  type SolarMilestone,
  type SolarProgress,
} from '../lib/solar-progress.js';
import {
  captureProgress,
  confirmedProgress,
  definitiveProgressRejection,
  parseProgress,
  progressReviewHash,
  type CapturedProgress,
  type ProgressNoteDraft,
} from '../lib/solar-progress-form.js';
import { withCsrf } from '../lib/csrf.js';
import { SolarStageProgress } from '../components/SolarStageProgress.js';
import { SolarStaffRecordHeader } from '../components/SolarStaffRecordHeader.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';

const milestoneExamples = {
  in_progress: 'milestoneExampleWork',
  delivered: 'milestoneExampleDelivery',
  installed: 'milestoneExampleInstallation',
} as const;

interface Row {
  requestId: string;
  contractId: string;
  contractNumber: string;
  submittedAt: string;
  contractState: string;
  stage: string | null;
  revision: number;
}
function validQueueRow(value: unknown): value is Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    !!staffOrderId(row.requestId) &&
    !!staffOrderId(row.contractId) &&
    typeof row.contractNumber === 'string' &&
    typeof row.submittedAt === 'string' &&
    Number.isFinite(Date.parse(row.submittedAt)) &&
    typeof row.contractState === 'string' &&
    (row.stage === null || typeof row.stage === 'string') &&
    typeof row.revision === 'number' &&
    Number.isSafeInteger(row.revision) &&
    row.revision >= 0
  );
}
interface ReviewedProgress {
  captured: CapturedProgress;
  action: TeamAction;
  generation: number;
  attempted: boolean;
  rejected: boolean;
  unconfirmed: boolean;
}
export function AdminSolarConstructionPage(
  props: Parameters<typeof OwnedAdminSolarConstructionPage>[0]
) {
  const profileRevision = useProfileContextRevision();
  const actor = useAccountUser();
  return (
    <OwnedAdminSolarConstructionPage key={JSON.stringify([actor, profileRevision])} {...props} />
  );
}
function OwnedAdminSolarConstructionPage({
  queries,
  selected,
  onSelect,
  queueSearch,
  milestoneEditor,
}: {
  queries?: ListQueryBinding;
  selected: string | null;
  onSelect?: (id: string | null) => void;
  queueSearch?: Record<string, unknown>;
  milestoneEditor?: SolarMilestone;
}) {
  const readActor = useAccountUser();
  const readProfileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(readActor, readProfileRevision);
  const locale = useLocale();
  const time = useAccountTime(locale);
  const actor = useAccountUser();
  const copy = (key: string) => tSolar(key, locale);
  const [queue, setQueue] = useState<{
    items: Row[];
    nextBefore: string | null;
    search: string;
    key: string;
    actor: string | null;
  } | null>(null);
  const [queueState, setQueueState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [queueRevision, setQueueRevision] = useState(0);
  const [progress, setProgress] = useState<SolarProgress | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error' | 'denied'>(
    'loading'
  );
  const [detailRevision, setDetailRevision] = useState(0);
  const [recordedMilestone, setRecordedMilestone] = useState<SolarMilestone | null>(null);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const uncertainRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const generation = useRef(0);
  const previewAbort = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const accessDenied = useRef(false);
  const q = queries?.query.search ?? '',
    before = queries?.query.cursor ?? '';
  const showQueue = !!queries;
  const queueKey = JSON.stringify([q, before]);
  const currentActor = useRef(actor);
  if (currentActor.current !== actor) {
    currentActor.current = actor;
    accessDenied.current = false;
  }
  const scope = JSON.stringify([actor, selected, queueKey]);
  const currentScope = useRef(scope);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    ++generation.current;
  }
  const schemaGeneration = generation.current;
  const form = useZodForm<ProgressNoteDraft>(
    async () => {
      const schemas = await import('../lib/solar-progress-form-schemas.js');
      return schemaGeneration === generation.current
        ? schemas.progressNoteSchema(copy('progressNoteInvalid'))
        : schemas.inactiveProgressNoteSchema;
    },
    {
      defaultValues: { note: '' },
      validationUnavailableMessage: copy('progressValidationUnavailable'),
    }
  );
  const noteFields = useActionFieldErrors(
    form,
    { note: copy('progressNoteInvalid') },
    copy('constructionSaveError')
  );
  const reviewed = useRef<ReviewedProgress | null>(null);
  const detailContext = useRef<{ profileId: string; contractId: string | null } | null>(null);
  const [progressScope, setProgressScope] = useState(scope);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewAbort.current?.abort();
      generation.current += 1;
    };
  }, []);
  function invalidate() {
    generation.current += 1;
    previewAbort.current?.abort();
    setAction(null);
    reviewed.current = null;
    preparingRef.current = false;
    pendingRef.current = false;
    uncertainRef.current = false;
    setPreparing(false);
    setPending(false);
    setUncertain(false);
    setSaveError(false);
    setRecordedMilestone(null);
  }
  function deny() {
    accessDenied.current = true;
    invalidate();
    form.reset({ note: '' });
    setProgress(null);
    setQueue(null);
    setDetailState('denied');
    setQueueState('denied');
  }
  useEffect(() => {
    invalidate();
    detailContext.current = null;
    form.reset({ note: '' });
    setProgress(null);
  }, [scope]);
  function busy() {
    return preparingRef.current || pendingRef.current || form.isSubmissionPending() || !!action;
  }
  function live(command: ReviewedProgress) {
    return (
      mounted.current &&
      !accessDenied.current &&
      reviewed.current === command &&
      command.generation === generation.current &&
      currentScope.current === scope
    );
  }
  function unconfirmed(command: ReviewedProgress) {
    if (!live(command)) return;
    command.unconfirmed = true;
    uncertainRef.current = true;
    setUncertain(true);
    setSaveError(false);
  }
  function closeAction() {
    const command = reviewed.current;
    if (!command || !live(command)) return;
    if (command.unconfirmed || (command.attempted && !command.rejected)) unconfirmed(command);
    else reviewed.current = null;
    pendingRef.current = false;
    setPending(false);
    setAction(null);
  }
  useEffect(() => {
    const abort = new AbortController();
    if (!showQueue || accessDenied.current) return () => abort.abort();
    setQueueState('loading');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (before) params.set('before', before);
    void readStaff('solar', 'list', `/api/admin/solar/construction?${params}`, abort.signal)
      .then(async (response) => {
        if (abort.signal.aborted || accessDenied.current || currentActor.current !== actor) return;
        if (response.status === 401 || response.status === 403) {
          deny();
          return;
        }
        if (!response.ok) throw new Error('queue');
        const result = (await response.json()) as { items?: unknown; nextBefore?: unknown } | null;
        if (
          !Array.isArray(result?.items) ||
          !result.items.every(validQueueRow) ||
          (result.nextBefore !== null && !staffOrderId(result.nextBefore))
        )
          throw new Error('Invalid construction queue');
        if (!abort.signal.aborted && !accessDenied.current && currentActor.current === actor) {
          setQueue({
            items: result.items,
            nextBefore: staffOrderId(result.nextBefore) || null,
            search: q,
            key: queueKey,
            actor,
          });
          setQueueState('ready');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted && !accessDenied.current && currentActor.current === actor)
          setQueueState('error');
      });
    return () => abort.abort();
  }, [showQueue, q, before, queueRevision, actor, readStaff]);
  useEffect(() => {
    const abort = new AbortController();
    if (accessDenied.current) return () => abort.abort();
    const token = generation.current;
    const recoveryAtRead = !pendingRef.current && uncertainRef.current ? reviewed.current : null;
    setProgress(null);
    setDetailState('loading');
    if (!selected) return () => abort.abort();
    void readStaff(
      'solar',
      'detail',
      `/api/admin/solar/construction/${encodeURIComponent(selected)}`,
      abort.signal
    )
      .then(async (response) => {
        if (
          abort.signal.aborted ||
          accessDenied.current ||
          token !== generation.current ||
          currentScope.current !== scope
        )
          return;
        if ([401, 403, 404].includes(response.status)) {
          deny();
          return;
        }
        if (!response.ok) throw new Error('detail');
        const result = parseProgress(await response.json());
        if (!result || result.requestId !== selected) throw new Error('detail');
        if (!abort.signal.aborted && !accessDenied.current && token === generation.current) {
          if (
            detailContext.current &&
            (detailContext.current.profileId !== result.profileId ||
              detailContext.current.contractId !== result.contractId)
          ) {
            invalidate();
            form.reset({ note: '' });
          }
          detailContext.current = { profileId: result.profileId, contractId: result.contractId };
          if (
            recoveryAtRead &&
            reviewed.current === recoveryAtRead &&
            !pendingRef.current &&
            confirmedProgress(result, recoveryAtRead.captured)
          ) {
            reviewed.current = null;
            uncertainRef.current = false;
            setUncertain(false);
            setAction(null);
            form.reset({ note: '' });
            setSaveError(false);
            if (milestoneEditor) setRecordedMilestone(recoveryAtRead.captured.command.stage);
          }
          setProgress(result);
          setProgressScope(scope);
          setDetailState('ready');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted && !accessDenied.current && token === generation.current)
          setDetailState('error');
      });
    return () => abort.abort();
  }, [scope, detailRevision, readStaff, milestoneEditor]);
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !progress?.canRecord ||
      !progress.nextMilestone ||
      (milestoneEditor && progress.nextMilestone !== milestoneEditor) ||
      recordedMilestone ||
      progressScope !== scope ||
      busy() ||
      reviewed.current
    )
      return;
    const token = generation.current;
    const capturedProgress = progress;
    const rawNote = form.getValues('note');
    void form.handleSubmit(async (draft) => {
      if (
        !mounted.current ||
        token !== generation.current ||
        currentScope.current !== scope ||
        form.getValues('note') !== rawNote ||
        draft.note !== rawNote
      )
        return;
      const captured = captureProgress(capturedProgress, draft.note, crypto.randomUUID());
      if (!captured) return;
      preparingRef.current = true;
      setPreparing(true);
      setSaveError(false);
      const previewController = new AbortController();
      previewAbort.current = previewController;
      try {
        const { response, result } = await readWithDeadline(
          previewController.signal,
          async (signal) => {
            const response = await fetch(
              `/api/admin/solar/construction/${encodeURIComponent(captured.requestId)}/review`,
              {
                signal,
                method: 'POST',
                credentials: 'include',
                headers: withCsrf({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(captured.command),
              }
            );
            const result: unknown = [401, 403, 404].includes(response.status)
              ? null
              : await response.json().catch(() => null);
            return { response, result };
          }
        );
        if (
          !mounted.current ||
          generation.current !== token ||
          currentScope.current !== scope ||
          form.getValues('note') !== rawNote
        )
          return;
        if ([401, 403, 404].includes(response.status)) {
          deny();
          return;
        }
        if (response.status === 400 && result && typeof result === 'object') {
          const error = (result as { error?: { code?: string; fields?: unknown[] } }).error;
          if (
            error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(error.fields) &&
            noteFields(error.fields)
          )
            return;
        }
        if (!response.ok) throw new Error('review');
        const hash = progressReviewHash(result, captured);
        if (!hash) throw new Error('review');
        const command: ReviewedProgress = {
          captured,
          generation: token,
          attempted: false,
          rejected: false,
          unconfirmed: false,
          action: {
            title: copy('constructionReviewTitle'),
            description: copy('constructionReviewDescription'),
            path: `/api/admin/solar/construction/${encodeURIComponent(captured.requestId)}`,
            method: 'POST',
            responseDeadline: true,
            successStatus: 200,
            body: { ...captured.command, expectedReviewHash: hash },
            conflictMessage: copy('constructionConflict'),
            errorMessages: Object.fromEntries(
              [
                ErrorCodes.VALIDATION_INPUT_INVALID.code,
                ErrorCodes.CONFLICT_STATE.code,
                ErrorCodes.CONFLICT_VERSION.code,
                ErrorCodes.NOT_FOUND_RESOURCE.code,
              ].map((code) => [
                code,
                (value: unknown) => {
                  if (code === ErrorCodes.NOT_FOUND_RESOURCE.code && live(command)) {
                    deny();
                    return copy('staffQueueForbidden');
                  }
                  if (live(command) && definitiveProgressRejection(value)) command.rejected = true;
                  return code.startsWith('CONFLICT:')
                    ? copy('constructionConflict')
                    : copy('constructionSaveError');
                },
              ])
            ),
          },
        };
        reviewed.current = command;
        setAction(command.action);
      } catch {
        if (mounted.current && generation.current === token) setSaveError(true);
      } finally {
        if (previewAbort.current === previewController) previewAbort.current = null;
        if (mounted.current && generation.current === token) {
          preparingRef.current = false;
          setPreparing(false);
        }
      }
    })(event);
  }
  // Route changes immediately hide old details even before their fetch cleanup runs.
  const visible = progressScope === scope && progress?.requestId === selected ? progress : null;
  const rows =
    queue?.actor === actor && queue.search === q && queueState !== 'denied' ? queue.items : [];
  const fresh = queue?.actor === actor && queue.key === queueKey && queueState === 'ready';
  const command = reviewed.current?.captured.command;
  const nextMilestone = visible?.nextMilestone;
  const canRecord = !!visible?.canRecord && !!nextMilestone;
  const editingStage = uncertain
    ? command?.stage
    : canRecord && (!milestoneEditor || milestoneEditor === nextMilestone)
      ? nextMilestone
      : null;
  const lastMilestone = visible?.events.at(-1);
  const locked = preparing || pending || form.formState.isSubmitting || !!action || uncertain;
  const queueRow =
    'flex w-full min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-start hover:border-primary';
  function constructionQueueLabel(row: Row) {
    return (
      <>
        <span className="flex w-full min-w-0 flex-wrap items-start justify-between gap-2">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm text-muted-foreground">
              {contractText('contractNumber', locale)}
            </span>
            <bdi dir="ltr" className="font-semibold">
              {row.contractNumber}
            </bdi>
          </span>
          <Badge variant="secondary">
            {row.stage ? copy(`construction_${row.stage}`) : copy('constructionNoUpdates')}
          </Badge>
        </span>
        <span className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <span className="wrap-anywhere">
            <bdi dir="ltr">{row.requestId}</bdi>
          </span>
          <time dateTime={row.submittedAt}>
            {time.format(row.submittedAt, { dateStyle: 'medium' })}
          </time>
        </span>
      </>
    );
  }
  const navigationBlocked = () =>
    pendingRef.current ||
    uncertainRef.current ||
    (reviewed.current?.attempted === true && !!action);
  const reloadProgress = (
    <Button
      id="solar-construction-reload"
      variant="ghost"
      size="icon"
      aria-label={copy('constructionReload')}
      title={copy('constructionReload')}
      disabled={busy() || detailState === 'loading'}
      onClick={() => {
        if (!busy()) setDetailRevision((v) => v + 1);
      }}
    >
      <RefreshCw aria-hidden="true" />
    </Button>
  );
  return (
    <div
      data-slot={showQueue ? undefined : 'solar-staff-construction'}
      className={showQueue ? 'space-y-6' : 'mx-auto max-w-3xl space-y-3'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {showQueue ? (
        <header>
          <h1 className="text-3xl font-semibold">{copy('constructionStaffTitle')}</h1>
          <p className="mt-2 text-muted-foreground">{copy('constructionStaffDescription')}</p>
        </header>
      ) : (
        <SolarStaffRecordHeader
          stage="construction"
          search={queueSearch ?? {}}
          reference={selected && <bdi dir="ltr">{selected}</bdi>}
          blocked={navigationBlocked}
          {...(milestoneEditor && { headingText: tSolarStaffRecord('recordMilestone', locale) })}
          action={milestoneEditor && visible && !recordedMilestone ? reloadProgress : undefined}
          backLink={
            milestoneEditor && selected ? (
              <Link
                to="/admin/solar-requests/$requestId/construction/{-$operation}"
                params={{ requestId: selected, operation: undefined }}
                search={queueSearch ?? {}}
                className="touch-action text-sm text-primary underline underline-offset-4"
                aria-disabled={navigationBlocked() || undefined}
                onClick={(event) => {
                  if (navigationBlocked()) event.preventDefault();
                }}
              >
                {tSolarStaffRecord('backToConstructionRecord', locale)}
              </Link>
            ) : undefined
          }
        />
      )}
      {time.notice}
      {queries && (
        <ListPage>
          <ListPage.Toolbar
            search={
              <div className="max-w-md space-y-2">
                <Label htmlFor="solar-construction-search">{copy('constructionSearch')}</Label>
                <Input
                  id="solar-construction-search"
                  value={queries.searchInput}
                  disabled={pending || !!action}
                  onChange={(event) => {
                    if (!pendingRef.current && !action) queries.setSearchInput(event.target.value);
                  }}
                />
              </div>
            }
          />
          <ListPage.Content
            loading={queueState === 'loading'}
            error={queueState === 'error' || queueState === 'denied'}
            empty={!rows.length}
            retainContent={!!rows.length}
            loadingView={<RecordListSkeleton label={copy('loading')} view="card" headings={[]} />}
            errorView={
              <div className="space-y-2">
                <p role="alert">
                  {copy(queueState === 'denied' ? 'staffQueueForbidden' : 'staffQueueLoadError')}
                </p>
                {queueState !== 'denied' && (
                  <Button variant="outline" onClick={() => setQueueRevision((v) => v + 1)}>
                    {copy('retry')}
                  </Button>
                )}
              </div>
            }
            emptyView={<p>{copy('constructionEmpty')}</p>}
          >
            <ul className="grid gap-3">
              {rows.map((row) => (
                <li key={row.requestId}>
                  {queueSearch ? (
                    <Link
                      to="/admin/solar-requests/$requestId/construction/{-$operation}"
                      params={{ requestId: row.requestId }}
                      search={queueSearch}
                      className={queueRow}
                    >
                      {constructionQueueLabel(row)}
                    </Link>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className={`${queueRow} h-auto whitespace-normal`}
                      aria-pressed={selected === row.requestId}
                      disabled={pending || !!action}
                      onClick={() => {
                        if (pendingRef.current || action || selected === row.requestId) return;
                        invalidate();
                        form.reset({ note: '' });
                        setProgress(null);
                        onSelect?.(row.requestId);
                      }}
                    >
                      {constructionQueueLabel(row)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </ListPage.Content>
          <ListPage.Pagination
            kind="cursor"
            loading={queueState === 'loading'}
            hasMore={fresh && !!queue?.nextBefore && queries.canAdvance(queue.nextBefore)}
            label={copy('constructionStaffTitle')}
            nextLabel={copy('moreRequests')}
            onNext={() => {
              if (pendingRef.current || action) return;
              invalidate();
              if (queue?.nextBefore) queries.next(queue.nextBefore);
            }}
            previous={{
              enabled: queries.hasPrevious,
              label: copy('previous'),
              onClick: () => {
                if (pendingRef.current || action) return;
                invalidate();
                queries.previous();
              },
            }}
          />
        </ListPage>
      )}
      {uncertain && !accessDenied.current && (
        <Alert variant="destructive">
          <AlertDescription>{copy('progressActionUnconfirmed')}</AlertDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              id="solar-construction-recovery-reload"
              type="button"
              variant="outline"
              disabled={busy()}
              onClick={() => {
                if (!busy()) setDetailRevision((value) => value + 1);
              }}
            >
              {copy('constructionReload')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy()}
              onClick={() => {
                const captured = reviewed.current;
                if (!captured || !live(captured) || busy()) return;
                captured.attempted = false;
                captured.rejected = false;
                uncertainRef.current = false;
                setUncertain(false);
                setAction(captured.action);
              }}
            >
              {copy('progressRetryCommand')}
            </Button>
          </div>
        </Alert>
      )}
      {selected && !visible && detailState === 'loading' && (
        <RecordDetailSkeleton label={copy('loading')} />
      )}
      {selected && !visible && detailState !== 'loading' && (
        <div className="space-y-2">
          <p role="alert">
            {copy(detailState === 'denied' ? 'staffQueueForbidden' : 'constructionDetailError')}
          </p>
          {detailState === 'error' && (
            <Button variant="outline" onClick={() => setDetailRevision((v) => v + 1)}>
              {copy('retry')}
            </Button>
          )}
        </div>
      )}
      {visible && !milestoneEditor && (
        <>
          {selected && !onSelect && canRecord && nextMilestone && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{copy('construction_current')}</p>
                <p className="font-medium">{copy(`construction_${nextMilestone}`)}</p>
              </div>
              <Link
                to="/admin/solar-requests/$requestId/construction/{-$operation}"
                params={{ requestId: selected, operation: solarMilestonePaths[nextMilestone] }}
                search={queueSearch ?? {}}
                className={buttonVariants({ size: 'sm' })}
              >
                {tSolarStaffRecord('recordMilestone', locale)}
              </Link>
            </div>
          )}
          <SolarStageProgress progress={visible} showTimeNotice={false} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            {visible.contractId && (
              <Link
                className="touch-action text-sm text-primary underline underline-offset-4"
                to="/admin/contracts/$contractId/{-$action}/{-$item}"
                params={{ contractId: visible.contractId }}
              >
                {copy('solarViewContract')}
              </Link>
            )}
            {reloadProgress}
          </div>
        </>
      )}
      {recordedMilestone && (
        <div role="status" className="rounded-xl border bg-card px-4 py-4 sm:px-6">
          <p className="font-medium">{tSolarStaffRecord('milestoneRecorded', locale)}</p>
          <p className="text-sm text-muted-foreground">
            {copy(`construction_${recordedMilestone}`)}
          </p>
        </div>
      )}
      {visible && !recordedMilestone && editingStage && (milestoneEditor || onSelect) && (
        <Form {...form}>
          <form
            aria-label={copy('constructionReviewTitle')}
            noValidate
            className={recordEditorSurface}
            onSubmit={review}
          >
            <RecordEditorSection title={copy(`construction_${editingStage}`)}>
              {milestoneEditor && lastMilestone && (
                <dl className="space-y-1 rounded-lg bg-muted/45 p-3 text-sm">
                  <dt className="text-muted-foreground">
                    {tSolarStaffRecord('previousMilestone', locale)}
                  </dt>
                  <dd className="flex flex-wrap items-baseline gap-x-2">
                    <span>{copy(`construction_${lastMilestone.stage}`)}</span>
                    <time className="text-muted-foreground" dateTime={lastMilestone.recordedAt}>
                      {time.format(lastMilestone.recordedAt, { dateStyle: 'medium' })}
                    </time>
                  </dd>
                </dl>
              )}
              {form.formState.errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>{copy('progressValidationUnavailable')}</AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem id="solar-construction-note" className={recordEditorField}>
                    <FormLabel>{copy('constructionNote')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        dir="auto"
                        aria-required="true"
                        disabled={locked}
                        rows={2}
                        className="min-h-14 max-h-36 resize-y"
                        placeholder={tSolarStaffRecord(milestoneExamples[editingStage], locale)}
                      />
                    </FormControl>
                    <FormDescription>{copy('progressNoteHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {saveError && (
                <Alert variant="destructive">
                  <AlertDescription>{copy('constructionSaveError')}</AlertDescription>
                </Alert>
              )}
            </RecordEditorSection>
            <RecordEditorActions>
              <Button
                type="submit"
                loading={preparing || form.formState.isSubmitting}
                disabled={pending || !!action || uncertain || !visible.canRecord}
              >
                {copy('constructionReview')}
              </Button>
            </RecordEditorActions>
          </form>
        </Form>
      )}
      {visible && !recordedMilestone && !editingStage && (
        <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
          {canRecord
            ? tSolarStaffRecord('milestoneUnavailable', locale)
            : copy(visible.revision === 3 ? 'constructionDone' : 'constructionBlocked')}
        </p>
      )}
      {action && reviewed.current && (
        <TeamActionDialog
          action={action}
          toastErrors={!milestoneEditor}
          confirmationDisabled={uncertain}
          onClose={closeAction}
          onDenied={() => {
            if (reviewed.current && live(reviewed.current)) deny();
          }}
          onPendingChange={(value) => {
            const captured = reviewed.current;
            if (!captured || !live(captured)) return;
            pendingRef.current = value;
            setPending(value);
          }}
          onCommandDispatch={(dispatched) => {
            const captured = reviewed.current;
            if (captured && live(captured)) captured.attempted = dispatched || captured.unconfirmed;
          }}
          onUnconfirmed={() => {
            if (reviewed.current) unconfirmed(reviewed.current);
          }}
          onValidationError={(fields) => {
            const captured = reviewed.current;
            if (!captured || !live(captured) || captured.unconfirmed || !noteFields(fields))
              return false;
            captured.rejected = true;
            return true;
          }}
          onSuccess={async (result) => {
            const captured = reviewed.current;
            if (!captured || !live(captured)) return;
            const saved = confirmedProgress(result, captured.captured);
            if (!saved) throw new Error('Unconfirmed construction update');
            reviewed.current = null;
            uncertainRef.current = false;
            pendingRef.current = false;
            setUncertain(false);
            setPending(false);
            setAction(null);
            setProgress(saved);
            setProgressScope(scope);
            form.reset({ note: '' });
            setSaveError(false);
            setQueueRevision((v) => v + 1);
            if (milestoneEditor) {
              setRecordedMilestone(captured.captured.command.stage);
              return undefined;
            }
            return confirmationText('recorded', locale);
          }}
          summary={
            <div className="space-y-2 rounded-md border p-4">
              <p className="font-medium">{copy(`construction_${command!.stage}`)}</p>
              <p className="whitespace-pre-wrap break-words">{command!.note}</p>
            </div>
          }
        />
      )}
    </div>
  );
}
