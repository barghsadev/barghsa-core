import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { OrderWalletBalance } from './OrderWalletBalance.js';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  FinancialReviewSummary,
  Input,
  Textarea,
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
  type FieldPath,
} from '@barghsa/ui/form';
import { tSolar } from '@barghsa/i18n/solar';
import { tSolarContract } from '@barghsa/i18n/solar-contract';
import { contractText } from '@barghsa/i18n/contracts';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import {
  emptySolarContract,
  emptySolarInvoice,
  solarContractBody,
  solarContractOptions,
  solarContractFields,
  solarContractReceipt,
  solarContractRejection,
  matchedSolarContractReview,
  type SolarContractDraft,
  type SolarContractOptions,
  type SolarContractReview,
} from '../lib/solar-contract-form.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

export interface SolarContractCoordination {
  blocked: () => boolean;
  acquire: (owner: object) => boolean;
  release: (owner: object) => void;
}
interface Command {
  action: TeamAction;
  review: SolarContractReview;
  draft: SolarContractDraft;
  generation: number;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
}
export function SolarContractForm(props: Parameters<typeof OwnedSolarContractForm>[0]) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return <OwnedSolarContractForm key={JSON.stringify([actor, profileRevision])} {...props} />;
}
function OwnedSolarContractForm({
  requestId,
  profileId,
  scopeKey: sourceScope = '',
  coordination,
  onDenied,
  onCreated,
}: {
  requestId: string;
  profileId: string;
  scopeKey?: string;
  coordination?: SolarContractCoordination;
  onDenied?: () => void;
  onCreated: (contractId: string) => void;
}) {
  const client = useQueryClient();
  const reader = useId();
  const profileRevision = useProfileContextRevision();
  const readSequence = useRef(0);
  const locale = useLocale(),
    actor = useAccountUser();
  const copy = (key: string) => tSolar(key, locale);
  const fieldCopy = (key: string) => tSolarContract(key, locale);
  const contractCopy = (key: string) => contractText(key, locale);
  const scopeKey = JSON.stringify([actor, requestId, profileId, sourceScope]);
  const scope = useRef(scopeKey),
    generation = useRef(0),
    owner = useRef<object>({});
  if (scope.current !== scopeKey) {
    scope.current = scopeKey;
    ++generation.current;
  }
  const callbacks = useRef({ onCreated, onDenied, coordination });
  callbacks.current = { onCreated, onDenied, coordination };
  const [options, setOptions] = useState<SolarContractOptions | null>(null);
  const optionsRef = useRef<SolarContractOptions | null>(null);
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [preparing, setPreparing] = useState(false),
    preparingRef = useRef(false);
  const [error, setError] = useState<'options' | 'review' | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const command = useRef<Command | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [pending, setPending] = useState(false),
    pendingRef = useRef(false);
  const shown = acceptedScope === scopeKey;
  const messages = {
    source: fieldCopy('sourceInvalid'),
    title: fieldCopy('titleInvalid'),
    text: fieldCopy('textInvalid'),
    changeDescription: fieldCopy('reasonInvalid'),
    valueKind: fieldCopy('valueInvalid'),
    fixedAmount: fieldCopy('amountInvalid'),
    variableDescription: fieldCopy('variableInvalid'),
    invoiceLines: fieldCopy('lineInvalid'),
    description: fieldCopy('descriptionInvalid'),
    quantity: fieldCopy('quantityInvalid'),
    unitPrice: fieldCopy('priceInvalid'),
    vatRate: fieldCopy('vatInvalid'),
    isTaxable: fieldCopy('taxableInvalid'),
  };
  const form = useZodForm<SolarContractDraft>(
    async () => {
      const token = generation.current,
        capturedScope = scope.current;
      const schemas = await import('../lib/solar-contract-form-schemas.js');
      return token === generation.current && capturedScope === scope.current
        ? schemas.solarContractSchema(messages, optionsRef.current)
        : schemas.inactiveSolarContractSchema;
    },
    {
      defaultValues: emptySolarContract(),
      validationUnavailableMessage: fieldCopy('validationUnavailable'),
    }
  );
  const names: Partial<Record<FieldPath<SolarContractDraft>, string>> = {
    source: messages.source,
    title: messages.title,
    text: messages.text,
    changeDescription: messages.changeDescription,
    valueKind: messages.valueKind,
    fixedAmount: messages.fixedAmount,
    variableDescription: messages.variableDescription,
    invoiceLines: messages.invoiceLines,
  };
  const draft = form.watch();
  for (let index = 0; index < draft.invoiceLines.length; index++)
    for (const leaf of ['description', 'quantity', 'unitPrice', 'vatRate', 'isTaxable'] as const)
      names[`invoiceLines.${index}.${leaf}`] = messages[leaf];
  const showFields = useActionFieldErrors(form, names, copy('solarContractError'));
  const release = () => callbacks.current.coordination?.release(owner.current);
  function withdraw() {
    ++generation.current;
    command.current = null;
    optionsRef.current = null;
    setOptions(null);
    setAcceptedScope(null);
    setAction(null);
    setUnconfirmed(false);
    preparingRef.current = false;
    pendingRef.current = false;
    setPreparing(false);
    setPending(false);
    form.reset(emptySolarContract());
    release();
    callbacks.current.onDenied?.();
  }
  useEffect(() => {
    optionsRef.current = null;
    setOptions(null);
    setAcceptedScope(null);
    command.current = null;
    setAction(null);
    setUnconfirmed(false);
    setError(null);
    preparingRef.current = false;
    pendingRef.current = false;
    setPreparing(false);
    setPending(false);
    form.reset(emptySolarContract());
    release();
    return () => {
      ++generation.current;
      release();
    };
  }, [scopeKey]);
  useEffect(() => {
    if (!actor || command.current) return;
    const controller = new AbortController(),
      token = generation.current;
    setError(null);
    const key = queryKeys.solar.detail(
      { context: 'staff', ownerId: profileId, accountId: actor, revision: profileRevision },
      JSON.stringify([requestId, 'contract-options', reader, ++readSequence.current])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    void client
      .fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: async ({ signal }) => {
          const response = await fetch(
            `/api/admin/solar/requests/${encodeURIComponent(requestId)}/contract-options`,
            { credentials: 'include', signal }
          );
          return {
            ok: response.ok,
            status: response.status,
            data: response.ok ? ((await response.json()) as unknown) : null,
          };
        },
      })
      .then(async (response) => {
        if (controller.signal.aborted || token !== generation.current || scope.current !== scopeKey)
          return;
        if ([401, 403, 404].includes(response.status)) {
          withdraw();
          return;
        }
        if (!response.ok) throw new Error('options');
        const value: unknown = response.data;
        if (controller.signal.aborted || token !== generation.current || scope.current !== scopeKey)
          return;
        const parsed = solarContractOptions(value);
        if (!parsed) throw new Error('options');
        optionsRef.current = parsed;
        setOptions(parsed);
        setAcceptedScope(scopeKey);
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          token === generation.current &&
          scope.current === scopeKey
        )
          setError('options');
      });
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [scopeKey, revision, client, profileRevision, reader]);
  const current = (captured: Command) =>
    scope.current === scopeKey &&
    captured === command.current &&
    captured.generation === generation.current;
  function ownedErrors(value: unknown, capturedDraft: SolarContractDraft) {
    const rejection = solarContractRejection(value);
    const mapped =
      rejection?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
      Array.isArray(rejection.fields)
        ? solarContractFields(rejection.fields, capturedDraft)
        : null;
    return !!mapped && showFields(mapped);
  }
  function decorate(captured: Command): TeamAction {
    const mapped = (value: unknown) => {
      if (!current(captured)) return copy('solarContractError');
      const rejection = solarContractRejection(value);
      if (rejection?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
        withdraw();
        return copy('solarContractError');
      }
      if (rejection && !captured.uncertain) {
        captured.rejected = true;
        if (ownedErrors(value, captured.draft)) close(captured);
      }
      return copy('solarContractError');
    };
    return {
      ...captured.action,
      errorMessages: Object.fromEntries(
        [
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          'VALIDATION:INPUT_INVALID',
          ErrorCodes.CONFLICT_STATE.code,
          ErrorCodes.CONFLICT_VERSION.code,
          ErrorCodes.NOT_FOUND_RESOURCE.code,
        ].map((code) => [code, mapped])
      ),
      successStatus: 200,
    };
  }
  function close(captured: Command) {
    if (!current(captured)) return;
    setAction(null);
    pendingRef.current = false;
    setPending(false);
    if (captured.attempted && (!captured.rejected || captured.uncertain)) {
      captured.uncertain = true;
      setUnconfirmed(true);
    } else {
      command.current = null;
      setUnconfirmed(false);
      release();
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      event.target !== event.currentTarget ||
      scope.current !== scopeKey ||
      !actor ||
      !shown ||
      !optionsRef.current ||
      command.current ||
      preparingRef.current ||
      form.isSubmissionPending() ||
      callbacks.current.coordination?.blocked()
    )
      return;
    if (callbacks.current.coordination && !callbacks.current.coordination.acquire(owner.current))
      return;
    preparingRef.current = true;
    setPreparing(true);
    setError(null);
    const token = generation.current,
      raw = JSON.stringify(form.getValues()),
      capturedOptions = optionsRef.current;
    try {
      await form.handleSubmit(async (values) => {
        if (
          scope.current !== scopeKey ||
          token !== generation.current ||
          raw !== JSON.stringify(form.getValues()) ||
          capturedOptions !== optionsRef.current
        )
          return;
        const body = solarContractBody(values, profileId, crypto.randomUUID());
        const path = `/api/admin/solar/requests/${encodeURIComponent(requestId)}/create-contract`;
        const response = await fetch(path + '/review', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        const value: unknown = await response.json().catch(() => null);
        if (scope.current !== scopeKey || token !== generation.current) return;
        if ([401, 403, 404].includes(response.status)) {
          withdraw();
          return;
        }
        if (raw !== JSON.stringify(form.getValues()) || capturedOptions !== optionsRef.current)
          return;
        if (response.status !== 200) {
          if (response.status === 400 && ownedErrors(value, values)) return;
          throw new Error('review');
        }
        const review = matchedSolarContractReview(value, requestId, body, capturedOptions);
        if (!review) throw new Error('review');
        const captured: Command = {
          action: {
            title: copy('solarCreateContract'),
            description: body.title,
            path,
            method: 'POST',
            body: { ...body, expectedReviewHash: review.hash },
            successStatus: 200,
          },
          review,
          draft: JSON.parse(raw) as SolarContractDraft,
          generation: token,
          attempted: false,
          uncertain: false,
          rejected: false,
        };
        command.current = captured;
        setAction(decorate(captured));
      })();
    } catch {
      if (
        scope.current === scopeKey &&
        token === generation.current &&
        raw === JSON.stringify(form.getValues()) &&
        capturedOptions === optionsRef.current
      )
        setError('review');
    } finally {
      if (scope.current === scopeKey && token === generation.current) {
        preparingRef.current = false;
        setPreparing(false);
        if (!command.current) release();
      }
    }
  }
  const captured = command.current,
    review = captured?.review;
  const locked = !!captured;
  const renderField = (
    name: FieldPath<SolarContractDraft>,
    id: string,
    label: string,
    help: string,
    kind: 'input' | 'textarea' | 'checkbox' = 'input'
  ) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem id={id}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {kind === 'checkbox' ? (
              <input
                type="checkbox"
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                checked={field.value === true}
                disabled={locked}
                onChange={(event) => field.onChange(event.target.checked)}
              />
            ) : kind === 'textarea' ? (
              <Textarea
                {...field}
                value={String(field.value ?? '')}
                disabled={locked}
                rows={name === 'text' ? 8 : 3}
              />
            ) : (
              <Input
                {...field}
                value={String(field.value ?? '')}
                disabled={locked}
                inputMode={
                  name.includes('Price') ||
                  name === 'fixedAmount' ||
                  name.endsWith('quantity') ||
                  name.endsWith('vatRate')
                    ? 'numeric'
                    : 'text'
                }
              />
            )}
          </FormControl>
          <FormDescription>{help}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <Form {...form}>
      <form
        data-testid="solar-contract-form"
        className="space-y-3 rounded-md border p-4"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <h3 className="font-semibold">{copy('solarCreateContract')}</h3>
        {!shown && !error && <p role="status">{copy('loading')}</p>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{copy('solarContractError')}</AlertDescription>
          </Alert>
        )}
        {error === 'options' && (
          <Button
            type="button"
            data-testid="solar-contract-options-retry"
            disabled={preparing || locked}
            onClick={() => {
              if (scope.current === scopeKey && !command.current && !preparingRef.current)
                setRevision((value) => value + 1);
            }}
          >
            {fieldCopy('reloadOptions')}
          </Button>
        )}
        {shown && options && (
          <>
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem id="solar-contract-source">
                  <FormLabel>{copy('solarContractSource')}</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      disabled={locked}
                      className="w-full rounded-md border bg-background p-2"
                    >
                      <option value="">{copy('solarSelectSource')}</option>
                      {options.templates.map((item) => (
                        <option key={item.version_id} value={'template:' + item.version_id}>
                          {item.name} · v{item.version_number}
                        </option>
                      ))}
                      {options.documents.map((item) => (
                        <option key={item.id} value={'document:' + item.id}>
                          {item.original_name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>{fieldCopy('sourceHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {renderField(
              'title',
              'solar-contract-title',
              copy('solarContractTitle'),
              messages.title
            )}
            {renderField(
              'text',
              'solar-contract-text',
              copy('solarContractText'),
              messages.text,
              'textarea'
            )}
            {renderField(
              'changeDescription',
              'solar-contract-reason',
              copy('solarContractReason'),
              messages.changeDescription
            )}
            <p className="text-sm text-muted-foreground">{contractCopy('commercialValueNotice')}</p>
            <FormField
              control={form.control}
              name="valueKind"
              render={({ field }) => (
                <FormItem id="solar-contract-value-kind">
                  <FormLabel>{contractCopy('statedContractValue')}</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      disabled={locked}
                      className="w-full rounded-md border bg-background p-2"
                    >
                      <option value="">{copy('solarSelectContractValue')}</option>
                      <option value="fixed">{contractCopy('fixedContractValue')}</option>
                      <option value="variable">{contractCopy('variableContractValue')}</option>
                    </select>
                  </FormControl>
                  <FormDescription>{fieldCopy('valueHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {draft.valueKind === 'fixed' &&
              renderField(
                'fixedAmount',
                'solar-contract-fixed-amount',
                contractCopy('fixedContractAmount'),
                messages.fixedAmount
              )}
            {draft.valueKind === 'variable' &&
              renderField(
                'variableDescription',
                'solar-contract-variable-description',
                contractCopy('variableContractDescription'),
                messages.variableDescription,
                'textarea'
              )}
            <h4 className="font-medium">{copy('solarInvoiceLines')}</h4>
            {draft.invoiceLines.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                {renderField(
                  `invoiceLines.${index}.description`,
                  `solar-contract-line-${index}-description`,
                  copy('solarInvoiceDescription'),
                  messages.description
                )}
                {renderField(
                  `invoiceLines.${index}.quantity`,
                  `solar-contract-line-${index}-quantity`,
                  copy('solarInvoiceQuantity'),
                  messages.quantity
                )}
                {renderField(
                  `invoiceLines.${index}.unitPrice`,
                  `solar-contract-line-${index}-unit-price`,
                  copy('solarInvoicePrice'),
                  messages.unitPrice
                )}
                {renderField(
                  `invoiceLines.${index}.vatRate`,
                  `solar-contract-line-${index}-vat-rate`,
                  copy('solarInvoiceVat'),
                  messages.vatRate
                )}
                {renderField(
                  `invoiceLines.${index}.isTaxable`,
                  `solar-contract-line-${index}-taxable`,
                  copy('solarInvoiceTaxable'),
                  messages.isTaxable,
                  'checkbox'
                )}
                {draft.invoiceLines.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid={`solar-contract-remove-line-${index}`}
                    disabled={locked}
                    onClick={() => {
                      if (!command.current) {
                        form.setValue(
                          'invoiceLines',
                          form.getValues().invoiceLines.filter((_, position) => position !== index),
                          { shouldDirty: true }
                        );
                        form.clearErrors('invoiceLines');
                      }
                    }}
                  >
                    {copy('solarRemoveLine')}
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              data-testid="solar-contract-add-line"
              disabled={locked || draft.invoiceLines.length >= 100}
              onClick={() => {
                if (!command.current)
                  form.setValue(
                    'invoiceLines',
                    [...form.getValues().invoiceLines, emptySolarInvoice()],
                    { shouldDirty: true }
                  );
              }}
            >
              {copy('solarAddLine')}
            </Button>
            <p className="text-sm text-muted-foreground">{fieldCopy('lineHelp')}</p>
            {form.formState.errors.root && <p role="alert">{fieldCopy('validationUnavailable')}</p>}
            {unconfirmed && (
              <Alert variant="destructive">
                <AlertDescription>{fieldCopy('uncertain')}</AlertDescription>
              </Alert>
            )}
            {unconfirmed && (
              <Button
                type="button"
                variant="outline"
                data-testid="solar-contract-retry"
                disabled={pending || !!action}
                onClick={() => {
                  if (captured && current(captured) && !pendingRef.current)
                    setAction(decorate(captured));
                }}
              >
                {fieldCopy('retryCaptured')}
              </Button>
            )}
            <div>
              <Button
                type="submit"
                loading={preparing}
                disabled={preparing || locked || coordination?.blocked()}
              >
                {copy('solarCreateContract')}
              </Button>
            </div>
          </>
        )}
        {action && captured && review && shown && current(captured) && (
          <TeamActionDialog
            action={action}
            onPendingChange={(value) => {
              if (current(captured)) {
                if (value) captured.attempted = true;
                pendingRef.current = value;
                setPending(value);
              }
            }}
            onUnconfirmed={() => {
              if (current(captured)) {
                captured.uncertain = true;
                setUnconfirmed(true);
                setAction(null);
                pendingRef.current = false;
                setPending(false);
              }
            }}
            onDenied={() => {
              if (current(captured)) withdraw();
            }}
            onClose={() => close(captured)}
            onSuccess={async (value) => {
              if (!current(captured)) return;
              const receipt = solarContractReceipt(value);
              if (!receipt) throw new Error('receipt');
              command.current = null;
              setAction(null);
              setUnconfirmed(false);
              release();
              form.reset(emptySolarContract());
              callbacks.current.onCreated(receipt.contractId);
            }}
            summary={
              review && (
                <>
                  <FinancialReviewSummary
                    title={copy('solarContractReviewTitle')}
                    rows={[
                      {
                        id: 'source',
                        label: copy('solarContractSource'),
                        value: `${review.data.source.label}${review.data.source.versionNumber ? ` · v${review.data.source.versionNumber}` : ''}`,
                      },
                      { id: 'title', label: copy('solarContractTitle'), value: review.data.title },
                      {
                        id: 'reason',
                        label: copy('solarContractReason'),
                        value: review.data.changeDescription,
                      },
                      {
                        id: 'commercial',
                        label: contractCopy('statedContractValue'),
                        value:
                          review.data.commercialValue.kind === 'fixed'
                            ? formatCurrencyIrr(review.data.commercialValue.amountIrr, locale)
                            : review.data.commercialValue.description,
                      },
                      ...(review.data.activationRequirements
                        ? [
                            ['signature_required', 'prerequisite.signature'],
                            ['payment_required', 'prerequisite.initialPayment'],
                            ['service_start_required', 'prerequisite.serviceStart'],
                          ].map(([key, label]) => ({
                            id: key!,
                            label: contractCopy(label!),
                            value: contractCopy(
                              review.data.activationRequirements![
                                key as
                                  | 'signature_required'
                                  | 'payment_required'
                                  | 'service_start_required'
                              ]
                                ? 'mandatoryRequirement'
                                : 'prerequisite.not_required'
                            ),
                          }))
                        : []),
                      ...review.data.invoiceLines.map((line, index) => ({
                        id: `line-${index}`,
                        label: `${line.description} · ${line.quantity} × ${formatCurrencyIrr(line.unitPrice, locale)}`,
                        value: formatCurrencyIrr(line.lineTotal, locale),
                      })),
                      {
                        id: 'vat',
                        label: copy('solarReviewVat'),
                        value: formatCurrencyIrr(review.data.totals.vat, locale),
                      },
                      {
                        id: 'due',
                        label: copy('solarReviewDue'),
                        value:
                          review.data.dueRule.configDays === null
                            ? '—'
                            : `${review.data.dueRule.configDays} ${copy('solarReviewDaysAfterIssue')}`,
                      },
                    ]}
                    total={{
                      label: copy('solarReviewInvoiceTotal'),
                      value: formatCurrencyIrr(review.data.totals.total, locale),
                    }}
                    notice={
                      <>
                        <p>{copy('solarReviewOutcome')}</p>
                        <details className="mt-2">
                          <summary className="cursor-pointer">{copy('solarContractText')}</summary>
                          <p className="mt-2 whitespace-pre-wrap break-words">
                            {review.data.template?.text ?? review.data.text}
                          </p>
                        </details>
                      </>
                    }
                  />
                  <OrderWalletBalance
                    profileId={profileId}
                    total={review.data.totals.total}
                    scopeKey={JSON.stringify([scopeKey, review.hash])}
                    staff
                  />
                </>
              )
            }
          />
        )}
      </form>
    </Form>
  );
}
