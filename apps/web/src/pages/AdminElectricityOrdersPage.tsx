import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Alert,
  AlertDescription,
  Textarea,
  Button,
  Card,
  CardContent,
  DualStatusDisplay,
  FinancialReviewSummary,
  Input,
  Label,
  ListPage,
  ScrollArea,
  StatusTimeline,
} from '@barghsa/ui';
import { t as appText } from '@barghsa/i18n/app';
import { type ElectricityStaffDecisionReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
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
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import {
  boundStaffDecisionReview,
  confirmedStaffDecision,
  definitiveStaffDecisionRejection,
  type StaffReasonDraft,
} from '../lib/electricity-staff-reason-form.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { ElectricityOrderComments } from '../components/SavingOrderComments.js';
import {
  commercialStatusTone,
  financialStatusTone,
  electricityStatusKey,
} from '../lib/electricity-status-tone.js';
import { electricityTimelineKey, electricityTimelineState } from '../lib/electricity-timeline.js';
import { withCsrf } from '../lib/csrf.js';
import { staffOrderId, type StaffOrderListQuery } from '../lib/staff-order-list-query.js';

interface ReviewOrder {
  orderId: string;
  profileId: string;
  contractId: string | null;
  contractState: string | null;
  invoiceId: string;
  invoiceState: string;
  customerName: string;
  commercialStatus: string;
  financialStatus: string;
  nextAction: string;
  submittedAt: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: string;
  pricingSnapshot: Record<string, unknown>;
  settingsSnapshot: Record<string, unknown>;
  fullAddress: string;
  contractSnapshot: Record<string, unknown>;
  versionId: string;
  totalIrR: string;
  paidIrR: string;
  ageHours?: number;
  priority?: string;
  latestCommentAt?: string;
  timeline?: Array<{
    id: string;
    event: string;
    at: string;
    actor: string | null;
    actorName?: string | null;
    reason: string | null;
    comment: string | null;
  }>;
  revisionReview?: {
    versionNumber: number;
    staffReason: string | null;
    customerResponse: string | null;
    before: ReviewFacts;
    after: ReviewFacts;
  } | null;
}

interface ReviewFacts {
  periodStart: string | null;
  periodEnd: string | null;
  totalKwh: string | null;
  totalIrR: string | null;
  fullAddress: string | null;
  invoiceId: string | null;
  lines: Array<{ systemKey: string; quantityKwh: string }>;
}

type Decision = 'approve' | 'request-changes' | 'reject';
interface CapturedDecision {
  action: TeamAction;
  review: ElectricityStaffDecisionReview;
  request: number;
  scope: string;
  attempted: boolean;
  rejected: boolean;
  unconfirmed: boolean;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pricingLines(snapshot: Record<string, unknown>) {
  if (!Array.isArray(snapshot.lines)) return [];
  return snapshot.lines.filter(
    (
      line
    ): line is {
      systemKey: string;
      quantityKwh: string;
      unitPriceIrR: string;
      subtotalIrR?: string;
      discountIrR?: string;
      netIrR: string;
      vatIrR: string;
    } =>
      typeof line === 'object' &&
      line !== null &&
      typeof line.systemKey === 'string' &&
      typeof line.quantityKwh === 'string' &&
      typeof line.unitPriceIrR === 'string' &&
      typeof line.netIrR === 'string' &&
      typeof line.vatIrR === 'string'
  );
}

function contractTemplate(snapshot: Record<string, unknown>) {
  const value = snapshot.template;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const template = value as Record<string, unknown>;
  if (
    typeof template.name !== 'string' ||
    typeof template.versionNumber !== 'number' ||
    !Number.isInteger(template.versionNumber) ||
    typeof template.text !== 'string'
  )
    return null;
  return { name: template.name, versionNumber: template.versionNumber, text: template.text };
}

export default function AdminElectricityOrdersPage({
  queries,
}: { queries?: StaffOrderListQuery } = {}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const formCopy = (key: string) => appText(`electricity.staffReasonForm.${key}`, locale);
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityOrders.${key}`, locale);
  const statusLabel = (status: string, kind: 'commercial' | 'financial') => {
    const key = `${kind}.${status}`;
    const label = copy(key);
    return label === `admin.electricityOrders.${key}`
      ? appText(electricityStatusKey(status, kind), locale)
      : label;
  };
  const periodText = (start: string, end: string) => {
    const day = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
    return `${time.format(start, day)} – ${time.format(new Date(new Date(end).getTime() - 1), day)}`;
  };
  const [accepted, setAccepted] = useState<{
    criteria: string;
    actor: string | null;
    cursor: string | null;
    orders: ReviewOrder[];
    nextAfter: string | null;
  } | null>(null);
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const after = queries ? queries.queue.query.cursor || null : localAfter;
  const setAfter = (value: string | null) =>
    queries ? queries.queue.setQuery({ cursor: value ?? '' }) : setLocalAfter(value);
  const [localSelected, setLocalSelected] = useState<string | null>(
    () => staffOrderId(new URLSearchParams(window.location.search).get('orderId')) || null
  );
  const selectedId = queries ? queries.selected : localSelected;
  const setSelectedId = (id: string | null, replace = false) =>
    queries ? queries.select(id, replace) : setLocalSelected(id);
  const [lookupId, setLookupId] = useState(
    () => new URLSearchParams(window.location.search).get('orderId') ?? ''
  );
  const [lookupInvalid, setLookupInvalid] = useState(false);
  const [localView, setLocalView] = useState<'review' | 'conversations'>('review');
  const queueView = queries?.queue.query.filters.view || localView;
  const orders =
    accepted?.criteria === queueView && accepted.actor === actor ? accepted.orders : [];
  const nextAfter =
    accepted?.criteria === queueView && accepted.actor === actor ? accepted.nextAfter : null;
  const [loadedDetail, setDetail] = useState<ReviewOrder | null>(null);
  const [detailScope, setDetailScope] = useState('');
  const scope = JSON.stringify([actor, selectedId, queueView]);
  const detail =
    loadedDetail?.orderId === selectedId && detailScope === scope ? loadedDetail : null;
  const [detailError, setDetailError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [decisionReview, setDecisionReview] = useState<ElectricityStaffDecisionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const reviewRequest = useRef(0);
  const currentScope = useRef(scope);
  const currentActor = useRef(actor);
  const accessDenied = useRef(false);
  if (currentActor.current !== actor) {
    currentActor.current = actor;
    accessDenied.current = false;
  }
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    ++reviewRequest.current;
  }
  const schemaRequest = reviewRequest.current;
  const form = useZodForm<StaffReasonDraft>(
    async () => {
      const schemas = await import('../lib/electricity-staff-reason-form-schemas.js');
      return schemaRequest === reviewRequest.current
        ? schemas.staffReasonSchema(formCopy('invalid'))
        : schemas.inactiveStaffReasonSchema;
    },
    {
      defaultValues: { reason: '' },
      validationUnavailableMessage: formCopy('validationUnavailable'),
    }
  );
  const reasonFields = useActionFieldErrors(
    form,
    { reason: formCopy('invalid') },
    copy('reviewError')
  );
  const preparing = useRef(false);
  const pending = useRef(false);
  const captured = useRef<CapturedDecision | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++reviewRequest.current;
    };
  }, []);
  function live(command: CapturedDecision) {
    return (
      mounted.current &&
      !accessDenied.current &&
      captured.current === command &&
      command.request === reviewRequest.current &&
      command.scope === currentScope.current
    );
  }
  function locked() {
    return (
      preparing.current || pending.current || form.isSubmissionPending() || !!action || uncertain
    );
  }
  function invalidate() {
    ++reviewRequest.current;
    captured.current = null;
    preparing.current = false;
    pending.current = false;
    setAction(null);
    setDecisionReview(null);
    setReviewLoading(false);
    setUncertain(false);
    setReviewError(false);
  }
  function deny() {
    accessDenied.current = true;
    invalidate();
    form.reset({ reason: '' });
    setDenied(true);
    setLoading(false);
    setAccepted(null);
    setSelectedId(null, true);
    setDetail(null);
    setDetailError(false);
  }
  function missing() {
    invalidate();
    form.reset({ reason: '' });
    setDetail(null);
    setDetailScope('');
    setDetailError(true);
    // A missing selection withdraws its private data while other authorized queue work remains.
    setAccepted((current) =>
      current
        ? { ...current, orders: current.orders.filter((order) => order.orderId !== selectedId) }
        : current
    );
  }
  function unconfirmed(command: CapturedDecision) {
    if (!live(command)) return;
    command.unconfirmed = true;
    pending.current = false;
    setUncertain(true);
    setAction(null);
    setDecisionReview(null);
  }
  function decorateAction(command: CapturedDecision, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (result: unknown) => {
          if (live(command) && command.action === ownedAction) {
            if (code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
              missing();
              return copy('detailError');
            }
            if (definitiveStaffDecisionRejection(result)) {
              command.rejected = true;
              const fields = (result as { error: { fields?: unknown[] } }).error.fields;
              if (
                code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
                !command.unconfirmed &&
                command.review.data.action !== 'approve' &&
                Array.isArray(fields) &&
                reasonFields(fields)
              )
                closeDecision(command, ownedAction);
            }
          }
          return code.startsWith('CONFLICT:') ? copy('conflict') : copy('reviewError');
        },
      ])
    );
  }
  function closeDecision(command: CapturedDecision, ownedAction: TeamAction) {
    if (!live(command) || command.action !== ownedAction) return;
    if (command.unconfirmed || (command.attempted && !command.rejected)) unconfirmed(command);
    else captured.current = null;
    pending.current = false;
    setAction(null);
    setDecisionReview(null);
  }
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);

  function refreshQueue() {
    invalidate();
    setAccepted(null);
    setAfter(null);
    setRevision((value) => value + 1);
  }

  function selectOrder(id: string) {
    if (pending.current || action || uncertain) return;
    invalidate();
    setSelectedId(id);
    setLookupId(id);
    setLookupInvalid(false);
    setDetailError(false);
    form.reset({ reason: '' });
    setReviewError(false);
    setDecisionReview(null);
    setReviewLoading(false);
    if (!queries) {
      const url = new URL(window.location.href);
      url.searchParams.set('orderId', id);
      window.history.replaceState(window.history.state, '', url.toString());
    }
    if (id === selectedId) setDetailRevision((value) => value + 1);
  }

  function lookupOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = lookupId.trim();
    if (!UUID_RE.test(id)) {
      setLookupInvalid(true);
      return;
    }
    selectOrder(id);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    if (accessDenied.current) return () => controller.abort();
    setDenied(false);
    const url = after
      ? `/api/staff/electricity/orders${queueView === 'conversations' ? '/conversations' : ''}?after=${encodeURIComponent(after)}`
      : `/api/staff/electricity/orders${queueView === 'conversations' ? '/conversations' : ''}`;
    void fetch(url, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (controller.signal.aborted || currentActor.current !== actor || accessDenied.current)
          return null;
        if (response.status === 401 || response.status === 403) {
          deny();
          return null;
        }
        if (!response.ok) throw new Error('Queue unavailable');
        return response.json() as Promise<{ orders: ReviewOrder[]; nextAfter: string | null }>;
      })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          value &&
          currentActor.current === actor &&
          !accessDenied.current
        ) {
          setAccepted((current) => {
            const extending =
              !!after &&
              current?.criteria === queueView &&
              current.actor === actor &&
              current.nextAfter === after &&
              current.cursor !== after;
            const previous = extending ? current.orders : [];
            const shown = new Set(previous.map((order) => order.orderId));
            return {
              criteria: queueView,
              actor,
              cursor: after,
              orders: [...previous, ...value.orders.filter((order) => !shown.has(order.orderId))],
              nextAfter: staffOrderId(value.nextAfter) || null,
            };
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && currentActor.current === actor && !accessDenied.current)
          setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted && currentActor.current === actor && !accessDenied.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [after, revision, queueView, listRevision, actor]);

  useEffect(() => {
    setLookupId(selectedId ?? '');
    setLookupInvalid(false);
    form.reset({ reason: '' });
  }, [selectedId, queueView, actor]);

  useEffect(() => {
    invalidate();
    form.reset({ reason: '' });
    const request = reviewRequest.current;
    if (!selectedId || accessDenied.current) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(false);
    void fetch(`/api/staff/electricity/orders/${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (
          controller.signal.aborted ||
          currentScope.current !== scope ||
          request !== reviewRequest.current
        )
          return null;
        if ([401, 403].includes(response.status)) {
          deny();
          return null;
        }
        if (response.status === 404) {
          missing();
          return null;
        }
        if (!response.ok) throw new Error('Detail unavailable');
        return response.json() as Promise<ReviewOrder>;
      })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          value &&
          currentScope.current === scope &&
          request === reviewRequest.current &&
          !accessDenied.current
        ) {
          setDetail(value);
          setDetailScope(scope);
        }
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          currentScope.current === scope &&
          request === reviewRequest.current &&
          !accessDenied.current
        )
          setDetailError(true);
      });
    return () => controller.abort();
  }, [scope, revision, detailRevision]);

  function choose(decision: Decision) {
    if (
      !detail ||
      detail.commercialStatus !== 'awaiting_staff_review' ||
      locked() ||
      captured.current ||
      accessDenied.current
    )
      return;
    const order = detail;
    const request = reviewRequest.current;
    const rawReason = form.getValues('reason');
    preparing.current = true;
    setReviewLoading(true);
    setReviewError(false);
    const fresh = () =>
      mounted.current &&
      !accessDenied.current &&
      request === reviewRequest.current &&
      currentScope.current === scope &&
      (decision === 'approve' || form.getValues('reason') === rawReason);
    async function prepare(decisionReason: string) {
      if (!fresh()) return;
      try {
        const response = await fetch(
          `/api/staff/electricity/orders/${encodeURIComponent(order.orderId)}/financial-review`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ action: decision, reason: decisionReason }),
          }
        );
        if (!fresh()) return;
        if ([401, 403].includes(response.status)) {
          deny();
          return;
        }
        if (response.status === 404) {
          missing();
          return;
        }
        const value: unknown = await response.json().catch(() => null);
        if (!fresh()) return;
        if (
          response.status === 400 &&
          decision !== 'approve' &&
          value &&
          typeof value === 'object'
        ) {
          const error = (value as { error?: { code?: string; fields?: unknown[] } }).error;
          if (
            error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(error.fields) &&
            reasonFields(error.fields)
          )
            return;
        }
        if (!response.ok) throw new Error('Review unavailable');
        const review = boundStaffDecisionReview(value, order, decision, decisionReason);
        if (!review) throw new Error('Review mismatch');
        const command: CapturedDecision = {
          request,
          scope,
          review,
          attempted: false,
          rejected: false,
          unconfirmed: false,
          action: {
            title: copy(decision),
            description: copy('confirm'),
            path: `/api/staff/electricity/orders/${encodeURIComponent(order.orderId)}/${decision}`,
            method: 'POST',
            successStatus: 200,
            body: {
              idempotencyKey: crypto.randomUUID(),
              expectedVersionId: review.data.versionId,
              expectedReviewHash: review.hash,
              ...(decision === 'approve' ? {} : { reason: decisionReason }),
            },
            conflictMessage: copy('conflict'),
            forbiddenMessage: copy('forbidden'),
          },
        };
        decorateAction(command, command.action);
        captured.current = command;
        setDecisionReview(review);
        setAction(command.action);
      } catch {
        if (fresh()) {
          setReviewError(true);
          setDecisionReview(null);
        }
      }
    }
    const operation =
      decision === 'approve'
        ? prepare('')
        : form.handleSubmit(async (draft) => {
            if (draft.reason === rawReason) await prepare(draft.reason.trim());
          })();
    void operation.finally(() => {
      if (request === reviewRequest.current && mounted.current) {
        preparing.current = false;
        setReviewLoading(false);
      }
    });
  }

  const selectedTemplate = detail ? contractTemplate(detail.contractSnapshot) : null;

  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('title')}</h1>
          <p className="text-muted-foreground">{copy('description')}</p>
        </div>
      </header>
      <ListPage>
        <ListPage.Toolbar
          filters={
            <div className="space-y-3">
              <form className="flex flex-wrap items-end gap-3" onSubmit={lookupOrder}>
                <div className="min-w-0 flex-1 basis-64 space-y-2">
                  <Label htmlFor="electricity-order-lookup">{copy('lookupOrderId')}</Label>
                  <Input
                    id="electricity-order-lookup"
                    dir="ltr"
                    value={lookupId}
                    onChange={(event) => {
                      setLookupId(event.target.value);
                      setLookupInvalid(false);
                    }}
                    aria-invalid={lookupInvalid}
                    aria-describedby={lookupInvalid ? 'electricity-order-lookup-error' : undefined}
                  />
                </div>
                <Button type="submit" disabled={pending.current || !!action || uncertain}>
                  {copy('lookup')}
                </Button>
                {lookupInvalid ? (
                  <p id="electricity-order-lookup-error" role="alert" className="w-full text-sm">
                    {copy('invalidOrderId')}
                  </p>
                ) : null}
              </form>
              <nav className="flex flex-wrap gap-2" aria-label={copy('views')}>
                <Button
                  variant={queueView === 'review' ? 'secondary' : 'outline'}
                  disabled={pending.current || !!action || uncertain}
                  onClick={() => {
                    if (queueView === 'review' || pending.current || action || uncertain) return;
                    if (queries) queries.changeLane('review');
                    else {
                      setLocalView('review');
                      setLocalAfter(null);
                      setSelectedId(null);
                    }
                  }}
                >
                  {copy('reviewView')}
                </Button>
                <Button
                  variant={queueView === 'conversations' ? 'secondary' : 'outline'}
                  disabled={pending.current || !!action || uncertain}
                  onClick={() => {
                    if (queueView === 'conversations' || pending.current || action || uncertain)
                      return;
                    if (queries) queries.changeLane('conversations');
                    else {
                      setLocalView('conversations');
                      setLocalAfter(null);
                      setSelectedId(null);
                    }
                  }}
                >
                  {copy('conversationView')}
                </Button>
              </nav>
            </div>
          }
          actions={
            <Button
              variant="outline"
              onClick={() => {
                if (!locked()) refreshQueue();
              }}
              disabled={loading || locked()}
            >
              {copy('refresh')}
            </Button>
          }
        />
        {time.notice}
        <div className="grid gap-5 xl:grid-cols-[minmax(16rem,1fr)_minmax(24rem,2fr)]">
          <div
            className="space-y-3"
            aria-label={copy(queueView === 'conversations' ? 'conversationView' : 'queue')}
          >
            <ListPage.Content
              loading={loading}
              error={error || denied}
              empty={orders.length === 0 && !selectedId}
              retainContent={orders.length > 0 && !denied}
              loadingView={<p role="status">{copy('loading')}</p>}
              errorView={
                denied ? (
                  <p role="alert">{copy('forbidden')}</p>
                ) : (
                  <div className="space-y-2">
                    <p role="alert">{copy('error')}</p>
                    <Button variant="outline" onClick={() => setListRevision((value) => value + 1)}>
                      {appText('historyPagination.retry', locale)}
                    </Button>
                  </div>
                )
              }
              emptyView={
                <p>{copy(queueView === 'conversations' ? 'emptyConversations' : 'empty')}</p>
              }
            >
              {orders.map((order) => (
                <Button
                  key={order.orderId}
                  variant={selectedId === order.orderId ? 'secondary' : 'outline'}
                  className="h-auto w-full justify-start whitespace-normal p-4 text-start"
                  disabled={pending.current || !!action || uncertain}
                  onClick={() => selectOrder(order.orderId)}
                >
                  <span className="space-y-1">
                    <strong className="block">{order.customerName}</strong>
                    <span className="block text-xs">{order.orderId}</span>
                    <span className="block text-xs">
                      {queueView === 'conversations' && order.latestCommentAt
                        ? time.format(order.latestCommentAt)
                        : `${copy(`priority.${order.priority ?? 'normal'}`)} · ${numbers.number(order.ageHours ?? 0)} ${copy('hours')}`}
                    </span>
                  </span>
                </Button>
              ))}
            </ListPage.Content>
            <ListPage.Pagination
              kind="cursor"
              hasMore={
                !!nextAfter &&
                !error &&
                !denied &&
                !pending.current &&
                !action &&
                !uncertain &&
                (loading || (queries ? queries.queue.canAdvance(nextAfter) : nextAfter !== after))
              }
              loading={loading}
              onNext={() => {
                if (!nextAfter || pending.current || action || uncertain) return;
                if (queries) queries.queue.next(nextAfter);
                else setAfter(nextAfter);
              }}
              previous={{
                enabled:
                  !denied &&
                  !pending.current &&
                  !action &&
                  !uncertain &&
                  (queries?.queue.hasPrevious ?? false),
                onClick: () => {
                  if (!pending.current && !action && !uncertain) queries?.queue.previous();
                },
                label: appText('historyPagination.previous', locale),
              }}
              label={appText('historyPagination.label', locale)}
              nextLabel={copy('more')}
            />
          </div>
          {selectedId && !detail && !detailError ? (
            <p role="status">{copy('loadingDetail')}</p>
          ) : null}
          {detailError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{copy('detailError')}</p>
              <Button variant="outline" onClick={() => setDetailRevision((value) => value + 1)}>
                {copy('retryDetail')}
              </Button>
            </div>
          ) : null}
          {detail ? (
            <Card>
              <CardContent className="space-y-5 pt-6">
                <h2 className="text-lg font-semibold">{copy('detail')}</h2>
                <DualStatusDisplay
                  commercialLabel={copy('commercial')}
                  commercialStatus={statusLabel(detail.commercialStatus, 'commercial')}
                  commercialTone={commercialStatusTone(detail.commercialStatus)}
                  financialLabel={copy('financial')}
                  financialStatus={statusLabel(detail.financialStatus, 'financial')}
                  financialTone={financialStatusTone(detail.financialStatus)}
                />
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{copy('customer')}</dt>
                    <dd>{detail.customerName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('submitted')}</dt>
                    <dd>{time.format(detail.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('period')}</dt>
                    <dd>{periodText(detail.periodStart, detail.periodEnd)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('quantity')}</dt>
                    <dd>{detail.totalKwh} kWh</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('price')}</dt>
                    <dd>{numbers.money(detail.totalIrR)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('paid')}</dt>
                    <dd>{numbers.money(detail.paidIrR)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{copy('revision.invoice')}</dt>
                    <dd>
                      <a
                        className="text-primary underline underline-offset-2"
                        href={`/admin/invoices?invoiceId=${encodeURIComponent(detail.invoiceId)}`}
                      >
                        {copy('openInvoice')}
                      </a>
                    </dd>
                  </div>
                  {detail.contractId ? (
                    <div>
                      <dt className="text-muted-foreground">{copy('contract')}</dt>
                      <dd>
                        <a
                          className="text-primary underline underline-offset-2"
                          href={`/admin/contracts?contractId=${encodeURIComponent(detail.contractId)}`}
                        >
                          {copy('openContract')}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <p className="text-sm">
                  <strong>{copy('address')}: </strong>
                  {detail.fullAddress}
                </p>
                <section className="space-y-3">
                  <h3 className="font-medium">{copy('timeline')}</h3>
                  {detail.timeline?.length ? (
                    <StatusTimeline
                      label={copy('timeline')}
                      items={detail.timeline.map((event) => ({
                        id: event.id,
                        title: appText(electricityTimelineKey(event.event), locale),
                        state: electricityTimelineState(event.event),
                        dateTime: event.at,
                        dateLabel: time.format(event.at),
                        actorLabel: event.actorName ?? undefined,
                        description: [event.reason, event.comment].filter(Boolean).join(' · '),
                      }))}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">{copy('emptyTimeline')}</p>
                  )}
                </section>
                <h3 className="font-medium">{copy('products')}</h3>
                <ScrollArea
                  scrollbarOrientation="horizontal"
                  role="region"
                  aria-label={copy('products')}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start">
                        <th scope="col" className="p-2 text-start">
                          {copy('product')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('quantity')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('unitPrice')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('subtotal')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('discount')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('lineTotal')}
                        </th>
                        <th scope="col" className="p-2 text-start">
                          {copy('vat')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingLines(detail.pricingSnapshot).map((line) => (
                        <tr key={line.systemKey} className="border-b">
                          <td className="p-2">{copy(`product.${line.systemKey}`)}</td>
                          <td className="p-2">{line.quantityKwh} kWh</td>
                          <td className="p-2">{numbers.money(line.unitPriceIrR)}</td>
                          <td className="p-2">
                            {typeof line.subtotalIrR === 'string'
                              ? numbers.money(line.subtotalIrR)
                              : '—'}
                          </td>
                          <td className="p-2">
                            {typeof line.discountIrR === 'string'
                              ? numbers.money(line.discountIrR)
                              : '—'}
                          </td>
                          <td className="p-2">{numbers.money(line.netIrR)}</td>
                          <td className="p-2">{numbers.money(line.vatIrR)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
                {detail.revisionReview ? (
                  <section
                    className="space-y-3 rounded-md border p-4"
                    aria-label={copy('revision.title')}
                  >
                    <h3 className="font-semibold">
                      {copy('revision.title')} #{detail.revisionReview.versionNumber}
                    </h3>
                    {detail.revisionReview.staffReason ? (
                      <p>
                        <strong>{copy('revision.staffReason')}:</strong>{' '}
                        {detail.revisionReview.staffReason}
                      </p>
                    ) : null}
                    {detail.revisionReview.customerResponse ? (
                      <p>
                        <strong>{copy('revision.customerResponse')}:</strong>{' '}
                        {detail.revisionReview.customerResponse}
                      </p>
                    ) : null}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th scope="col" className="p-2 text-start">
                              {copy('revision.field')}
                            </th>
                            <th scope="col" className="p-2 text-start">
                              {copy('revision.previous')}
                            </th>
                            <th scope="col" className="p-2 text-start">
                              {copy('revision.current')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              ['quantity', 'totalKwh'],
                              ['price', 'totalIrR'],
                              ['address', 'fullAddress'],
                              ['revision.invoice', 'invoiceId'],
                            ] as const
                          ).map(([label, field]) => (
                            <tr key={field} className="border-b">
                              <th scope="row" className="p-2 text-start font-medium">
                                {copy(label)}
                              </th>
                              <td className="p-2">
                                {field === 'totalIrR'
                                  ? detail.revisionReview!.before[field]
                                    ? numbers.money(detail.revisionReview!.before[field]!)
                                    : '—'
                                  : (detail.revisionReview!.before[field] ?? '—')}
                              </td>
                              <td className="p-2">
                                {field === 'totalIrR'
                                  ? detail.revisionReview!.after[field]
                                    ? numbers.money(detail.revisionReview!.after[field]!)
                                    : '—'
                                  : (detail.revisionReview!.after[field] ?? '—')}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-b">
                            <th scope="row" className="p-2 text-start font-medium">
                              {copy('products')}
                            </th>
                            {(
                              [detail.revisionReview.before, detail.revisionReview.after] as const
                            ).map((facts, index) => (
                              <td key={index} className="p-2">
                                {facts.lines.length
                                  ? facts.lines
                                      .map(
                                        (line) =>
                                          `${copy(`product.${line.systemKey}`)}: ${line.quantityKwh} kWh`
                                      )
                                      .join(', ')
                                  : '—'}
                              </td>
                            ))}
                          </tr>
                          <tr className="border-b">
                            <th scope="row" className="p-2 text-start font-medium">
                              {copy('period')}
                            </th>
                            <td className="p-2">
                              {detail.revisionReview.before.periodStart &&
                              detail.revisionReview.before.periodEnd
                                ? periodText(
                                    detail.revisionReview.before.periodStart,
                                    detail.revisionReview.before.periodEnd
                                  )
                                : '—'}
                            </td>
                            <td className="p-2">
                              {detail.revisionReview.after.periodStart &&
                              detail.revisionReview.after.periodEnd
                                ? periodText(
                                    detail.revisionReview.after.periodStart,
                                    detail.revisionReview.after.periodEnd
                                  )
                                : '—'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}
                <section
                  className="flex flex-col gap-3 rounded-md border p-4"
                  aria-label={copy('contractPreview')}
                >
                  <h3 className="font-semibold">{copy('contractPreview')}</h3>
                  {selectedTemplate ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {selectedTemplate.name} · {copy('templateVersion')}{' '}
                        {selectedTemplate.versionNumber}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm" dir="auto">
                        {selectedTemplate.text}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{copy('noContractTemplate')}</p>
                  )}
                </section>
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">{copy('snapshots')}</summary>
                  <h3 className="mt-3 font-semibold">{copy('pricingSnapshot')}</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.pricingSnapshot, null, 2)}
                  </pre>
                  <h3 className="mt-3 font-semibold">{copy('settingsSnapshot')}</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.settingsSnapshot, null, 2)}
                  </pre>
                  <h3 className="mt-3 font-semibold">{copy('contractSnapshot')}</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.contractSnapshot, null, 2)}
                  </pre>
                </details>
                <ElectricityOrderComments
                  key={detail.orderId}
                  orderId={detail.orderId}
                  profileId={detail.profileId}
                  sourceVersion={JSON.stringify([scope, detail.versionId])}
                  staff
                  formatTimestamp={time.format}
                />
                {detail.commercialStatus === 'awaiting_staff_review' ? (
                  <div className="space-y-3 border-t pt-4">
                    <Form {...form}>
                      <div data-testid="electricity-staff-reason-form">
                        <FormField
                          control={form.control}
                          name="reason"
                          render={({ field }) => (
                            <FormItem id="electricity-review-reason">
                              <FormLabel>{copy('reason')}</FormLabel>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  disabled={
                                    reviewLoading ||
                                    form.formState.isSubmitting ||
                                    pending.current ||
                                    !!action ||
                                    uncertain
                                  }
                                />
                              </FormControl>
                              <FormDescription>{formCopy('help')}</FormDescription>
                              <div className="grid">
                                <p
                                  aria-hidden="true"
                                  className="invisible col-start-1 row-start-1 text-sm"
                                >
                                  {formCopy('invalid')}
                                </p>
                                <FormMessage className="col-start-1 row-start-1" />
                              </div>
                            </FormItem>
                          )}
                        />
                      </div>
                    </Form>
                    {form.formState.errors.root && (
                      <Alert variant="destructive">
                        <AlertDescription>{formCopy('validationUnavailable')}</AlertDescription>
                      </Alert>
                    )}
                    {uncertain && (
                      <Alert>
                        <AlertDescription>{formCopy('uncertain')}</AlertDescription>
                        <Button
                          variant="outline"
                          disabled={pending.current || !!action}
                          onClick={() => {
                            const command = captured.current;
                            if (!command || !live(command) || pending.current || action) return;
                            command.attempted = false;
                            command.rejected = false;
                            // The hash, body and idempotency key belong to the original uncertain attempt.
                            command.action = { ...command.action };
                            decorateAction(command, command.action);
                            setDecisionReview(command.review);
                            setAction(command.action);
                          }}
                        >
                          {formCopy('retry')}
                        </Button>
                      </Alert>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={
                          reviewLoading ||
                          form.formState.isSubmitting ||
                          pending.current ||
                          !!action ||
                          uncertain
                        }
                        onClick={() => void choose('approve')}
                      >
                        {copy('approve')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          reviewLoading ||
                          form.formState.isSubmitting ||
                          pending.current ||
                          !!action ||
                          uncertain
                        }
                        onClick={() => void choose('request-changes')}
                      >
                        {copy('request-changes')}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={
                          reviewLoading ||
                          form.formState.isSubmitting ||
                          pending.current ||
                          !!action ||
                          uncertain
                        }
                        onClick={() => void choose('reject')}
                      >
                        {copy('reject')}
                      </Button>
                    </div>
                    {reviewLoading ? <p role="status">{copy('reviewLoading')}</p> : null}
                    {reviewError ? <p role="alert">{copy('reviewError')}</p> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </ListPage>
      {action && decisionReview && captured.current && live(captured.current) ? (
        <TeamActionDialog
          action={action}
          summary={
            <FinancialReviewSummary
              title={copy('reviewTitle')}
              rows={[
                {
                  id: 'customer',
                  label: copy('customer'),
                  value: decisionReview.data.customerName,
                },
                {
                  id: 'period',
                  label: copy('period'),
                  value: periodText(decisionReview.data.periodStart, decisionReview.data.periodEnd),
                },
                {
                  id: 'quantity',
                  label: copy('quantity'),
                  value: `${decisionReview.data.totalKwh} kWh`,
                },
                {
                  id: 'contract',
                  label: copy('reviewContractVersion'),
                  value: numbers.number(decisionReview.data.versionNumber),
                },
                {
                  id: 'invoice',
                  label: copy('reviewInvoiceState'),
                  value: appText(`invoices.state.${decisionReview.data.invoiceState}`, locale),
                },
                {
                  id: 'paid',
                  label: copy('paid'),
                  value: numbers.money(decisionReview.data.paidAmount),
                },
                {
                  id: 'outcome',
                  label: copy('reviewOutcome'),
                  value: copy(`reviewOutcome.${decisionReview.data.outcome}`),
                },
                ...pricingLines(decisionReview.data.pricingSnapshot).map((line, index) => ({
                  id: `product-${index}`,
                  label: `${copy(`product.${line.systemKey}`)} · ${line.quantityKwh} kWh`,
                  value: (
                    <span className="space-y-1 text-sm">
                      <span className="block">
                        {copy('unitPrice')}: {numbers.money(line.unitPriceIrR)}
                      </span>
                      {line.discountIrR ? (
                        <span className="block">
                          {copy('discount')}: {numbers.money(line.discountIrR)}
                        </span>
                      ) : null}
                      <span className="block">
                        {copy('vat')}: {numbers.money(line.vatIrR)}
                      </span>
                      <span className="block">
                        {copy('lineTotal')}: {numbers.money(line.netIrR)}
                      </span>
                    </span>
                  ),
                })),
                ...(decisionReview.data.refundAmount !== '0'
                  ? [
                      {
                        id: 'refund',
                        label: copy('reviewRefund'),
                        value: numbers.money(decisionReview.data.refundAmount),
                      },
                    ]
                  : []),
                ...(decisionReview.data.releasesGiftCode
                  ? [
                      {
                        id: 'gift-code',
                        label: copy('reviewGiftCode'),
                        value: copy('reviewGiftCodeRelease'),
                      },
                    ]
                  : []),
              ]}
              total={{
                label: copy('price'),
                value: numbers.money(decisionReview.data.invoiceTotal),
              }}
              notice={
                <div className="space-y-2">
                  <p>{decisionReview.data.reason || copy('reviewNotice')}</p>
                  {contractTemplate(decisionReview.data.contractSnapshot)?.text ? (
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {contractTemplate(decisionReview.data.contractSnapshot)!.text}
                    </p>
                  ) : null}
                </div>
              }
            />
          }
          onClose={() => {
            const command = captured.current;
            if (command) closeDecision(command, action);
          }}
          onDenied={() => {
            const command = captured.current;
            if (command && live(command) && command.action === action) deny();
          }}
          onPendingChange={(value) => {
            const command = captured.current;
            if (!command || !live(command) || command.action !== action) return;
            if (value) command.attempted = true;
            pending.current = value;
          }}
          onUnconfirmed={() => {
            const command = captured.current;
            if (command && command.action === action) unconfirmed(command);
          }}
          // Projection needs the complete rejection envelope, handled by errorMessages above.
          onValidationError={() => false}
          onSuccess={async (result) => {
            const command = captured.current;
            if (!command || !live(command) || command.action !== action) return;
            if (!confirmedStaffDecision(result, command.review))
              throw new Error('Unconfirmed decision');
            form.reset({ reason: '' });
            refreshQueue();
          }}
        />
      ) : null}
    </section>
  );
}
