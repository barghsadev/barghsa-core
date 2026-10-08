import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { adminText as t } from '@barghsa/i18n/electricity-price-forms';
import { t as appText } from '@barghsa/i18n/electricity-price-forms';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  Button,
  Card,
  CardContent,
  FinancialReviewSummary,
  Input,
  ListPage,
  TextCell,
  DateCell,
  CurrencyCell,
  LinkCell,
  StatusCell,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import {
  type ElectricityPriceAdjustmentCalculation,
  type ElectricityPriceAdjustmentReview,
} from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import {
  percentToBps,
  priceEffectiveFrom,
  parseStaffPriceState,
  boundPriceReview,
  priceCalculationDigest,
  matchedPriceReceipt,
  definitivePriceRejection,
  definitiveMissingPrice,
  type PriceDraft,
  type PriceContractDraft,
  type StaffPriceState,
} from '../lib/electricity-price-form.js';
import type { ElectricityPriceAdjustmentRow } from '../lib/electricity-price-adjustment-row.js';
export { percentToBps } from '../lib/electricity-price-form.js';

interface WorkspaceOwner {
  actor: string | null;
  contractId: string;
  stage: 'picker' | 'prepare' | 'command';
  attempted: boolean;
  uncertain: boolean;
}
interface WorkspaceControl {
  actor: string | null;
  cancelRead: () => void;
  blocked: () => boolean;
}
interface CapturedPriceAction {
  owner: WorkspaceOwner;
  generation: number;
  scope: string;
  action: TeamAction;
  operation: 'publish' | 'finalize' | 'cancel';
  review: ElectricityPriceAdjustmentReview | null;
  adjustment: ElectricityPriceAdjustmentRow | null;
  calculation: ElectricityPriceAdjustmentCalculation;
  calculationSha256: string;
  periodEnd: string;
  rejected: boolean;
}
const emptyDraft: PriceDraft = { percentage: '', effectiveFrom: '', reason: '', basis: '' };
function bpsToPercent(value: string, format: ReturnType<typeof useNumberFormatting>['number']) {
  const signed = BigInt(value);
  const absolute = signed < 0n ? -signed : signed;
  const whole = format(absolute / 100n);
  const fraction = absolute % 100n;
  const decimals = fraction
    ? format(Number(fraction) / 100, { minimumFractionDigits: 2, useGrouping: false }).slice(
        format(0n, { useGrouping: false }).length
      )
    : '';
  return `${signed < 0n ? '-' : ''}${whole}${decimals}%`;
}

export default function AdminElectricityPriceAdjustmentsPage({
  queries,
}: { queries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
  const formCopy = (key: string) => appText(`electricity.priceForm.${key}`, locale);
  const initial =
    typeof window === 'undefined'
      ? ''
      : staffOrderId(new URLSearchParams(window.location.search).get('contractId'));
  const [localContractId, setLocalContractId] = useState(initial);
  const contractId = staffOrderId(
    queries ? (queries.query.filters.contractId ?? '') : localContractId
  ).toLowerCase();
  const scope = JSON.stringify([actor, contractId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const currentActor = useRef(actor);
  currentActor.current = actor;
  const owner = useRef<WorkspaceOwner | null>(null);
  const control = useRef<WorkspaceControl | null>(null);
  const [, updateOwner] = useState(0);
  if (owner.current && owner.current.actor !== actor) owner.current = null;
  const notify = () => {
    if (currentActor.current === actor) updateOwner((value) => value + 1);
  };
  const form: ReturnType<typeof useZodForm<PriceContractDraft>> = useZodForm<PriceContractDraft>(
    async () => {
      const raw = form.getValues('contractId');
      const schemas = await import('../lib/electricity-price-form-schemas.js');
      return currentScope.current === scope && form.getValues('contractId') === raw
        ? schemas.priceContractSchema(formCopy('contractInvalid'))
        : schemas.inactivePriceContractSchema;
    },
    {
      defaultValues: { contractId },
      validationUnavailableMessage: formCopy('validationUnavailable'),
    }
  );
  useEffect(() => {
    form.reset({ contractId });
  }, [scope]);
  const selectionLocked =
    owner.current?.stage === 'command' && (owner.current.attempted || owner.current.uncertain);
  const heldContract = selectionLocked ? owner.current!.contractId : contractId;
  return (
    <section className="min-w-0 space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{copy('title')}</h1>
        <p className="text-muted-foreground">{copy('description')}</p>
      </header>
      <Form {...form}>
        <form
          noValidate
          data-testid="electricity-price-contract-form"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              currentScope.current !== scope ||
              owner.current?.stage === 'picker' ||
              (control.current?.actor === actor && control.current.blocked()) ||
              selectionLocked
            )
              return;
            if (control.current?.actor === actor) control.current.cancelRead();
            const token: WorkspaceOwner = {
              actor,
              contractId,
              stage: 'picker',
              attempted: false,
              uncertain: false,
            };
            owner.current = token;
            notify();
            const raw = form.getValues('contractId');
            void form
              .handleSubmit((draft) => {
                if (
                  currentScope.current !== scope ||
                  owner.current !== token ||
                  form.getValues('contractId') !== raw ||
                  draft.contractId !== raw
                )
                  return;
                const selected = staffOrderId(draft.contractId.trim()).toLowerCase();
                if (queries) queries.setQuery({ filters: { contractId: selected } });
                else setLocalContractId(selected);
              })(event)
              .finally(() => {
                if (owner.current === token) {
                  owner.current = null;
                  notify();
                }
              });
          }}
        >
          <FormField
            control={form.control}
            name="contractId"
            render={({ field }) => (
              <FormItem id="electricity-price-contract" className="min-w-0 flex-1 basis-64">
                <FormLabel>{copy('contractId')}</FormLabel>
                <FormControl>
                  <Input {...field} dir="ltr" disabled={selectionLocked} />
                </FormControl>
                <FormDescription>{formCopy('contractHelp')}</FormDescription>
                <FormMessage reserveSpace />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={selectionLocked || form.formState.isSubmitting}
            aria-busy={form.formState.isSubmitting || undefined}
          >
            {form.formState.isSubmitting ? (
              <span
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
              />
            ) : null}
            {copy('open')}
          </Button>
          {form.formState.errors.root?.validation ? (
            <p role="alert" className="w-full">
              {formCopy('validationUnavailable')}
            </p>
          ) : null}
        </form>
      </Form>
      {heldContract ? (
        <PriceWorkspace
          key={`${actor}-${heldContract}`}
          contractId={heldContract}
          owner={owner}
          control={control}
          notify={notify}
          onWithdraw={() => {
            if (currentActor.current === actor) form.reset({ contractId: '' });
          }}
        />
      ) : null}
    </section>
  );
}

function PriceWorkspace({
  contractId,
  owner,
  control,
  notify,
  onWithdraw,
}: {
  contractId: string;
  owner: RefObject<WorkspaceOwner | null>;
  control: RefObject<WorkspaceControl | null>;
  notify: () => void;
  onWithdraw: () => void;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const timezone = time.status === 'ready' ? time.timezone : null;
  const currentTimezone = useRef(timezone);
  currentTimezone.current = timezone;
  const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
  const formCopy = (key: string) => appText(`electricity.priceForm.${key}`, locale);
  const scope = JSON.stringify([actor, contractId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  const [data, setData] = useState<StaffPriceState | null>(null);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const inspected = data?.adjustments.find((row) => row.adjustmentId === inspectionId) ?? null;
  useEffect(() => {
    if (inspectionId && !inspected)
      setInspectionId((current) => (current === inspectionId ? null : current));
  }, [inspectionId, inspected]);

  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'load' | 'forbidden' | null>(null);
  const accessDenied = useRef(false);
  const reviewGeneration = useRef(0);
  const readGeneration = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const acceptedData = useRef<StaffPriceState | null>(null);
  const preparing = useRef(false);
  const pending = useRef(false);
  const captured = useRef<CapturedPriceAction | null>(null);
  const operationOwner = useRef<WorkspaceOwner | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'load' | 'save' | 'reviewError' | 'forbidden' | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [review, setReview] = useState<ElectricityPriceAdjustmentReview | null>(null);
  const [selectedAdjustment, setSelectedAdjustment] =
    useState<ElectricityPriceAdjustmentRow | null>(null);
  const messages = {
    percentage: formCopy('percentageInvalid'),
    effectiveFrom: formCopy('dateInvalid'),
    reason: formCopy('reasonInvalid'),
    basis: formCopy('basisInvalid'),
  };
  const form: ReturnType<typeof useZodForm<PriceDraft>> = useZodForm<PriceDraft>(
    async () => {
      const raw = JSON.stringify(form.getValues());
      const generation = reviewGeneration.current;
      const schemas = await import('../lib/electricity-price-form-schemas.js');
      return generation === reviewGeneration.current &&
        currentScope.current === scope &&
        JSON.stringify(form.getValues()) === raw &&
        currentTimezone.current === timezone
        ? schemas.priceProposalSchema(messages, timezone)
        : schemas.inactivePriceSchema;
    },
    { defaultValues: emptyDraft, validationUnavailableMessage: formCopy('validationUnavailable') }
  );
  const applyFields = useActionFieldErrors(form, messages, copy('save'));
  const ownedFields = (fields: unknown[]) => {
    const names: Record<string, keyof PriceDraft> = {
      percentageBps: 'percentage',
      effectiveFrom: 'effectiveFrom',
      reason: 'reason',
      contractualBasis: 'basis',
    };
    return (
      fields.length > 0 &&
      fields.every((field) => typeof field === 'string' && Object.hasOwn(names, field)) &&
      applyFields(fields.map((field) => names[field as string]!))
    );
  };
  function writeLocked() {
    return pending.current || captured.current?.owner.attempted === true || uncertain;
  }
  function commandLocked() {
    return (
      preparing.current ||
      pending.current ||
      !!captured.current ||
      !!owner.current ||
      form.isSubmissionPending()
    );
  }
  function invalidate() {
    ++reviewGeneration.current;
    if (owner.current === operationOwner.current) {
      owner.current = null;
      notify();
    }
    operationOwner.current = null;
    captured.current = null;
    preparing.current = false;
    pending.current = false;
    setAction(null);
    setReview(null);
    setSelectedAdjustment(null);
    setSaving(false);
    setUncertain(false);
  }
  function cancelRead() {
    if (!writeLocked()) invalidate();
  }
  const controller: WorkspaceControl = { actor, cancelRead, blocked: writeLocked };
  control.current = controller;
  function withdraw(kind: 'load' | 'forbidden') {
    accessDenied.current = kind === 'forbidden';
    invalidate();
    acceptedData.current = null;
    setData(null);
    form.reset(emptyDraft);
    setError(null);
    setLoadError(kind);
    setLoading(false);
    onWithdraw();
  }
  function refresh() {
    if (writeLocked() || owner.current?.stage === 'picker') return;
    if (preparing.current) invalidate();
    setRevision((value) => value + 1);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++reviewGeneration.current;
      ++readGeneration.current;
      if (owner.current === operationOwner.current) owner.current = null;
      if (control.current?.actor === actor && control.current.cancelRead === cancelRead)
        control.current = null;
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    readAbort.current = abort;
    const request = ++readGeneration.current;
    setLoading(true);
    setLoadError(null);
    const fresh = () =>
      !abort.signal.aborted &&
      mounted.current &&
      currentScope.current === scope &&
      request === readGeneration.current;
    void fetch(
      `/api/staff/electricity/contracts/${encodeURIComponent(contractId)}/price-adjustments`,
      { credentials: 'include', signal: abort.signal }
    )
      .then(async (response) => {
        if (!fresh()) return null;
        if ([401, 403].includes(response.status)) {
          withdraw('forbidden');
          return null;
        }
        if (response.status === 404) {
          withdraw('load');
          return null;
        }
        if (!response.ok) throw new Error('load');
        const value = parseStaffPriceState(await response.json(), contractId);
        if (!value) throw new Error('load');
        return value;
      })
      .then((value) => {
        if (!fresh() || !value) return;
        if (
          acceptedData.current &&
          JSON.stringify(acceptedData.current) !== JSON.stringify(value) &&
          !writeLocked()
        )
          invalidate();
        accessDenied.current = false;
        acceptedData.current = value;
        setData(value);
      })
      .catch(() => {
        if (fresh()) setLoadError('load');
      })
      .finally(() => {
        if (fresh()) setLoading(false);
      });
    return () => abort.abort();
  }, [contractId, revision, scope]);
  function live(command: CapturedPriceAction) {
    return (
      mounted.current &&
      !accessDenied.current &&
      captured.current === command &&
      owner.current === command.owner &&
      command.owner.actor === actor &&
      command.scope === currentScope.current &&
      command.generation === reviewGeneration.current
    );
  }
  function unconfirmed(command: CapturedPriceAction) {
    if (!live(command)) return;
    command.owner.uncertain = true;
    pending.current = false;
    setUncertain(true);
    setAction(null);
    setReview(null);
    setSelectedAdjustment(null);
    notify();
  }
  function close(command: CapturedPriceAction, ownedAction: TeamAction) {
    if (!live(command) || command.action !== ownedAction || pending.current) return;
    if (command.owner.uncertain || (command.owner.attempted && !command.rejected))
      unconfirmed(command);
    else invalidate();
  }
  function decorate(command: CapturedPriceAction, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        'VALIDATION:INPUT_INVALID',
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (value: unknown) => {
          if (!live(command) || command.action !== ownedAction) return copy('save');
          if (definitiveMissingPrice(value)) {
            withdraw('load');
            return copy('load');
          }
          if (definitivePriceRejection(value)) {
            command.rejected = true;
            const fields = (value as { error: { fields?: unknown[] } }).error.fields;
            if (
              !command.owner.uncertain &&
              command.operation === 'publish' &&
              code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(fields) &&
              ownedFields(fields)
            ) {
              pending.current = false;
              close(command, ownedAction);
            }
          }
          return code.startsWith('CONFLICT:') ? copy('conflict') : copy('save');
        },
      ])
    );
  }
  function capture(command: CapturedPriceAction) {
    command.owner.stage = 'command';
    captured.current = command;
    decorate(command, command.action);
    setAction(command.action);
    setReview(command.review);
    setSelectedAdjustment(command.adjustment);
    notify();
  }
  function retryCaptured() {
    const command = captured.current;
    if (
      currentScope.current !== scope ||
      !command ||
      !live(command) ||
      !command.owner.uncertain ||
      pending.current
    )
      return;
    const next = { ...command.action };
    command.action = next;
    decorate(command, next);
    setAction(next);
    setReview(command.review);
    setSelectedAdjustment(command.adjustment);
  }
  function propose() {
    if (
      !data ||
      !timezone ||
      !data.canPropose ||
      data.adjustments.some((row) => row.status === 'proposed') ||
      loading ||
      loadError ||
      accessDenied.current ||
      commandLocked() ||
      currentScope.current !== scope
    )
      return;
    setInspectionId(null);
    const source = data;
    const raw = JSON.stringify(form.getValues());
    const generation = ++reviewGeneration.current;
    const token: WorkspaceOwner = {
      actor,
      contractId,
      stage: 'prepare',
      attempted: false,
      uncertain: false,
    };
    owner.current = token;
    operationOwner.current = token;
    preparing.current = true;
    setSaving(true);
    setError(null);
    notify();
    const authorized = () =>
      mounted.current &&
      !accessDenied.current &&
      currentScope.current === scope &&
      generation === reviewGeneration.current &&
      owner.current === token;
    const fresh = () =>
      authorized() &&
      raw === JSON.stringify(form.getValues()) &&
      currentTimezone.current === timezone;
    void form
      .handleSubmit(async (draft) => {
        if (!fresh() || JSON.stringify(draft) !== raw) return;
        const effectiveFrom = priceEffectiveFrom(draft.effectiveFrom, timezone);
        const percentageBps = percentToBps(draft.percentage);
        if (!effectiveFrom || !percentageBps) return;
        const proposal = {
          expectedVersionId: source.versionId,
          effectiveFrom,
          percentageBps,
          reason: draft.reason.trim(),
          contractualBasis: draft.basis.trim(),
        };
        try {
          const response = await fetch(
            `/api/staff/electricity/contracts/${encodeURIComponent(contractId)}/price-adjustments/review`,
            {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(proposal),
            }
          );
          if (!authorized()) return;
          if ([401, 403].includes(response.status)) {
            withdraw('forbidden');
            return;
          }
          if (response.status === 404) {
            withdraw('load');
            return;
          }
          const value: unknown = await response.json().catch(() => null);
          if (!fresh()) return;
          if (response.status === 400 && definitivePriceRejection(value)) {
            const fields = (value as { error: { fields?: unknown[] } }).error.fields;
            if (Array.isArray(fields) && ownedFields(fields)) return;
          }
          if (!response.ok) throw new Error('review');
          const financialReview = boundPriceReview(value, source, proposal);
          if (!financialReview) throw new Error('review');
          const calculationSha256 = await priceCalculationDigest(financialReview.data.calculation);
          if (!fresh()) return;
          capture({
            owner: token,
            generation,
            scope,
            operation: 'publish',
            review: financialReview,
            adjustment: null,
            calculation: financialReview.data.calculation,
            calculationSha256,
            periodEnd: source.periodEnd,
            rejected: false,
            action: {
              title: copy('publish'),
              description: copy('publishConfirm'),
              path: `/api/staff/electricity/contracts/${encodeURIComponent(contractId)}/price-adjustments`,
              method: 'POST',
              successStatus: 201,
              body: {
                ...proposal,
                expectedReviewHash: financialReview.hash,
                idempotencyKey: crypto.randomUUID(),
              },
              conflictMessage: copy('conflict'),
              forbiddenMessage: copy('forbidden'),
            },
          });
        } catch {
          if (fresh()) setError('reviewError');
        }
      })()
      .finally(() => {
        if (generation === reviewGeneration.current && mounted.current) {
          preparing.current = false;
          setSaving(false);
          if (!captured.current && owner.current === token) {
            owner.current = null;
            operationOwner.current = null;
            notify();
          }
        }
      });
  }
  function confirm(adjustment: ElectricityPriceAdjustmentRow, operation: 'finalize' | 'cancel') {
    if (
      currentScope.current !== scope ||
      commandLocked() ||
      !data ||
      loading ||
      loadError ||
      accessDenied.current ||
      adjustment.status !== 'proposed' ||
      !(operation === 'finalize' ? data.canFinalize : data.canCancel) ||
      !data.adjustments.some((row) => row === adjustment)
    )
      return;
    setInspectionId(null);
    const token: WorkspaceOwner = {
      actor,
      contractId,
      stage: 'command',
      attempted: false,
      uncertain: false,
    };
    owner.current = token;
    operationOwner.current = token;
    const generation = ++reviewGeneration.current;
    capture({
      owner: token,
      generation,
      scope,
      operation,
      review: null,
      adjustment,
      calculation: adjustment.calculation,
      calculationSha256: adjustment.calculationSha256,
      periodEnd: adjustment.periodEnd,
      rejected: false,
      action: {
        title: copy(operation),
        description: copy(`${operation}Confirm`),
        path: `/api/staff/electricity/price-adjustments/${encodeURIComponent(adjustment.adjustmentId)}/${operation}`,
        method: 'POST',
        successStatus: 201,
        body: {
          idempotencyKey: crypto.randomUUID(),
          ...(operation === 'finalize'
            ? { expectedCalculationSha256: adjustment.calculationSha256 }
            : {}),
        },
        conflictMessage: copy('conflict'),
        forbiddenMessage: copy('forbidden'),
      },
    });
  }
  const command = captured.current;
  const frozen = !!captured.current || pending.current || uncertain;
  const proposed =
    data?.adjustments.some((adjustment) => adjustment.status === 'proposed') ?? false;
  return (
    <ListPage role="region" aria-label={copy('listTitle')}>
      {time.notice}
      <ListPage.Toolbar>
        <Button
          variant="outline"
          disabled={loading || writeLocked() || owner.current?.stage === 'picker'}
          onClick={refresh}
        >
          {copy('refresh')}
        </Button>
      </ListPage.Toolbar>
      {loadError ? (
        <div role="alert" className="space-y-2">
          <p>{copy(loadError)}</p>
          {loadError !== 'forbidden' && (
            <Button
              type="button"
              variant="outline"
              disabled={writeLocked() || owner.current?.stage === 'picker'}
              onClick={refresh}
            >
              {copy('retry')}
            </Button>
          )}
        </div>
      ) : null}
      {loading ? <p role="status">{copy('loading')}</p> : null}
      {error ? <p role="alert">{copy(error)}</p> : null}
      {uncertain ? (
        <div role="alert" className="space-y-2">
          <p>{formCopy('uncertain')}</p>
          <Button
            type="button"
            variant="outline"
            disabled={pending.current || !!action}
            onClick={retryCaptured}
          >
            {formCopy('retryCaptured')}
          </Button>
        </div>
      ) : null}
      {data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {copy('termEnds')}: {time.format(data.periodEnd)}
            </p>
          </div>
          {!data.canPropose && !proposed ? (
            <p role="status">{copy(data.blockedByIncrease ? 'waitForIncrease' : 'notEligible')}</p>
          ) : null}
          {data.canPropose && !proposed ? (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <h2 className="font-semibold">{copy('newProposal')}</h2>
                <Form {...form}>
                  <form
                    noValidate
                    data-testid="electricity-price-proposal-form"
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      propose();
                    }}
                  >
                    {(
                      [
                        {
                          name: 'percentage',
                          id: 'price-percent',
                          label: 'percentage',
                          help: copy('percentageHelp'),
                        },
                        {
                          name: 'effectiveFrom',
                          id: 'price-effective',
                          label: 'effective',
                          help: (
                            <>
                              {formCopy('dateHelp')} {copy('dateZone')}:{' '}
                              <bdi dir="ltr">{timezone ?? '—'}</bdi>
                            </>
                          ),
                        },
                        {
                          name: 'reason',
                          id: 'price-reason',
                          label: 'reason',
                          help: formCopy('reasonHelp'),
                        },
                        {
                          name: 'basis',
                          id: 'price-basis',
                          label: 'basis',
                          help: formCopy('basisHelp'),
                        },
                      ] as const
                    ).map(({ name, id, label, help }) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem id={id}>
                            <FormLabel>{copy(label)}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type={name === 'effectiveFrom' ? 'datetime-local' : 'text'}
                                inputMode={name === 'percentage' ? 'decimal' : undefined}
                                disabled={frozen || (name === 'effectiveFrom' && !timezone)}
                              />
                            </FormControl>
                            <FormDescription>{help}</FormDescription>
                            <FormMessage reserveSpace />
                          </FormItem>
                        )}
                      />
                    ))}
                    <div className="space-y-2 sm:col-span-2">
                      <p className="text-sm text-muted-foreground">{formCopy('preserved')}</p>
                      <Button
                        type="submit"
                        disabled={
                          !timezone ||
                          saving ||
                          loading ||
                          !!loadError ||
                          frozen ||
                          owner.current?.stage === 'picker'
                        }
                        aria-busy={saving || undefined}
                      >
                        {saving ? (
                          <span
                            aria-hidden="true"
                            className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                          />
                        ) : null}
                        {copy('reviewProposal')}
                      </Button>
                      {saving ? <p role="status">{copy('reviewLoading')}</p> : null}
                      {form.formState.errors.root?.validation ? (
                        <p role="alert">{formCopy('validationUnavailable')}</p>
                      ) : null}
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          ) : proposed ? (
            <p className="text-sm">{copy('resolveProposal')}</p>
          ) : null}
          <ListPage.Content
            loading={loading}
            error={!!loadError}
            empty={!data.adjustments.length}
            retainContent={!!data.adjustments.length}
            emptyView={<p>{copy('empty')}</p>}
            loadingView={null}
            errorView={null}
          >
            {data.adjustments.length > 0 ? (
              <OperationalQueueTable
                locale={locale}
                rows={data.adjustments.map((adjustment) => ({
                  id: adjustment.adjustmentId,
                  adjustment,
                }))}
                caption={copy('directory')}
                scrollLabel={copy('directory')}
                nameHeader={copy('adjustment')}
                renderName={({ adjustment }) => (
                  <>
                    <TextCell value={copy('adjustment')} />
                    <span className="block font-mono text-xs font-normal">
                      <TextCell value={adjustment.adjustmentId} />
                    </span>
                  </>
                )}
                fields={[
                  {
                    id: 'status',
                    label: copy('statusLabel'),
                    render: ({ adjustment }) => (
                      <StatusCell
                        state={adjustment.status}
                        label={copy(`status.${adjustment.status}`)}
                      />
                    ),
                  },
                  {
                    id: 'percentage',
                    label: copy('percentage'),
                    render: ({ adjustment }) => (
                      <div className="space-y-1">
                        <TextCell value={bpsToPercent(adjustment.percentageBps, numbers.number)} />
                        <p className="text-xs text-muted-foreground">
                          {copy(adjustment.calculation.quote.kind)}
                        </p>
                      </div>
                    ),
                  },
                  {
                    id: 'effective',
                    label: copy('effective'),
                    render: ({ adjustment }) => (
                      <DateCell
                        value={adjustment.effectiveFrom}
                        format={(value) => time.format(value)}
                      />
                    ),
                  },
                  {
                    id: 'end',
                    label: copy('termEnds'),
                    render: ({ adjustment }) => (
                      <DateCell
                        value={adjustment.periodEnd}
                        format={(value) => time.format(value)}
                      />
                    ),
                  },
                  {
                    id: 'history',
                    label: copy('history'),
                    render: ({ adjustment }) => (
                      <div className="space-y-2">
                        <p>
                          {copy('proposedAt')}:{' '}
                          <DateCell
                            value={adjustment.proposedAt}
                            format={(value) => time.format(value)}
                          />
                        </p>
                        {adjustment.finalizedAt ? (
                          <p>
                            {copy('finalizedAt')}:{' '}
                            <DateCell
                              value={adjustment.finalizedAt}
                              format={(value) => time.format(value)}
                            />
                          </p>
                        ) : null}
                        {adjustment.cancelledAt ? (
                          <p>
                            {copy('cancelledAt')}:{' '}
                            <DateCell
                              value={adjustment.cancelledAt}
                              format={(value) => time.format(value)}
                            />
                          </p>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    id: 'terms',
                    label: copy('terms'),
                    render: ({ adjustment }) => (
                      <div className="max-w-sm space-y-2">
                        <div>
                          <p className="font-medium">{copy('reason')}</p>
                          <TextCell value={adjustment.reason} />
                        </div>
                        <div>
                          <p className="font-medium">{copy('basis')}</p>
                          <TextCell value={adjustment.contractualBasis} />
                        </div>
                      </div>
                    ),
                  },
                  {
                    id: 'old',
                    label: copy('oldFuture'),
                    render: ({ adjustment }) => (
                      <CurrencyCell
                        amount={adjustment.calculation.quote.oldFutureIrR}
                        format={numbers.money}
                      />
                    ),
                  },
                  {
                    id: 'new',
                    label: copy('newFuture'),
                    render: ({ adjustment }) => (
                      <CurrencyCell
                        amount={adjustment.calculation.quote.newFutureIrR}
                        format={numbers.money}
                      />
                    ),
                  },
                  {
                    id: 'amount',
                    label: copy('amount'),
                    render: ({ adjustment }) => (
                      <CurrencyCell
                        amount={adjustment.adjustmentAmountIrR}
                        format={numbers.money}
                      />
                    ),
                  },
                  {
                    id: 'invoice',
                    label: copy('invoice'),
                    render: ({ adjustment }) =>
                      adjustment.adjustmentInvoiceId ? (
                        <div className="space-y-1">
                          <div>
                            <StatusCell
                              state={adjustment.adjustmentInvoiceState ?? ''}
                              label={
                                appText(
                                  `invoices.state.${adjustment.adjustmentInvoiceState}`,
                                  locale
                                ) === `invoices.state.${adjustment.adjustmentInvoiceState}`
                                  ? (adjustment.adjustmentInvoiceState ?? '—')
                                  : appText(
                                      `invoices.state.${adjustment.adjustmentInvoiceState}`,
                                      locale
                                    )
                              }
                            />
                          </div>
                          <LinkCell
                            href={`/admin/invoices?invoiceId=${encodeURIComponent(adjustment.adjustmentInvoiceId)}`}
                          >
                            {adjustment.adjustmentInvoiceId}
                          </LinkCell>
                          {adjustment.status === 'finalized' &&
                          BigInt(adjustment.adjustmentAmountIrR) < 0n ? (
                            <div className="pt-1">
                              <LinkCell
                                href={`/admin/invoices?invoiceId=${encodeURIComponent(adjustment.calculation.originalInvoiceId)}`}
                              >
                                {copy('refundCredit')}
                              </LinkCell>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <TextCell value={copy('noInvoice')} />
                      ),
                  },
                ]}
                actionHeader={copy('actions')}
                renderActions={({ adjustment }) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      data-price-inspection={adjustment.adjustmentId}
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={loading || !!loadError || commandLocked()}
                      onClick={() => {
                        if (
                          currentScope.current !== scope ||
                          loading ||
                          loadError ||
                          accessDenied.current ||
                          commandLocked() ||
                          !data.adjustments.some((row) => row === adjustment)
                        )
                          return;
                        setInspectionId(adjustment.adjustmentId);
                      }}
                    >
                      {copy('viewCalculation')}
                      <span className="sr-only">: {adjustment.adjustmentId}</span>
                    </Button>
                    {adjustment.status === 'proposed' ? (
                      <>
                        {data.canFinalize ? (
                          <Button
                            className="min-h-11"
                            disabled={loading || !!loadError || commandLocked()}
                            onClick={() => confirm(adjustment, 'finalize')}
                          >
                            {copy('finalize')}
                          </Button>
                        ) : (
                          <p>{copy('finalizePermission')}</p>
                        )}
                        {data.canCancel ? (
                          <Button
                            variant="outline"
                            className="min-h-11"
                            disabled={loading || !!loadError || commandLocked()}
                            onClick={() => confirm(adjustment, 'cancel')}
                          >
                            {copy('cancel')}
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )}
                cardHeading="h2"
                loading={loading}
                emptyMessage={copy('empty')}
                tableClassName="min-w-[96rem]"
              />
            ) : null}
          </ListPage.Content>
        </div>
      ) : null}
      {inspected && !action ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open)
              setInspectionId((current) => (current === inspected.adjustmentId ? null : current));
          }}
        >
          <DialogContent
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
            className="max-h-[85svh] overflow-y-auto sm:max-w-3xl"
            closeLabel={copy('closeCalculation')}
            finalFocus={() =>
              Array.from(
                document.querySelectorAll<HTMLElement>(
                  `[data-price-inspection="${inspected.adjustmentId}"]`
                )
              ).find((button) => button.getClientRects().length > 0) ?? null
            }
          >
            <DialogHeader>
              <DialogTitle>{copy('viewCalculation')}</DialogTitle>
              <DialogDescription>{copy('calculationDescription')}</DialogDescription>
            </DialogHeader>
            <p className="font-mono text-xs">
              <TextCell value={inspected.adjustmentId} />
            </p>
            <PriceAdjustmentFinancialReview
              calculation={inspected.calculation}
              profileId={data!.profileId}
              {...(inspected.calculation.quote.components[0]
                ? { periodStart: inspected.calculation.quote.components[0].periodStart }
                : {})}
              periodEnd={inspected.periodEnd}
              locale={locale}
              formatTime={(value) => time.format(value)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {action && command && live(command) ? (
        <TeamActionDialog
          action={action}
          summary={
            review ? (
              <PriceAdjustmentFinancialReview
                formatTime={(value) => time.format(value)}
                calculation={review.data.calculation}
                profileId={review.data.profileId}
                periodStart={review.data.periodStart}
                periodEnd={review.data.periodEnd}
                locale={locale}
              />
            ) : selectedAdjustment && data ? (
              <PriceAdjustmentFinancialReview
                formatTime={(value) => time.format(value)}
                calculation={selectedAdjustment.calculation}
                profileId={data.profileId}
                periodEnd={data.periodEnd}
                locale={locale}
              />
            ) : null
          }
          onClose={() => close(command, action)}
          onValidationError={() => false}
          onDenied={() => {
            if (live(command) && command.action === action) withdraw('forbidden');
          }}
          onUnconfirmed={() => {
            if (live(command) && command.action === action) unconfirmed(command);
          }}
          onPendingChange={(value) => {
            if (!live(command) || command.action !== action) return;
            pending.current = value;
            if (value) {
              ++readGeneration.current;
              readAbort.current?.abort();
              setLoading(false);
              command.owner.attempted = true;
            }
            notify();
          }}
          onSuccess={async (value) => {
            if (!live(command) || command.action !== action) return;
            if (
              !matchedPriceReceipt(value, {
                operation: command.operation,
                contractId,
                adjustmentId: command.adjustment?.adjustmentId,
                periodEnd: command.periodEnd,
                calculation: command.calculation,
                calculationSha256: command.calculationSha256,
              })
            ) {
              unconfirmed(command);
              return;
            }
            const published = command.operation === 'publish';
            invalidate();
            if (published) form.reset(emptyDraft);
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </ListPage>
  );
}

function PriceAdjustmentFinancialReview({
  calculation,
  profileId,
  periodStart,
  periodEnd,
  locale,
  formatTime,
}: {
  formatTime: (value: string) => string;
  calculation: ElectricityPriceAdjustmentCalculation;
  profileId: string;
  periodStart?: string;
  periodEnd: string;
  locale: 'en' | 'fa';
}) {
  const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const money = numbers.money;
  const { quote } = calculation;
  return (
    <>
      <FinancialReviewSummary
        title={copy('reviewTitle')}
        rows={[
          { id: 'contract', label: copy('contractId'), value: calculation.contractId },
          { id: 'profile', label: copy('profileId'), value: profileId },
          { id: 'invoice', label: copy('originalInvoice'), value: calculation.originalInvoiceId },
          { id: 'version', label: copy('versionId'), value: calculation.versionId },
          ...(periodStart
            ? [
                {
                  id: 'start',
                  label: copy('termStarts'),
                  value: formatTime(periodStart),
                },
              ]
            : []),
          { id: 'end', label: copy('termEnds'), value: formatTime(periodEnd) },
          {
            id: 'effective',
            label: copy('effective'),
            value: formatTime(quote.effectiveFrom),
          },
          {
            id: 'percentage',
            label: copy('percentage'),
            value: bpsToPercent(quote.percentageBps, numbers.number),
          },
          { id: 'old', label: copy('oldFuture'), value: money(quote.oldFutureIrR) },
          { id: 'new', label: copy('newFuture'), value: money(quote.newFutureIrR) },
          ...quote.components.map((component, index) => ({
            id: `component-${index}`,
            label: `${copy('basisComponent')} ${index + 1}`,
            value: (
              <div className="space-y-2">
                <p className="break-all font-mono text-xs">
                  <bdi dir="ltr">{component.invoiceId}</bdi>
                </p>
                <p>{copy(`source.${component.source}`)}</p>
                <p>
                  {copy('basisPrice')}: <CurrencyCell amount={component.basisIrR} format={money} />
                </p>
                <p>
                  {copy('oldFuture')}:{' '}
                  <CurrencyCell amount={component.oldFutureIrR} format={money} />
                </p>
                <p>
                  {copy('newFuture')}:{' '}
                  <CurrencyCell amount={component.newFutureIrR} format={money} />
                </p>
                <p>
                  {copy('amount')}: <CurrencyCell amount={component.changeIrR} format={money} />
                </p>
                <p>
                  {copy('termStarts')}:{' '}
                  <DateCell
                    value={component.periodStart}
                    format={(value) => formatTime(String(value))}
                  />
                </p>
                <p>
                  {copy('termEnds')}:{' '}
                  <DateCell
                    value={component.periodEnd}
                    format={(value) => formatTime(String(value))}
                  />
                </p>
                <p>
                  {copy('effective')}:{' '}
                  <DateCell
                    value={component.eligibleFrom}
                    format={(value) => formatTime(String(value))}
                  />
                </p>
              </div>
            ),
          })),
        ]}
        total={{ label: copy('amount'), value: money(quote.amountIrR) }}
        notice={`${copy('reason')}: ${calculation.reason} · ${copy('basis')}: ${calculation.contractualBasis}`}
      />
      <OrderWalletBalance
        profileId={profileId}
        total={quote.kind === 'charge' ? quote.amountIrR : '0'}
        scopeKey={JSON.stringify([calculation.contractId, calculation.versionId, quote])}
        staff
      />
    </>
  );
}
