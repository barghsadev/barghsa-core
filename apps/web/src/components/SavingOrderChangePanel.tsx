import { toast } from '../lib/toast-api.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { ConfirmationFields, NativeSelect } from '@barghsa/ui';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { useOwnedFinancialRead } from '../hooks/useOwnedFinancialRead.js';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { OrderWalletBalance } from './OrderWalletBalance.js';
import { SavingReviewPrice } from './SavingReviewPrice.js';
import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { LoadingStatus, Button } from '@barghsa/ui';
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
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingChange } from '@barghsa/i18n/saving-change';
import { ErrorCodes } from '@barghsa/shared/errors';
import { withCsrf } from '../lib/csrf.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  availableSavingHardware,
  bindSavingChangeQuote,
  definitiveSavingChangeRejection,
  matchedSavingChangeReceipt,
  savingChangeOptions,
  savingChangePublicError,
  savingChangeUuid,
  type SavingChangeDraft,
  type SavingChangeSource,
  type SavingChangeQuote,
  type SavingChangeHardware,
  type SavingChangeAddress,
} from '../lib/saving-change-form.js';
import { readWithDeadline } from '../lib/server-query-client.js';

type Props = SavingChangeSource & {
  currentOrder: {
    totalIrR: string;
    hardwareTitle: SavingChangeHardware['title'];
    address: { full_address: string; postal_code: string };
  };
  onChanged: () => void;
  onCommandLock?: (locked: boolean) => void;
  onWithdrawal?: () => void;
};
interface Command {
  body: string;
  quote: SavingChangeQuote;
  uncertain: boolean;
}
export function SavingOrderChangePanel(props: Props) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const locale = useLocale();
  const scope = JSON.stringify([
    actor,
    profileRevision,
    props.orderId,
    props.profileId,
    props.planId,
    props.currentHardwareId,
    props.currentAddressId,
    props.currentVersionId,
    props.invoiceId,
    props.billIdentifier,
    props.agreementVersionId,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  if (
    !actor ||
    ![
      props.orderId,
      props.profileId,
      props.planId,
      props.currentHardwareId,
      props.currentAddressId,
      props.currentVersionId,
      props.invoiceId,
      props.agreementVersionId,
    ].every(savingChangeUuid)
  )
    return <p role="alert">{tSavingChange('customerForbidden', locale)}</p>;
  return <ChangeWorkspace key={scope} {...props} scope={scope} currentScope={currentScope} />;
}
function ChangeWorkspace(props: Props & { scope: string; currentScope: RefObject<string> }) {
  const readActor = useAccountUser();
  const readRevision = useProfileContextRevision();
  const readFinancial = useOwnedFinancialRead(
    readActor,
    readRevision,
    props.scope,
    props.profileId
  );
  const client = useQueryClient();
  const reader = useId();
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const querySequence = useRef(0);
  const locale = useLocale();
  const copy = (key: string) => tSaving(key, locale);
  const formCopy = (key: string) => tSavingChange(key, locale);
  const mounted = useRef(false);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const preparing = useRef(false);
  const writing = useRef(false);
  const denied = useRef(false);
  const command = useRef<Command | null>(null);
  const [hardware, setHardware] = useState<SavingChangeHardware[]>([]);
  const [addresses, setAddresses] = useState<SavingChangeAddress[]>([]);
  const [quote, setQuote] = useState<SavingChangeQuote | null>(null);
  const reviewId = useId();
  const quoteReview = useRef<HTMLElement>(null);
  useEffect(() => {
    if (quote && quoteReview.current) {
      quoteReview.current.focus({ preventScroll: true });
      quoteReview.current.scrollIntoView?.({ block: 'start' });
    }
  }, [quote]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'missing'>(
    'loading'
  );
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const current: SavingChangeDraft = {
    hardwareProductId: props.currentHardwareId,
    installationAddressId: props.currentAddressId,
  };
  const messages = {
    hardwareProductId: formCopy('customerHardwareInvalid'),
    installationAddressId: formCopy('customerAddressInvalid'),
    unchanged: formCopy('customerUnchanged'),
  };
  const form: ReturnType<typeof useZodForm<SavingChangeDraft>> = useZodForm<SavingChangeDraft>(
    async () => {
      const raw = JSON.stringify(form.getValues());
      const version = generation.current;
      const schemas = await import('../lib/saving-change-form-schemas.js');
      return active() && version === generation.current && raw === JSON.stringify(form.getValues())
        ? schemas.savingChangeSchema(hardware, addresses, current, messages)
        : schemas.inactiveSavingChangeSchema;
    },
    { defaultValues: current, validationUnavailableMessage: formCopy('validationUnavailable') }
  );
  const applyFields = useActionFieldErrors(
    form,
    {
      hardwareProductId: messages.hardwareProductId,
      installationAddressId: messages.installationAddressId,
    },
    copy('changeError')
  );
  function active() {
    return mounted.current && props.currentScope.current === props.scope && !denied.current;
  }
  function release() {
    command.current = null;
    props.onCommandLock?.(false);
    setUncertain(false);
  }
  function withdraw(kind: 'forbidden' | 'missing') {
    if (!active()) return;
    generation.current++;
    readGeneration.current++;
    readAbort.current?.abort();
    denied.current = true;
    preparing.current = false;
    writing.current = false;
    release();
    form.reset({ hardwareProductId: '', installationAddressId: '' });
    setHardware([]);
    setAddresses([]);
    setQuote(null);
    setError('');
    setBusy(false);
    setStatus(kind);
    props.onWithdrawal?.();
  }
  async function loadOptions() {
    if (!active() || command.current || preparing.current || writing.current) return;
    const version = ++readGeneration.current;
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    setStatus('loading');
    setQuote(null);
    const fresh = () => active() && version === readGeneration.current;
    const authority = {
      context: 'customer' as const,
      ownerId: props.profileId,
      accountId: actor,
      revision: profileRevision,
    };
    const attempt = ++querySequence.current;
    const keys = [
      queryKeys.catalogue.detail(
        authority,
        JSON.stringify([reader, props.scope, 'change-plans', attempt])
      ),
      queryKeys.profiles.list(
        authority,
        new URLSearchParams({ reader, scope: props.scope, owner: 'saving-change-addresses' }),
        attempt
      ),
    ];
    const cancel = () => {
      for (const queryKey of keys) void client.cancelQueries({ queryKey, exact: true });
    };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      const responses = await Promise.all(
        ['/api/saving/plans', `/api/profiles/${props.profileId}/addresses`].map((path, index) =>
          client.fetchQuery({
            queryKey: keys[index]!,
            staleTime: 0,
            gcTime: 0,
            retry: false,
            queryFn: ({ signal: querySignal }) =>
              readWithDeadline(querySignal, async (signal) => {
                const response = await fetch(path, { credentials: 'include', signal });
                return {
                  ok: response.ok,
                  status: response.status,
                  data: response.ok ? ((await response.json()) as unknown) : null,
                };
              }),
          })
        )
      );
      if (!fresh()) return;
      if (responses.some((response) => [401, 403, 404].includes(response.status))) {
        withdraw(responses.some((response) => response.status === 404) ? 'missing' : 'forbidden');
        return;
      }
      if (responses.some((response) => !response.ok)) throw new Error('load');
      const [plans, saved] = responses.map((response) => response.data);
      if (!fresh()) return;
      const options = savingChangeOptions(plans, saved, props.planId, props.profileId);
      if (!options) throw new Error('load');
      setHardware(options.hardware);
      setAddresses(options.addresses);
      setStatus('ready');
    } catch {
      if (fresh()) setStatus('error');
    } finally {
      controller.signal.removeEventListener('abort', cancel);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void loadOptions();
    return () => {
      mounted.current = false;
      generation.current++;
      readGeneration.current++;
      readAbort.current?.abort();
    };
  }, []);
  function edit(name: keyof SavingChangeDraft, value: string) {
    if (!active() || command.current || writing.current) return;
    form.setValue(name, value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setQuote(null);
    setError('');
  }
  function fields(value: unknown) {
    const publicError = savingChangePublicError(value);
    return (
      publicError?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
      Array.isArray(publicError.fields) &&
      applyFields(publicError.fields)
    );
  }
  async function preview() {
    if (!active() || status !== 'ready' || preparing.current || writing.current || command.current)
      return;
    preparing.current = true;
    setBusy(true);
    setError('');
    setQuote(null);
    const version = generation.current;
    const raw = JSON.stringify(form.getValues());
    try {
      await form.handleSubmit(async (draft) => {
        if (!active() || version !== generation.current || raw !== JSON.stringify(form.getValues()))
          return;
        const address = addresses.find((item) => item.id === draft.installationAddressId);
        if (!address) return;
        const response = await readFinancial(
          `/api/saving/orders/${props.orderId}/change-quote`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(draft),
          },
          true
        );
        const value = await response.json().catch(() => null);
        if (!active() || version !== generation.current) return;
        if ([401, 403, 404].includes(response.status)) {
          withdraw(response.status === 404 ? 'missing' : 'forbidden');
          return;
        }
        if (raw !== JSON.stringify(form.getValues())) return;
        if (!response.ok) {
          if (!fields(value)) setError(copy('quoteError'));
          return;
        }
        const reviewed =
          response.status === 201 ? bindSavingChangeQuote(value, props, draft, address) : null;
        if (!reviewed) {
          setError(copy('quoteError'));
          return;
        }
        setQuote(reviewed);
      })();
    } catch {
      if (active() && version === generation.current && raw === JSON.stringify(form.getValues()))
        setError(copy('quoteError'));
    } finally {
      if (active() && version === generation.current) {
        preparing.current = false;
        setBusy(false);
      }
    }
  }
  const financialGate = useRiskConfirmation(quote, locale, 'financial');
  async function send(captured: Command) {
    if (!financialGate.allowed || !active() || writing.current || command.current !== captured)
      return;
    writing.current = true;
    setBusy(true);
    setError('');
    const version = generation.current;
    const fresh = () => active() && version === generation.current && command.current === captured;
    try {
      const response = await fetch(`/api/saving/orders/${props.orderId}/change`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: captured.body,
      });
      const value = await response.json().catch(() => null);
      if (!fresh()) return;
      if ([401, 403, 404].includes(response.status)) {
        withdraw(response.status === 404 ? 'missing' : 'forbidden');
        return;
      }
      if (response.status === 201 && matchedSavingChangeReceipt(value, props, captured.quote)) {
        release();
        setQuote(null);
        form.reset(current);
        toast.success(confirmationText('recorded', locale));
        props.onChanged();
        return;
      }
      if (
        !captured.uncertain &&
        [400, 409].includes(response.status) &&
        definitiveSavingChangeRejection(value)
      ) {
        release();
        setQuote(null);
        if (!fields(value)) setError(copy('changeError'));
        return;
      }
      captured.uncertain = true;
      setUncertain(true);
      setError(formCopy('customerUncertain'));
    } catch {
      if (fresh()) {
        captured.uncertain = true;
        setUncertain(true);
        setError(formCopy('customerUncertain'));
      }
    } finally {
      if (active() && version === generation.current) {
        writing.current = false;
        setBusy(false);
      }
    }
  }
  function confirm() {
    if (!financialGate.allowed) return;
    if (!active() || preparing.current || writing.current || command.current || !quote) return;
    const draft = form.getValues();
    if (
      draft.hardwareProductId !== quote.hardware.id ||
      draft.installationAddressId !== quote.address.id
    )
      return;
    const captured: Command = {
      body: JSON.stringify({
        ...draft,
        expectedQuoteDigest: quote.reviewDigest,
        idempotencyKey: crypto.randomUUID(),
      }),
      quote,
      uncertain: false,
    };
    command.current = captured;
    props.onCommandLock?.(true);
    readGeneration.current++;
    readAbort.current?.abort();
    void send(captured);
  }
  function retry() {
    if (!active() || preparing.current || writing.current || !command.current) return;
    void send(command.current);
  }
  const frozen = !!command.current;
  const hardwareChanged = quote && quote.hardware.id !== props.currentHardwareId;
  const addressChanged = quote && quote.address.id !== props.currentAddressId;
  return (
    <section className="min-w-0 space-y-4" data-testid="saving-change-panel">
      {status === 'loading' && <LoadingStatus>{copy('loading')}</LoadingStatus>}
      {(status === 'forbidden' || status === 'missing') && (
        <p role="alert">
          {formCopy(status === 'missing' ? 'customerMissing' : 'customerForbidden')}
        </p>
      )}
      {status === 'error' && (
        <>
          <p role="alert">{copy('changeUnavailable')}</p>
          <Button
            type="button"
            variant="outline"
            data-testid="saving-change-options-reload"
            onClick={() => void loadOptions()}
          >
            {formCopy('customerReload')}
          </Button>
        </>
      )}
      {status === 'ready' && (
        <Form {...form}>
          <form
            data-testid="saving-change-form"
            onSubmit={(event) => {
              event.preventDefault();
              void preview();
            }}
            className={recordEditorSurface}
            noValidate
          >
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="hardwareProductId"
                render={({ field }) => (
                  <FormItem id="saving-change-hardware">
                    <FormLabel>{copy('stepHardware')}</FormLabel>
                    <FormControl>
                      <NativeSelect
                        {...field}
                        aria-required="true"
                        className="w-full scroll-mt-20"
                        disabled={frozen}
                        onChange={(event) => edit('hardwareProductId', event.target.value)}
                      >
                        <option value="">{copy('stepHardware')}</option>
                        {hardware.map((item) => (
                          <option
                            key={item.id}
                            value={item.id}
                            disabled={!availableSavingHardware(item, props.currentHardwareId)}
                          >
                            {item.title[locale]}
                            {item.status !== 'active'
                              ? ` · ${copy('unavailable')}`
                              : item.stock_tracking && item.available_count <= 0
                                ? ` · ${copy('outOfStock')}`
                                : ''}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormDescription>{formCopy('customerHardwareHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="installationAddressId"
                render={({ field }) => (
                  <FormItem id="saving-change-address">
                    <FormLabel>{copy('stepAddress')}</FormLabel>
                    <FormControl>
                      <NativeSelect
                        {...field}
                        aria-required="true"
                        className="w-full scroll-mt-20"
                        disabled={frozen}
                        onChange={(event) => edit('installationAddressId', event.target.value)}
                      >
                        <option value="">{copy('stepAddress')}</option>
                        {addresses.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.fullAddress} · {item.postalCode}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormDescription>{formCopy('customerAddressHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {form.formState.errors.root?.validation && (
              <p role="alert" className="px-4 pb-3 text-sm text-destructive">
                {formCopy('validationUnavailable')}
              </p>
            )}
            {!frozen && (
              <RecordEditorActions
                secondary={
                  <Link
                    to="/settings/addresses"
                    className="touch-action w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {copy('manageAddresses')}
                  </Link>
                }
              >
                {!quote && (
                  <Button type="submit" loading={busy} disabled={busy}>
                    {busy ? formCopy('customerChecking') : copy('previewChange')}
                  </Button>
                )}
              </RecordEditorActions>
            )}
          </form>
        </Form>
      )}
      {quote && (
        <section
          ref={quoteReview}
          tabIndex={-1}
          aria-labelledby={reviewId}
          data-testid="saving-change-quote"
          className="min-w-0 scroll-mt-3 space-y-3 rounded-lg wrap-anywhere text-sm focus:outline-none"
        >
          <div className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={reviewId} className="text-base font-semibold">
                {formCopy('customerReview')}
              </h2>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || frozen}
                onClick={() =>
                  form.setFocus(hardwareChanged ? 'hardwareProductId' : 'installationAddressId')
                }
              >
                {formCopy('customerBackToEditing')}
              </Button>
            </header>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2 lg:items-start">
              <div className="space-y-2">
                <SavingReviewPrice quote={quote} currentTotal={props.currentOrder.totalIrR} />
                {quote.discountIrR !== '0' && (
                  <p className="px-2 text-sm text-muted-foreground">{copy('retainedDiscount')}</p>
                )}
              </div>
              <dl className="min-w-0 divide-y rounded-lg border px-3">
                <ReviewedSelection
                  label={copy('stepHardware')}
                  current={
                    hardwareChanged ? <bdi>{props.currentOrder.hardwareTitle[locale]}</bdi> : null
                  }
                  revised={<bdi>{quote.hardware.title[locale]}</bdi>}
                />
                <ReviewedSelection
                  label={copy('stepAddress')}
                  current={
                    addressChanged ? <ReviewedAddress address={props.currentOrder.address} /> : null
                  }
                  revised={<ReviewedAddress address={quote.address} />}
                />
              </dl>
            </div>
            <dl className="grid min-w-0 grid-cols-2 gap-3 border-t px-2 pt-3 text-xs">
              <div className="min-w-0">
                <dt className="text-muted-foreground">{copy('stepPlan')}</dt>
                <dd className="mt-1 font-medium">
                  <bdi>{quote.plan.title[locale]}</bdi>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{copy('billIdentifier')}</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  <bdi dir="ltr">{quote.billIdentifier}</bdi>
                </dd>
              </div>
            </dl>
          </div>
          <details className="group rounded-lg border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <bdi>{quote.agreement.title}</bdi>
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
              />
            </summary>
            <p dir="auto" className="px-3 pb-3 whitespace-pre-wrap wrap-anywhere">
              {quote.agreement.body}
            </p>
          </details>
          <div className="rounded-lg border bg-card p-3 [&_button]:self-start">
            <OrderWalletBalance
              profileId={props.profileId}
              total={quote.totalIrR}
              scopeKey={quote.reviewDigest}
            />
          </div>
          <ConfirmationFields gate={financialGate} disabled={busy || frozen} />
          {!frozen && (
            <Button
              type="button"
              variant="warning"
              disabled={busy || !financialGate.allowed}
              onClick={confirm}
            >
              {copy('confirmChange')}
            </Button>
          )}
        </section>
      )}
      {uncertain && (
        <Button
          type="button"
          variant="outline"
          data-testid="saving-change-retry"
          disabled={busy}
          onClick={retry}
        >
          {formCopy('customerRetryCaptured')}
        </Button>
      )}
      {busy && frozen && <p role="status">{copy('changingOrder')}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function ReviewedSelection({
  label,
  current,
  revised,
}: {
  label: string;
  current: ReactNode;
  revised: ReactNode;
}) {
  const locale = useLocale();
  return (
    <div className="min-w-0 space-y-1.5 py-2.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      {current && (
        <dd className="flex items-baseline gap-2 text-muted-foreground">
          <span className="shrink-0 text-xs">
            {tSavingChange('customerPreviousSelection', locale)}
          </span>
          <span className="min-w-0">{current}</span>
        </dd>
      )}
      <dd className="flex items-baseline gap-2 font-medium">
        {current && (
          <span className="shrink-0 text-xs text-primary">
            {tSavingChange('customerRevisedSelection', locale)}
          </span>
        )}
        <span className="min-w-0">{revised}</span>
      </dd>
    </div>
  );
}

function ReviewedAddress({ address }: { address: Props['currentOrder']['address'] }) {
  return (
    <>
      <bdi>{address.full_address}</bdi>
      <bdi dir="ltr" className="block text-xs tabular-nums">
        {address.postal_code}
      </bdi>
    </>
  );
}
