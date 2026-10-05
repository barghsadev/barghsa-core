import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { reconciliationApiQuery, reconciliationLocalTime } from '../lib/decision-queue-query.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Button,
  ListPage,
  DateCell,
  TextCell,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import {
  Form,
  FormInput,
  FormTextarea,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormSubmit,
  useZodForm,
} from '@barghsa/ui/form';
import {
  reconciliationBounds,
  reconciliationFilterErrors,
  reconciliationNoteErrors,
  reconciliationAllowed,
  isReconciliationItem,
  matchesReconciliationReceipt,
  reconciliationLinks,
  type ReconciliationItem as Item,
  type ReconciliationVerb,
  type ReconciliationFilterDraft,
  type ReconciliationNoteDraft,
} from '../lib/reconciliation-form.js';
const statuses = ['open', 'investigating', 'resolved', 'closed'];
const severities = ['low', 'medium', 'high', 'critical'];
const pageSize = 25;
export default function AdminReconciliationPage({ queries }: { queries?: ListQueryBinding } = {}) {
  const time = useAccountTime();
  const detailTrigger = useRef<HTMLElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const locale = useLocale(),
    label = (key: string) => t(`admin.reconciliation.${key}`, locale);
  const initialFilters = useRef(queries?.query.filters).current;
  const filters = useZodForm<ReconciliationFilterDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<ReconciliationFilterDraft>(
        {
          status: label('invalidChoice'),
          severity: label('invalidChoice'),
          from: label('invalidDates'),
          before: label('invalidDates'),
        },
        (value) => reconciliationFilterErrors(value, time.timezone, initialFilters)
      );
    },
    {
      defaultValues: {
        status: initialFilters?.status === 'all' ? '' : initialFilters?.status || 'open',
        severity: initialFilters?.severity || '',
        from: '',
        before: '',
      },
      validationUnavailableMessage: label('validationUnavailable'),
    }
  );
  const notes = useZodForm<ReconciliationNoteDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<ReconciliationNoteDraft>(
        { note: label('invalidNote') },
        reconciliationNoteErrors
      );
    },
    { defaultValues: { note: '' }, validationUnavailableMessage: label('validationUnavailable') }
  );
  const [validating, setValidating] = useState<'filter' | 'note' | null>(null);
  const owned = useRef<'filter' | 'note' | 'command' | 'uncertain' | null>(null);
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [fresh, setFresh] = useState<Item | null>(null);
  const [freshState, setFreshState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [freshRevision, setFreshRevision] = useState(0);
  const refreshOnDismiss = useRef(false);
  const captured = useRef<{
    before: Item;
    verb: ReconciliationVerb;
    note: string;
    generation: number;
  } | null>(null);
  const [query, setQuery] = useState(
      initialFilters ? reconciliationApiQuery(initialFilters) : 'status=open'
    ),
    [localOffset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const offset = queries ? (queries.query.page - 1) * pageSize : localOffset;
  const hydratedZone = useRef<string | null>(null);
  useEffect(() => {
    if (!initialFilters || time.status !== 'ready' || hydratedZone.current === time.timezone)
      return;
    hydratedZone.current = time.timezone;
    filters.setValue(
      'from',
      reconciliationLocalTime(initialFilters.createdFrom || '', time.timezone)
    );
    filters.setValue(
      'before',
      reconciliationLocalTime(initialFilters.createdBefore || '', time.timezone)
    );
  }, [initialFilters, time.status, time.timezone]);
  const [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [canView, setCanView] = useState(false),
    [canResolve, setCanResolve] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null),
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
  const commandGeneration = useRef(0);
  const previousOffset = useRef(offset);
  if (previousOffset.current !== offset) {
    previousOffset.current = offset;
    ++workGeneration.current;
  }
  useEffect(() => {
    clearWork();
    setSaved(false);
  }, [offset]);
  const reviewed = useRef<Item | null>(null);
  const visibleItems = acceptedScope === query ? items : [];
  const locked = validating !== null || !!action || uncertain;
  function clearWork() {
    ++workGeneration.current;
    reviewed.current = null;
    setSelected(null);
    notes.reset({ note: '' });
    setAction(null);
    owned.current = null;
    sending.current = false;
    setPending(false);
    captured.current = null;
    refreshOnDismiss.current = false;
    setUncertain(false);
    setFresh(null);
    setValidating(null);
  }
  function denyAccess() {
    detailTrigger.current = null;
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
          !sending.current &&
          owned.current !== 'uncertain' &&
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
    if (
      sending.current ||
      owned.current === 'filter' ||
      owned.current === 'note' ||
      owned.current === 'uncertain'
    )
      return;
    accessValid.current = false;
    setAccessLoading(true);
    setAccessError(false);
    setAccessRevision((v) => v + 1);
  }
  async function filter(event: FormEvent) {
    event.preventDefault();
    if (owned.current || time.status !== 'ready') return;
    owned.current = 'filter';
    setValidating('filter');
    const current = workGeneration.current;
    try {
      await filters.handleSubmit((value) => {
        if (current !== workGeneration.current) return;
        const bounds = reconciliationBounds(value, time.timezone, initialFilters);
        setSaved(false);
        const params = new URLSearchParams();
        if (value.status) params.set('status', value.status);
        if (value.severity) params.set('severity', value.severity);
        if (bounds.from) params.set('createdFrom', bounds.from.toISOString());
        if (bounds.before) params.set('createdBefore', bounds.before.toISOString());
        const nextQuery = params.toString();
        if (queries) {
          queries.setQuery({
            filters: {
              status: value.status || 'all',
              severity: value.severity,
              createdFrom: bounds.from?.toISOString() || '',
              createdBefore: bounds.before?.toISOString() || '',
            },
            page: 1,
          });
          if (nextQuery === query && offset === 0) setRevision((v) => v + 1);
        } else {
          setOffset(0);
          if (nextQuery !== query) clearWork();
          setQuery(nextQuery);
          setRevision((v) => v + 1);
        }
      })(event);
    } finally {
      if (owned.current === 'filter' && current === workGeneration.current) {
        owned.current = null;
        setValidating(null);
      }
    }
  }
  async function prepare(verb: ReconciliationVerb, event?: FormEvent) {
    event?.preventDefault();
    if (
      !selected ||
      owned.current ||
      loading ||
      error ||
      accessLoading ||
      accessError ||
      !accessValid.current ||
      !resolveAllowed.current ||
      !reconciliationAllowed(selected.status, verb)
    )
      return;
    owned.current = 'note';
    setValidating('note');
    const current = workGeneration.current;
    const capture = (value: ReconciliationNoteDraft) => {
      if (current !== workGeneration.current || !accessValid.current || !resolveAllowed.current)
        return;
      commandGeneration.current = ++workGeneration.current;
      const note = verb === 'investigate' ? '' : value.note.trim();
      captured.current = {
        before: structuredClone(selected),
        verb,
        note,
        generation: commandGeneration.current,
      };
      reviewed.current = selected;
      owned.current = 'command';
      setValidating(null);
      setAction({
        title: label(verb),
        description: label('confirm'),
        path: `/api/admin/reconciliation/items/${selected.id}/${verb}`,
        method: 'POST',
        body: verb === 'investigate' ? {} : { note },
        successStatus: 200,
        conflictMessage: label('changed'),
        forbiddenMessage: label('denied'),
      });
    };
    try {
      if (verb === 'investigate') capture({ note: '' });
      else await notes.handleSubmit(capture)(event);
    } finally {
      if (owned.current === 'note' && current === workGeneration.current) {
        owned.current = null;
        setValidating(null);
      }
    }
  }
  function closeAction() {
    setAction(null);
    sending.current = false;
    setPending(false);
    if (!uncertain) {
      owned.current = null;
      captured.current = null;
    }
  }
  function dismiss() {
    const refresh = refreshOnDismiss.current;
    clearWork();
    if (refresh) setRevision((v) => v + 1);
  }
  useEffect(() => {
    if (!uncertain || !selected) return;
    const controller = new AbortController();
    const current = workGeneration.current;
    setFreshState('loading');
    setFresh(null);
    void fetch(`/api/admin/reconciliation/items/${selected.id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error([401, 403].includes(response.status) ? 'denied' : 'error');
        const value: unknown = await response.json();
        if (!isReconciliationItem(value) || value.id !== selected.id)
          throw new Error('Invalid saved exception');
        if (controller.signal.aborted || current !== workGeneration.current || !accessValid.current)
          return;
        refreshOnDismiss.current = true;
        setFresh(value);
        setFreshState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current !== workGeneration.current) return;
        if (reason instanceof Error && reason.message === 'denied') denyAccess();
        else setFreshState('error');
      });
    return () => controller.abort();
  }, [uncertain, selected?.id, freshRevision]);
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
  const date = (value: string) => <DateCell value={value} format={(stamp) => time.format(stamp)} />;
  const actionGeneration = commandGeneration.current;
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header>
        <h1 ref={listHeading} tabIndex={-1} className="text-2xl font-semibold">
          {label('title')}
        </h1>
        <p className="text-muted-foreground">{label('description')}</p>
      </header>
      <ListPage>
        <ListPage.Toolbar>
          <Button
            variant="outline"
            disabled={loading || accessLoading || validating !== null || pending || uncertain}
            onClick={() => {
              if (queries) queries.setQuery({ page: 1 });
              else setOffset(0);
              refreshAccess();
            }}
          >
            {label('refresh')}
          </Button>
          <Form {...filters}>
            <form
              onSubmit={filter}
              noValidate
              onChangeCapture={(event) => {
                if (owned.current) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              className="rounded-lg border bg-card text-card-foreground p-4"
            >
              <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {(['status', 'severity'] as const).map((name) => (
                  <FormField
                    key={name}
                    control={filters.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem id={`rex-${name}`} className="min-w-0">
                        <FormLabel>{label(name)}</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            className="block w-full min-w-0 rounded border bg-card p-2"
                          >
                            <option value="">{label('all')}</option>
                            {(name === 'status' ? statuses : severities).map((value) => (
                              <option key={value} value={value}>
                                {label(value)}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                ))}
                <FormInput
                  control={filters.control}
                  name="from"
                  id="rex-from"
                  label={label('from')}
                  disabled={time.status !== 'ready'}
                  inputProps={{ type: 'datetime-local', className: 'min-w-0 w-full' }}
                  itemClassName="min-w-0"
                />
                <FormInput
                  control={filters.control}
                  name="before"
                  id="rex-before"
                  label={label('before')}
                  disabled={time.status !== 'ready'}
                  inputProps={{ type: 'datetime-local', className: 'min-w-0 w-full' }}
                  itemClassName="min-w-0"
                />
                <FormSubmit
                  loading={validating === 'filter'}
                  disabled={locked || time.status !== 'ready'}
                >
                  {label('apply')}
                </FormSubmit>
                <p className="sm:col-span-2 xl:col-span-5 text-sm text-muted-foreground">
                  {time.status === 'ready' && label('timeHint').replace('{zone}', time.timezone)}
                </p>
                {filters.formState.errors.root?.validation?.message && (
                  <p role="alert">{filters.formState.errors.root.validation.message}</p>
                )}
              </fieldset>
            </form>
          </Form>
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
          <OperationalQueueTable
            locale={locale}
            cardHeading="h2"
            rows={visibleItems}
            caption={label('title')}
            scrollLabel={label('tableTitle')}
            loading={loading || accessLoading}
            emptyMessage={label('empty')}
            tableClassName="min-w-[40rem]"
            nameHeader={label('details')}
            renderName={(item) => (
              <>
                <Button
                  variant="link"
                  className="h-auto max-w-full whitespace-normal text-start"
                  disabled={locked}
                  onClick={(event) => {
                    if (owned.current) return;
                    detailTrigger.current = event.currentTarget;
                    ++workGeneration.current;
                    reviewed.current = item;
                    setSelected(item);
                    notes.reset({ note: '' });
                    setSaved(false);
                  }}
                >
                  <TextCell value={item.description} />
                </Button>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {label(item.exceptionType)}
                </span>
              </>
            )}
            fields={[
              {
                id: 'severity',
                label: label('severity'),
                render: (item) => <>{label(item.severity)}</>,
              },
              { id: 'status', label: label('status'), render: (item) => <>{label(item.status)}</> },
              {
                id: 'created',
                label: label('created'),
                render: (item) => <>{date(item.createdAt)}</>,
              },
              {
                id: 'assigned',
                label: label('assigned'),
                render: (item) => (
                  <TextCell value={item.assignedToUsername ?? label('unassigned')} />
                ),
              },
            ]}
          />
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          label={label('pages')}
          loading={loading || accessLoading || locked}
          hasMore={
            canView &&
            !error &&
            !accessError &&
            visibleItems.length >= pageSize &&
            (!queries || queries.query.page < 1_000_000)
          }
          nextLabel={label('next')}
          onNext={() =>
            queries
              ? queries.setQuery({ page: queries.query.page + 1 })
              : setOffset((v) => v + pageSize)
          }
          previous={{
            enabled: canView && !error && !accessError && offset > 0,
            label: label('previous'),
            onClick: () =>
              queries
                ? queries.setQuery({ page: Math.max(1, queries.query.page - 1) })
                : setOffset((v) => Math.max(0, v - pageSize)),
          }}
        />
      </ListPage>
      {selected && !action && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && owned.current !== 'filter' && owned.current !== 'note') dismiss();
          }}
        >
          <DialogContent
            className="max-h-[85dvh] overflow-y-auto"
            finalFocus={() =>
              detailTrigger.current?.isConnected &&
              detailTrigger.current.getClientRects().length > 0 &&
              !detailTrigger.current.hasAttribute('disabled')
                ? detailTrigger.current
                : listHeading.current
            }
            initialFocus={
              notes.formState.errors.note ? () => document.getElementById('rex-note') : undefined
            }
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
            {reconciliationLinks(selected.details).length > 0 && (
              <nav aria-label={label('related')} className="flex flex-wrap gap-3">
                {reconciliationLinks(selected.details).map((link) => (
                  <a key={link.href} className="underline underline-offset-4" href={link.href}>
                    {label(link.label)}
                  </a>
                ))}
              </nav>
            )}
            {uncertain && (
              <div role="alert" className="space-y-3">
                <p>{label('unconfirmed')}</p>
                {freshState === 'loading' && <p role="status">{label('reviewLoading')}</p>}
                {freshState === 'error' && (
                  <>
                    <p>{label('reviewError')}</p>
                    <Button variant="outline" onClick={() => setFreshRevision((v) => v + 1)}>
                      {label('reviewRetry')}
                    </Button>
                  </>
                )}
                {fresh && (
                  <p>
                    {label('savedStatus')}: <strong>{label(fresh.status)}</strong>
                    {fresh.resolutionNote && <> · {fresh.resolutionNote}</>}
                  </p>
                )}
                <Button
                  variant="outline"
                  disabled={freshState !== 'ready' || !fresh || !accessValid.current}
                  onClick={() => {
                    if (!fresh || freshState !== 'ready' || !accessValid.current) return;
                    ++workGeneration.current;
                    reviewed.current = fresh;
                    setSelected(fresh);
                    captured.current = null;
                    owned.current = null;
                    setUncertain(false);
                    notes.clearErrors();
                  }}
                >
                  {label('returnToEditing')}
                </Button>
              </div>
            )}
            {canResolve && selected.status !== 'closed' && (
              <Form {...notes}>
                <form
                  noValidate
                  onSubmit={(event) => {
                    const submitter = (event.nativeEvent as SubmitEvent).submitter;
                    const verb =
                      submitter instanceof HTMLButtonElement && submitter.value === 'close'
                        ? 'close'
                        : selected.status === 'resolved'
                          ? 'close'
                          : 'resolve';
                    void prepare(verb, event);
                  }}
                  onChangeCapture={(event) => {
                    if (owned.current) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                  className="space-y-3"
                >
                  <fieldset disabled={locked} className="space-y-3">
                    {selected.status === 'open' && (
                      <Button
                        type="button"
                        disabled={locked || loading || error || accessLoading || accessError}
                        onClick={() => void prepare('investigate')}
                      >
                        {label('investigate')}
                      </Button>
                    )}
                    <FormTextarea
                      control={notes.control}
                      name="note"
                      id="rex-note"
                      label={label('note')}
                      inputProps={{ maxLength: 1000, className: 'min-h-24' }}
                    />
                    {notes.formState.errors.root?.validation?.message && (
                      <p role="alert">{notes.formState.errors.root.validation.message}</p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      {['open', 'investigating'].includes(selected.status) && (
                        <FormSubmit
                          name="decision"
                          value="resolve"
                          loading={validating === 'note'}
                          disabled={locked || loading || error || accessLoading || accessError}
                        >
                          {label('resolve')}
                        </FormSubmit>
                      )}
                      <FormSubmit
                        name="decision"
                        value="close"
                        variant="outline"
                        loading={validating === 'note'}
                        disabled={locked || loading || error || accessLoading || accessError}
                      >
                        {label('close')}
                      </FormSubmit>
                    </div>
                  </fieldset>
                </form>
              </Form>
            )}
            <Button variant="outline" disabled={validating !== null} onClick={dismiss}>
              {label('dismiss')}
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            <div className="space-y-3">
              {captured.current && (
                <dl className="space-y-2 break-words text-sm">
                  <div>
                    <dt className="font-semibold">{label('details')}</dt>
                    <dd>{captured.current.before.description}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{label('status')}</dt>
                    <dd>
                      {label(captured.current.before.status)} →{' '}
                      {label(
                        captured.current.verb === 'investigate'
                          ? 'investigating'
                          : captured.current.verb === 'resolve'
                            ? 'resolved'
                            : 'closed'
                      )}
                    </dd>
                  </div>
                  {captured.current.verb !== 'investigate' && (
                    <div>
                      <dt className="font-semibold">{label('note')}</dt>
                      <dd className="whitespace-pre-wrap">{captured.current.note}</dd>
                    </div>
                  )}
                  {captured.current.verb === 'close' && captured.current.before.resolutionNote && (
                    <div>
                      <dt className="font-semibold">{label('retainedResolution')}</dt>
                      <dd className="whitespace-pre-wrap">
                        {captured.current.before.resolutionNote}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {recoveryView}
            </div>
          }
          confirmationDisabled={loading || error || accessLoading || accessError || !canResolve}
          onPendingChange={(value) => {
            if (actionGeneration !== workGeneration.current) return;
            sending.current = value;
            setPending(value);
          }}
          onClose={() => {
            if (actionGeneration === workGeneration.current) closeAction();
          }}
          onDenied={denyAccess}
          onValidationError={(fields) => {
            if (actionGeneration !== workGeneration.current || !fields.includes('note'))
              return false;
            notes.setError('note', { type: 'server', message: label('invalidNote') });
            return true;
          }}
          onUnconfirmed={() => {
            if (actionGeneration !== workGeneration.current || !captured.current) return;
            owned.current = 'uncertain';
            sending.current = false;
            setPending(false);
            setAction(null);
            setUncertain(true);
            setSaved(false);
            setFresh(null);
          }}
          onSuccess={async (data) => {
            if (
              actionGeneration !== workGeneration.current ||
              !accessValid.current ||
              !resolveAllowed.current
            )
              return;
            const command = captured.current;
            if (
              !command ||
              !matchesReconciliationReceipt(data, command.before, command.verb, command.note)
            )
              throw new Error('Unconfirmed reconciliation receipt');
            clearWork();
            setSaved(true);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
