import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { tSolar } from '@barghsa/i18n/solar';
import { Alert, AlertDescription, Button, Input, Label, ListPage, Textarea } from '@barghsa/ui';
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
import type { SolarProgress } from '../lib/solar-progress.js';
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
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
interface Row {
  requestId: string;
  contractId: string;
  contractNumber: string;
  submittedAt: string;
  contractState: string;
  stage: string | null;
  revision: number;
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
}: {
  queries: ListQueryBinding;
  selected: string | null;
  onSelect: (id: string | null) => void;
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
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const uncertainRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const accessDenied = useRef(false);
  const q = queries.query.search,
    before = queries.query.cursor;
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
      generation.current += 1;
    };
  }, []);
  function invalidate() {
    generation.current += 1;
    setAction(null);
    reviewed.current = null;
    preparingRef.current = false;
    pendingRef.current = false;
    uncertainRef.current = false;
    setPreparing(false);
    setPending(false);
    setUncertain(false);
    setSaveError(false);
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
    if (accessDenied.current) return () => abort.abort();
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
        const result = (await response.json()) as { items: Row[]; nextBefore: string | null };
        if (!abort.signal.aborted && !accessDenied.current && currentActor.current === actor) {
          setQueue({ ...result, search: q, key: queueKey, actor });
          setQueueState('ready');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted && !accessDenied.current && currentActor.current === actor)
          setQueueState('error');
      });
    return () => abort.abort();
  }, [q, before, queueRevision, actor, readStaff]);
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
  }, [scope, detailRevision, readStaff]);
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !progress?.canRecord ||
      !progress.nextMilestone ||
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
      try {
        const response = await fetch(
          `/api/admin/solar/construction/${encodeURIComponent(captured.requestId)}/review`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(captured.command),
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
        const result: unknown = await response.json().catch(() => null);
        if (
          !mounted.current ||
          generation.current !== token ||
          currentScope.current !== scope ||
          form.getValues('note') !== rawNote
        )
          return;
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
  const locked = preparing || pending || form.formState.isSubmitting || !!action || uncertain;
  return (
    <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-3xl font-semibold">{copy('constructionStaffTitle')}</h1>
        <p className="mt-2 text-muted-foreground">{copy('constructionStaffDescription')}</p>
      </header>
      {time.notice}
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
          loadingView={<p role="status">{copy('loading')}</p>}
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
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <li key={row.requestId}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full min-w-0 flex-col items-start gap-2 whitespace-normal p-4 text-start"
                  aria-pressed={selected === row.requestId}
                  disabled={pending || !!action}
                  onClick={() => {
                    if (pendingRef.current || action || selected === row.requestId) return;
                    invalidate();
                    form.reset({ note: '' });
                    setProgress(null);
                    onSelect(row.requestId);
                  }}
                >
                  <span>
                    {copy('solarViewContract')}: <bdi>{row.contractNumber}</bdi>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {row.stage ? copy(`construction_${row.stage}`) : copy('constructionNoUpdates')}
                  </span>
                  <span className="text-xs text-muted-foreground break-all">
                    <bdi>{row.requestId}</bdi>
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={row.submittedAt}>
                    {time.format(row.submittedAt, { dateStyle: 'medium' })}
                  </time>
                </Button>
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
      {!selected && <p>{copy('constructionSelect')}</p>}
      {selected && !visible && (
        <div className="space-y-2">
          <p role={detailState === 'loading' ? 'status' : 'alert'}>
            {copy(
              detailState === 'loading'
                ? 'loading'
                : detailState === 'denied'
                  ? 'staffQueueForbidden'
                  : 'constructionDetailError'
            )}
          </p>
          {detailState === 'error' && (
            <Button variant="outline" onClick={() => setDetailRevision((v) => v + 1)}>
              {copy('retry')}
            </Button>
          )}
        </div>
      )}
      {visible && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {visible.contractId && (
              <Link
                className="underline"
                to="/admin/contracts/$contractId"
                params={{ contractId: visible.contractId }}
              >
                {copy('solarViewContract')}
              </Link>
            )}
            <Button
              id="solar-construction-reload"
              variant="outline"
              disabled={busy()}
              onClick={() => {
                if (busy()) return;
                setDetailRevision((v) => v + 1);
              }}
            >
              {copy('constructionReload')}
            </Button>
          </div>
          <SolarStageProgress progress={visible} showTimeNotice={false} />
          {(visible.canRecord && visible.nextMilestone) || uncertain ? (
            <Form {...form}>
              <form
                aria-label={copy('constructionReviewTitle')}
                noValidate
                className="space-y-4 rounded-xl border bg-card p-5"
                onSubmit={review}
              >
                <h2 className="text-lg font-semibold">
                  {copy(`construction_${uncertain ? command?.stage : visible.nextMilestone}`)}
                </h2>
                {form.formState.errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>{copy('progressValidationUnavailable')}</AlertDescription>
                  </Alert>
                )}
                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem id="solar-construction-note">
                      <FormLabel>{copy('constructionNote')}</FormLabel>
                      <FormControl>
                        <Textarea {...field} aria-required="true" disabled={locked} />
                      </FormControl>
                      <FormDescription>{copy('progressNoteHelp')}</FormDescription>
                      <div className="grid">
                        <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                          {copy('progressNoteInvalid')}
                        </p>
                        <FormMessage className="col-start-1 row-start-1" />
                      </div>
                    </FormItem>
                  )}
                />
                {saveError && (
                  <Alert variant="destructive">
                    <AlertDescription>{copy('constructionSaveError')}</AlertDescription>
                  </Alert>
                )}
                <Button
                  type="submit"
                  loading={preparing || form.formState.isSubmitting}
                  disabled={pending || !!action || uncertain || !visible.canRecord}
                >
                  {copy('constructionReview')}
                </Button>
              </form>
            </Form>
          ) : (
            <p role="status">
              {copy(visible.revision === 3 ? 'constructionDone' : 'constructionBlocked')}
            </p>
          )}
        </>
      )}
      {action && reviewed.current && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={uncertain}
          onClose={closeAction}
          onDenied={() => {
            if (reviewed.current && live(reviewed.current)) deny();
          }}
          onPendingChange={(value) => {
            const captured = reviewed.current;
            if (!captured || !live(captured)) return;
            if (value) captured.attempted = true;
            pendingRef.current = value;
            setPending(value);
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
