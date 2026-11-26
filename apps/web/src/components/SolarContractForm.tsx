import { readWithDeadline } from '../lib/server-query-client.js';
import { useOwnedFinancialRead } from '../hooks/useOwnedFinancialRead.js';
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
  NativeSelect,
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
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { ErrorCodes } from '@barghsa/shared/errors';
import { toast } from '../lib/toast-api.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import {
  emptySolarContract,
  draftSolarInvoiceTotals,
  solarFixedAmount,
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
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';

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
  editorPage = false,
}: {
  requestId: string;
  profileId: string;
  scopeKey?: string;
  coordination?: SolarContractCoordination;
  onDenied?: () => void;
  onCreated: (contractId: string) => void;
  editorPage?: boolean;
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
  const readFinancial = useOwnedFinancialRead(actor, profileRevision, scopeKey);
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
    vatPercent: fieldCopy('vatInvalid'),
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
    for (const leaf of ['description', 'quantity', 'unitPrice', 'vatPercent', 'isTaxable'] as const)
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
        queryFn: ({ signal: ownerSignal }) =>
          readWithDeadline(ownerSignal, async (signal) => {
            const response = await fetch(
              `/api/admin/solar/requests/${encodeURIComponent(requestId)}/contract-options`,
              { credentials: 'include', signal }
            );
            return {
              ok: response.ok,
              status: response.status,
              data: response.ok ? ((await response.json()) as unknown) : null,
            };
          }),
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
        const response = await readFinancial(
          path + '/review',
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          },
          true
        );
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
            responseDeadline: true,
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
  const draftTotals = editorPage ? draftSolarInvoiceTotals(draft.invoiceLines) : undefined;
  const fixedAmount = draft.valueKind === 'fixed' ? solarFixedAmount(draft.fixedAmount) : null;
  const renderField = (
    name: FieldPath<SolarContractDraft>,
    id: string,
    label: string,
    help: string,
    kind: 'input' | 'textarea' | 'checkbox' = 'input',
    example?: string
  ) => {
    const percent = name.endsWith('vatPercent');
    const numeric =
      name === 'fixedAmount' || name.endsWith('unitPrice') || name.endsWith('quantity') || percent;
    return (
      <FormField
        key={name}
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem
            id={id}
            className={kind === 'checkbox' ? `${recordEditorField} self-end` : recordEditorField}
          >
            {kind === 'checkbox' ? (
              <FormLabel className="flex min-h-11 items-center gap-2 rounded-lg bg-muted/50 px-2.5">
                <FormControl>
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    checked={field.value === true}
                    disabled={locked}
                    onChange={(event) => field.onChange(event.target.checked)}
                  />
                </FormControl>
                {label}
              </FormLabel>
            ) : (
              <>
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  {kind === 'textarea' ? (
                    <Textarea
                      {...field}
                      aria-required="true"
                      value={String(field.value ?? '')}
                      disabled={locked}
                      placeholder={example}
                      rows={name === 'text' ? (editorPage ? 3 : 5) : 2}
                      className={
                        name === 'text'
                          ? 'min-h-24 max-h-72 resize-y'
                          : 'min-h-14 max-h-32 resize-y'
                      }
                    />
                  ) : (
                    <Input
                      {...field}
                      aria-required="true"
                      value={String(field.value ?? '')}
                      disabled={locked}
                      placeholder={example}
                      dir={numeric ? 'ltr' : undefined}
                      inputMode={percent ? 'decimal' : numeric ? 'numeric' : undefined}
                    />
                  )}
                </FormControl>
              </>
            )}
            <FormDescription>
              {name === 'fixedAmount' && fixedAmount !== null ? (
                <bdi className="font-medium text-foreground [overflow-wrap:anywhere]">
                  {formatCurrencyIrr(fixedAmount, locale)}
                </bdi>
              ) : (
                help
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };
  return (
    <Form {...form}>
      <form
        data-testid="solar-contract-form"
        aria-label={copy('solarCreateContract')}
        className={recordEditorSurface}
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <RecordEditorSection
          title={editorPage ? fieldCopy('contractTerms') : copy('solarCreateContract')}
          description={fieldCopy('issueSteps')}
        >
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
              <div className={recordEditorGrid}>
                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem id="solar-contract-source" className={recordEditorField}>
                      <FormLabel>{copy('solarContractSource')}</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          aria-required="true"
                          disabled={locked}
                          className="w-full"
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
                        </NativeSelect>
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
                  messages.title,
                  'input',
                  fieldCopy('titleExample')
                )}
              </div>
              {renderField(
                'text',
                'solar-contract-text',
                copy('solarContractText'),
                messages.text,
                'textarea',
                fieldCopy('termsExample')
              )}
              {renderField(
                'changeDescription',
                'solar-contract-reason',
                copy('solarContractReason'),
                messages.changeDescription,
                'input',
                fieldCopy('reasonExample')
              )}
            </>
          )}
        </RecordEditorSection>
        {shown && options && (
          <>
            <RecordEditorSection
              title={fieldCopy('commercialValue')}
              description={contractCopy('commercialValueNotice')}
            >
              <div className={draft.valueKind === 'fixed' ? recordEditorGrid : 'space-y-2.5'}>
                <FormField
                  control={form.control}
                  name="valueKind"
                  render={({ field }) => (
                    <FormItem id="solar-contract-value-kind" className={recordEditorField}>
                      <FormLabel>{contractCopy('statedContractValue')}</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          aria-required="true"
                          disabled={locked}
                          className="w-full"
                        >
                          <option value="">{copy('solarSelectContractValue')}</option>
                          <option value="fixed">{contractCopy('fixedContractValue')}</option>
                          <option value="variable">{contractCopy('variableContractValue')}</option>
                        </NativeSelect>
                      </FormControl>
                      <FormDescription>
                        {field.value
                          ? tContractAuthoring(`valueKindHelp.${field.value}`, locale)
                          : fieldCopy('valueHelp')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {draft.valueKind === 'fixed' &&
                  renderField(
                    'fixedAmount',
                    'solar-contract-fixed-amount',
                    contractCopy('fixedContractAmount'),
                    tContractAuthoring('amountHelp', locale)
                  )}
                {draft.valueKind === 'variable' &&
                  renderField(
                    'variableDescription',
                    'solar-contract-variable-description',
                    contractCopy('variableContractDescription'),
                    fieldCopy('variableHelp'),
                    'textarea',
                    fieldCopy('variableExample')
                  )}
              </div>
            </RecordEditorSection>
            <RecordEditorSection
              title={copy('solarInvoiceLines')}
              description={fieldCopy('lineHelp')}
            >
              {draft.invoiceLines.map((line, index) => (
                <fieldset
                  key={index}
                  className="@container min-w-0 space-y-2.5 rounded-lg border px-3 pb-3"
                >
                  <legend className="px-1 text-sm font-medium">
                    {fieldCopy('invoiceLine')} {(index + 1).toLocaleString(locale)}
                  </legend>
                  {renderField(
                    `invoiceLines.${index}.description`,
                    `solar-contract-line-${index}-description`,
                    copy('solarInvoiceDescription'),
                    fieldCopy('descriptionHelp'),
                    'input',
                    fieldCopy('lineExample')
                  )}
                  <div className="grid min-w-0 grid-cols-2 gap-3 @xl:grid-cols-4">
                    {renderField(
                      `invoiceLines.${index}.quantity`,
                      `solar-contract-line-${index}-quantity`,
                      copy('solarInvoiceQuantity'),
                      fieldCopy('quantityHelp')
                    )}
                    {renderField(
                      `invoiceLines.${index}.unitPrice`,
                      `solar-contract-line-${index}-unit-price`,
                      copy('solarInvoicePrice'),
                      fieldCopy('priceHelp')
                    )}
                    {renderField(
                      `invoiceLines.${index}.vatPercent`,
                      `solar-contract-line-${index}-vat-rate`,
                      copy('solarInvoiceVat'),
                      fieldCopy('vatHelp')
                    )}
                    {renderField(
                      `invoiceLines.${index}.isTaxable`,
                      `solar-contract-line-${index}-taxable`,
                      copy('solarInvoiceTaxable'),
                      fieldCopy('taxableHelp'),
                      'checkbox'
                    )}
                  </div>
                  {draft.invoiceLines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`solar-contract-remove-line-${index}`}
                      disabled={locked}
                      onClick={() => {
                        if (!command.current) {
                          form.setValue(
                            'invoiceLines',
                            form
                              .getValues()
                              .invoiceLines.filter((_, position) => position !== index),
                            { shouldDirty: true }
                          );
                          form.clearErrors('invoiceLines');
                        }
                      }}
                    >
                      {copy('solarRemoveLine')}
                    </Button>
                  )}
                </fieldset>
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
              {draftTotals && (
                <dl className="grid min-w-0 gap-2 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-3">
                  {(
                    [
                      [fieldCopy('invoiceSubtotal'), draftTotals.subtotal],
                      [copy('solarReviewVat'), draftTotals.vat],
                      [fieldCopy('draftInvoiceTotal'), draftTotals.total],
                    ] as const
                  ).map(([label, amount]) => (
                    <div
                      key={label}
                      className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 sm:block"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="wrap-anywhere font-medium">
                        <bdi>{formatCurrencyIrr(amount, locale)}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </RecordEditorSection>
            {(form.formState.errors.root || unconfirmed) && (
              <div className="space-y-2 px-4 py-3 sm:px-6">
                {form.formState.errors.root && (
                  <p role="alert">{fieldCopy('validationUnavailable')}</p>
                )}
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
              </div>
            )}
            <RecordEditorActions>
              <Button
                type="submit"
                loading={preparing}
                disabled={preparing || locked || coordination?.blocked()}
              >
                {editorPage ? fieldCopy('reviewIssuance') : copy('solarCreateContract')}
              </Button>
            </RecordEditorActions>
          </>
        )}
        {action && captured && review && shown && current(captured) && (
          <TeamActionDialog
            risk="financial"
            action={action}
            onPendingChange={(value) => {
              if (current(captured)) {
                pendingRef.current = value;
                setPending(value);
              }
            }}
            onCommandDispatch={(dispatched) => {
              if (current(captured)) captured.attempted = dispatched || captured.uncertain;
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
              toast.success(copy('status_contract_created'));
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
                          <p dir="auto" className="mt-2 whitespace-pre-wrap break-words">
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
