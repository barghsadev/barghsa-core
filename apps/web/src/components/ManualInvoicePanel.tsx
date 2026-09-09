import { tInvoiceCorrections as tc } from '@barghsa/i18n/invoice-corrections';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@barghsa/ui';
import { tManualInvoice as t } from '@barghsa/i18n/manual-invoice';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';

interface DraftLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vat: string;
}
interface Profile {
  id: string;
  title: string;
  profileType: string;
}
export interface InvoiceCorrectionSource {
  invoiceId: string;
  profileId: string;
  state: string;
  paidAmount: string;
  totalAmount: string;
  lines: InvoiceRequest['lines'];
}
interface InvoiceRequest {
  correction?: {
    kind: 'replacement' | 'adjustment';
    invoiceId: string;
    reason: string;
    amount: string;
  };
  profileId: string;
  idempotencyKey: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    vatRate: number;
    isTaxable: boolean;
  }>;
}
const maxIrr = 9_223_372_036_854_775_807n;
const blankLine = (): DraftLine => ({
  id: crypto.randomUUID(),
  description: '',
  quantity: '1',
  unitPrice: '',
  vat: '0',
});
function digits(value: string) {
  return value
    .trim()
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace('٫', '.');
}
function calculate(lines: DraftLine[]) {
  let total = 0n;
  const parsed: InvoiceRequest['lines'] = [];
  for (const line of lines) {
    const quantity = digits(line.quantity),
      price = digits(line.unitPrice),
      vat = digits(line.vat);
    const rate = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(vat);
    if (
      !line.description.trim() ||
      !/^\d{1,10}$/.test(quantity) ||
      !/^\d{1,19}$/.test(price) ||
      !rate
    )
      return null;
    const count = Number(quantity),
      amount = BigInt(price);
    const basisPoints = Number(rate[1]) * 100 + Number((rate[2] ?? '').padEnd(2, '0'));
    if (count < 1 || count > 2_147_483_647 || amount > maxIrr || basisPoints > 10_000) return null;
    const subtotal = BigInt(count) * amount;
    total += subtotal + (subtotal * BigInt(basisPoints) + 5000n) / 10_000n;
    parsed.push({
      description: line.description.trim(),
      quantity: count,
      unitPrice: amount.toString(),
      vatRate: basisPoints,
      isTaxable: basisPoints > 0,
    });
  }
  return total > 0n && total <= maxIrr ? { lines: parsed, total } : null;
}

export default function ManualInvoicePanel() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <section
      id="manual-invoice-panel"
      className="rounded-lg border bg-card p-6 text-card-foreground"
      aria-labelledby="manual-invoice-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 id="manual-invoice-heading" className="text-xl font-semibold">
            {t('admin.manualInvoice.title', locale)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('admin.manualInvoice.description', locale)}
          </p>
        </div>
        {!open && (
          <Button type="button" onClick={() => setOpen(true)}>
            {t('admin.manualInvoice.new', locale)}
          </Button>
        )}
      </div>
      {open && <ManualInvoiceForm />}
    </section>
  );
}

export function ManualInvoiceForm({
  correction,
}: {
  correction?: InvoiceCorrectionSource & {
    kind: 'replacement' | 'adjustment';
    onLocked: (value: boolean) => void;
  };
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const text = (key: string) =>
    (correction
      ? tc(
          key === 'title'
            ? `${correction.kind}Title`
            : key === 'issue'
              ? `${correction.kind}Issue`
              : key,
          locale
        )
      : undefined) ?? t(`admin.manualInvoice.${key}`, locale);
  const [reason, setReason] = useState(''),
    [amount, setAmount] = useState('');
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0),
    [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(correction?.profileId ?? null);
  const [loading, setLoading] = useState(!correction),
    [ready, setReady] = useState(Boolean(correction));
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    correction?.lines.length
      ? correction.lines.map((line) => ({
          id: crypto.randomUUID(),
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: line.unitPrice,
          vat: line.isTaxable ? String(line.vatRate / 100) : '0',
        }))
      : [blankLine()]
  );
  const [error, setError] = useState<string | null>(null),
    [acting, setActing] = useState(false);
  const busy = useRef(false),
    request = useRef<InvoiceRequest | null>(null),
    uncertain = useRef(false);
  const [locked, setLocked] = useState(false),
    [stepUp, setStepUp] = useState(false);
  const [password, setPassword] = useState(''),
    [stepError, setStepError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invoiceId: string; totalAmount: string } | null>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const signed = /^-?\d{1,19}$/.test(digits(amount)) ? BigInt(digits(amount)) : 0n;
  const validAdjustment =
    signed !== 0n && signed >= -maxIrr && signed <= maxIrr && Boolean(reason.trim());
  const calculation =
    correction?.kind === 'adjustment'
      ? validAdjustment
        ? { lines: [], total: signed < 0n ? -signed : signed }
        : null
      : calculate(lines);

  useEffect(() => {
    correction?.onLocked(locked);
  }, [locked, correction]);

  useEffect(() => {
    if (correction) return;
    const abort = new AbortController();
    setLoading(true);
    setReady(false);
    setLookupError(null);
    setProfileId(null);
    void fetch(`/api/admin/invoices/manual/profiles?search=${encodeURIComponent(query)}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(response.status === 403 || response.status === 401 ? 'denied' : 'lookup');
        const data = (await response.json()) as { items?: Profile[] };
        if (
          !Array.isArray(data.items) ||
          data.items.some((item) => typeof item.id !== 'string' || typeof item.title !== 'string')
        )
          throw new Error('lookup');
        if (!abort.signal.aborted) {
          setProfiles(data.items);
          setReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setProfiles([]);
          setLookupError(cause instanceof Error ? cause.message : 'lookup');
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [query, revision, correction]);

  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [locked]);

  function unlock() {
    request.current = null;
    uncertain.current = false;
    setLocked(false);
  }
  async function send(): Promise<'done' | 'step-up' | 'error'> {
    const submitted = request.current;
    if (!submitted) return 'error';
    try {
      const path = submitted.correction
        ? `/api/admin/invoices/${submitted.correction.invoiceId}/corrections`
        : '/api/admin/invoices/manual';
      const body = submitted.correction
        ? {
            kind: submitted.correction.kind,
            reason: submitted.correction.reason,
            idempotencyKey: submitted.idempotencyKey,
            ...(submitted.correction.kind === 'replacement'
              ? { lines: submitted.lines }
              : { amount: submitted.correction.amount }),
          }
        : submitted;
      const response = await fetch(path, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        error?: string;
        invoiceId?: string;
        profileId?: string;
        totalAmount?: string;
        state?: string;
        originalInvoiceId?: string;
        kind?: string;
        amount?: string;
        idempotencyKey?: string;
        reason?: string;
      };
      if (response.status === 403 && authErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code)
        return 'step-up';
      if (!response.ok) {
        if (response.status >= 500) uncertain.current = true;
        setError(
          uncertain.current
            ? 'uncertain'
            : response.status === 401 || response.status === 403
              ? 'denied'
              : response.status === 409
                ? 'conflict'
                : 'invalid'
        );
        if (!uncertain.current) unlock();
        return 'error';
      }
      if (
        typeof data.invoiceId !== 'string' ||
        !isInvoiceUuid(data.invoiceId) ||
        data.profileId !== submitted.profileId ||
        typeof data.totalAmount !== 'string' ||
        !/^\d{1,19}$/.test(data.totalAmount) ||
        BigInt(data.totalAmount) <= 0n ||
        BigInt(data.totalAmount) > maxIrr ||
        (submitted.correction &&
          (data.invoiceId === submitted.correction.invoiceId ||
            data.originalInvoiceId !== submitted.correction.invoiceId ||
            data.kind !== submitted.correction.kind ||
            data.idempotencyKey !== submitted.idempotencyKey ||
            data.reason !== submitted.correction.reason ||
            data.amount !== submitted.correction.amount ||
            BigInt(data.totalAmount) !==
              (BigInt(submitted.correction.amount) < 0n
                ? -BigInt(submitted.correction.amount)
                : BigInt(submitted.correction.amount))))
      )
        throw new Error('Invalid response');
      setResult({
        invoiceId: data.invoiceId,
        totalAmount: submitted.correction ? submitted.correction.amount : data.totalAmount,
      });
      setError(null);
      unlock();
      return 'done';
    } catch {
      uncertain.current = true;
      setError('uncertain');
      return 'error';
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || result) return;
    if (!request.current) {
      if (!profileId || !calculation || !ready || (correction && !reason.trim())) {
        setError('invalid');
        return;
      }
      request.current = {
        profileId,
        lines: calculation.lines,
        idempotencyKey: crypto.randomUUID(),
        ...(correction
          ? {
              correction: {
                kind: correction.kind,
                invoiceId: correction.invoiceId,
                reason: reason.trim(),
                amount:
                  correction.kind === 'adjustment'
                    ? signed.toString()
                    : calculation.total.toString(),
              },
            }
          : {}),
      };
      setLocked(true);
    }
    busy.current = true;
    setActing(true);
    setError(null);
    try {
      if ((await send()) === 'step-up') {
        setPassword('');
        setStepError(null);
        setStepUp(true);
      }
    } finally {
      busy.current = false;
      setActing(false);
    }
  }
  function closeStepUp() {
    if (busy.current) return;
    setPassword('');
    setStepError(null);
    setStepUp(false);
    if (!uncertain.current) unlock();
    else setError('uncertain');
    submitButton.current?.focus();
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!password || busy.current) return;
    busy.current = true;
    setActing(true);
    setStepError(null);
    try {
      const response = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      setPassword('');
      if (!response.ok) {
        setStepError('verifyFailed');
        return;
      }
      const outcome = await send();
      if (outcome === 'step-up') {
        setStepError('verifyFailed');
        return;
      }
      setStepUp(false);
      submitButton.current?.focus();
    } catch {
      setPassword('');
      setStepError('verifyFailed');
    } finally {
      busy.current = false;
      setActing(false);
    }
  }
  function updateLine(id: string, field: keyof Omit<DraftLine, 'id'>, value: string) {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, [field]: value } : line))
    );
    setError(null);
  }

  if (result)
    return (
      <div className="mt-6 flex flex-col gap-4" role="status">
        <p>
          {text('created')} <strong>{numbers.money(result.totalAmount)}</strong>
        </p>
        <p>
          {text('reference')} <bdi>{result.invoiceId}</bdi>
        </p>
        {!correction && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setResult(null);
              setLines([blankLine()]);
              setProfileId(null);
            }}
          >
            {text('another')}
          </Button>
        )}
      </div>
    );

  return (
    <div className="mt-6 flex flex-col gap-6">
      {!correction && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!locked) {
              setQuery(search.trim());
              setRevision((value) => value + 1);
            }
          }}
        >
          <FieldGroup>
            <Field data-disabled={locked}>
              <FieldLabel htmlFor="manual-profile-search">{text('searchProfiles')}</FieldLabel>
              <Input
                id="manual-profile-search"
                maxLength={100}
                value={search}
                disabled={locked}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={locked || loading}>
              {loading ? text('loading') : text('search')}
            </Button>
          </FieldGroup>
        </form>
      )}
      {lookupError && (
        <Alert variant="destructive">
          <AlertDescription>
            {text(lookupError === 'denied' ? 'denied' : 'lookup')}
          </AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit} className="flex flex-col gap-6" aria-label={text('title')}>
        <FieldGroup>
          {!correction && (
            <Field
              data-disabled={locked || !ready}
              data-invalid={error === 'invalid' && !profileId}
            >
              <FieldLabel htmlFor="manual-profile">{text('profile')}</FieldLabel>
              <NativeSelect
                id="manual-profile"
                value={profileId ?? ''}
                onChange={(event) => setProfileId(event.target.value || null)}
                disabled={locked || !ready}
                className="w-full"
                aria-invalid={error === 'invalid' && !profileId}
                required
              >
                <NativeSelectOption value="" disabled>
                  {text('chooseProfile')}
                </NativeSelectOption>
                {profiles.map((profile) => (
                  <NativeSelectOption key={profile.id} value={profile.id}>
                    {profile.title || text('untitled')}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {ready && profiles.length === 0 && (
                <p className="text-sm text-muted-foreground">{text('noProfiles')}</p>
              )}
            </Field>
          )}
          {correction && (
            <Field data-disabled={locked}>
              <FieldLabel htmlFor="correction-reason">{text('reason')}</FieldLabel>
              <Input
                id="correction-reason"
                required
                maxLength={1000}
                disabled={locked}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          {correction?.kind === 'adjustment' && (
            <Field data-disabled={locked}>
              <FieldLabel htmlFor="correction-amount">{text('amount')}</FieldLabel>
              <Input
                id="correction-amount"
                required
                dir="ltr"
                inputMode="text"
                maxLength={20}
                disabled={locked}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-describedby="correction-amount-hint"
              />
              <p id="correction-amount-hint" className="text-sm text-muted-foreground">
                {text('amountHint')}
              </p>
            </Field>
          )}
          {correction?.kind !== 'adjustment' &&
            lines.map((line, index) => (
              <FieldSet key={line.id} disabled={locked} className="rounded-md border p-4">
                <FieldLegend>
                  {text('line')} {numbers.number(index + 1)}
                </FieldLegend>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`manual-description-${line.id}`}>
                      {text('lineDescription')}
                    </FieldLabel>
                    <Input
                      id={`manual-description-${line.id}`}
                      required
                      maxLength={1000}
                      value={line.description}
                      onChange={(event) => updateLine(line.id, 'description', event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`manual-quantity-${line.id}`}>
                      {text('quantity')}
                    </FieldLabel>
                    <Input
                      id={`manual-quantity-${line.id}`}
                      required
                      inputMode="numeric"
                      dir="ltr"
                      maxLength={10}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.id, 'quantity', event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`manual-price-${line.id}`}>{text('unitPrice')}</FieldLabel>
                    <Input
                      id={`manual-price-${line.id}`}
                      required
                      inputMode="numeric"
                      dir="ltr"
                      maxLength={19}
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.id, 'unitPrice', event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`manual-vat-${line.id}`}>{text('vat')}</FieldLabel>
                    <Input
                      id={`manual-vat-${line.id}`}
                      required
                      inputMode="decimal"
                      dir="ltr"
                      maxLength={6}
                      value={line.vat}
                      onChange={(event) => updateLine(line.id, 'vat', event.target.value)}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked || lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((item) => item.id !== line.id))
                    }
                    aria-label={`${text('removeLine')} ${numbers.number(index + 1)}`}
                  >
                    {text('removeLine')}
                  </Button>
                </FieldGroup>
              </FieldSet>
            ))}
        </FieldGroup>
        {correction?.kind !== 'adjustment' && (
          <Button
            type="button"
            variant="outline"
            disabled={locked || lines.length >= 100}
            onClick={() => setLines((current) => [...current, blankLine()])}
          >
            {text('addLine')}
          </Button>
        )}
        <p aria-live="polite">
          {text('total')}{' '}
          <strong>
            {calculation
              ? numbers.money(correction?.kind === 'adjustment' ? signed : calculation.total)
              : text('incomplete')}
          </strong>
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{text(error)}</AlertDescription>
          </Alert>
        )}
        <Button
          ref={submitButton}
          type="submit"
          className={correction ? 'hover:bg-primary' : undefined}
          disabled={
            acting ||
            stepUp ||
            (!locked &&
              (!ready || !profileId || !calculation || Boolean(correction && !reason.trim())))
          }
        >
          {acting ? text('issuing') : locked ? text('retry') : text('issue')}
        </Button>
      </form>
      <Dialog
        open={stepUp}
        onOpenChange={(open) => {
          if (!open) closeStepUp();
        }}
      >
        <DialogContent showCloseButton={false} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{text('verifyTitle')}</DialogTitle>
            <DialogDescription>{text('verifyDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={verify} className="flex flex-col gap-4">
            <FieldGroup>
              <Field data-invalid={Boolean(stepError)} data-disabled={acting}>
                <FieldLabel htmlFor="manual-step-password">{text('password')}</FieldLabel>
                <Input
                  id="manual-step-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  disabled={acting}
                  aria-invalid={Boolean(stepError)}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
            </FieldGroup>
            {stepError && (
              <Alert variant="destructive">
                <AlertDescription>{text(stepError)}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeStepUp} disabled={acting}>
                {text('cancel')}
              </Button>
              <Button type="submit" disabled={acting || !password}>
                {text('verify')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
