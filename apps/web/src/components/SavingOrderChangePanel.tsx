import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { OrderWalletBalance } from './OrderWalletBalance.js';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, Card, CardContent } from '@barghsa/ui';
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
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
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

type Props = SavingChangeSource & {
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
  const client = useQueryClient();
  const reader = useId();
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const querySequence = useRef(0);
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
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
            queryFn: async ({ signal }) => {
              const response = await fetch(path, { credentials: 'include', signal });
              return {
                ok: response.ok,
                status: response.status,
                data: response.ok ? ((await response.json()) as unknown) : null,
              };
            },
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
        const response = await fetch(`/api/saving/orders/${props.orderId}/change-quote`, {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(draft),
        });
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
  async function send(captured: Command) {
    if (!active() || writing.current || command.current !== captured) return;
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
  return (
    <Card data-testid="saving-change-panel">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{copy('changeOrder')}</h2>
          <p className="text-sm text-muted-foreground">{copy('changeOrderHelp')}</p>
        </div>
        {status === 'loading' && <p role="status">{copy('loading')}</p>}
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
              className="space-y-4"
              noValidate
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="hardwareProductId"
                  render={({ field }) => (
                    <FormItem id="saving-change-hardware">
                      <FormLabel>{copy('stepHardware')}</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className="w-full rounded-md border bg-background px-3 py-2"
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
                        </select>
                      </FormControl>
                      <FormDescription>{formCopy('customerHardwareHelp')}</FormDescription>
                      <FormMessage reserveSpace />
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
                        <select
                          {...field}
                          className="w-full rounded-md border bg-background px-3 py-2"
                          disabled={frozen}
                          onChange={(event) => edit('installationAddressId', event.target.value)}
                        >
                          <option value="">{copy('stepAddress')}</option>
                          {addresses.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.fullAddress} · {item.postalCode}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormDescription>{formCopy('customerAddressHelp')}</FormDescription>
                      <FormMessage reserveSpace />
                    </FormItem>
                  )}
                />
              </div>
              {!frozen && (
                <Link
                  to="/settings/addresses"
                  className="inline-block text-sm text-primary hover:underline"
                >
                  {copy('manageAddresses')}
                </Link>
              )}
              {!quote && !frozen && (
                <Button
                  type="submit"
                  variant="outline"
                  disabled={busy}
                  aria-busy={busy || undefined}
                >
                  {busy && (
                    <span
                      aria-hidden="true"
                      className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                    />
                  )}
                  {busy ? formCopy('customerChecking') : copy('previewChange')}
                </Button>
              )}
              {form.formState.errors.root?.validation && (
                <p role="alert">{formCopy('validationUnavailable')}</p>
              )}
            </form>
          </Form>
        )}
        {quote && (
          <div
            data-testid="saving-change-quote"
            className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm break-words"
            aria-live="polite"
          >
            <p>
              {quote.plan.title[locale]} · {quote.hardware.title[locale]}
            </p>
            <p>
              {copy('billIdentifier')}: <bdi>{quote.billIdentifier}</bdi>
            </p>
            <p>
              {quote.address.full_address} · <bdi>{quote.address.postal_code}</bdi>
            </p>
            {quote.lines.map((line) => (
              <p key={line.type}>
                {line.title[locale]}: <bdi>{numbers.money(line.amountIrR)}</bdi>
              </p>
            ))}
            <p>
              {copy('subtotal')}: <bdi>{numbers.money(quote.subtotalIrR)}</bdi>
            </p>
            <p>
              {copy('discount')}: <bdi>{numbers.money(quote.discountIrR)}</bdi>
            </p>
            {quote.discountIrR !== '0' && (
              <p className="text-muted-foreground">{copy('retainedDiscount')}</p>
            )}
            <p>
              {copy('vat')}: <bdi>{numbers.money(quote.vatIrR)}</bdi>
            </p>
            <p className="font-semibold">
              {copy('total')}: <bdi>{numbers.money(quote.totalIrR)}</bdi>
            </p>
            <OrderWalletBalance
              profileId={props.profileId}
              total={quote.totalIrR}
              scopeKey={quote.reviewDigest}
            />
            <details>
              <summary>{quote.agreement.title}</summary>
              <p className="whitespace-pre-wrap">{quote.agreement.body}</p>
            </details>
            {!frozen && (
              <Button type="button" disabled={busy} onClick={confirm}>
                {copy('confirmChange')}
              </Button>
            )}
          </div>
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
      </CardContent>
    </Card>
  );
}
