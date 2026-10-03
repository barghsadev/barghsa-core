import { tInvoiceCorrections as tc } from '@barghsa/i18n/invoice-corrections';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
} from 'react';
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
  DynamicFieldArray,
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FinancialReviewSummary,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@barghsa/ui';
import { tManualInvoice as t } from '@barghsa/i18n/manual-invoice';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  type InvoiceAdjustmentReview,
  type InvoiceReplacementReview,
  type ManualInvoiceReview,
} from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { useInvoiceDraftForm } from '../hooks/useInvoiceDraftForm.js';
import {
  blankInvoiceLine as blankLine,
  invoiceDigits as digits,
  calculateInvoiceDraft as calculate,
  maxInvoiceIrr as maxIrr,
  type InvoiceDraftLine as DraftLine,
} from '../lib/invoice-draft.js';
import {
  RefundFieldFeedback as InvoiceFieldFeedback,
  RefundFormAlert as InvoiceFormAlert,
} from './RefundFormFeedback.js';
import { invoiceFinancialReviewRows } from './InvoiceFinancialReviewRows.js';

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
    expectedReviewHash?: string;
  };
  profileId: string;
  idempotencyKey: string;
  expectedReviewHash?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    vatRate: number;
    isTaxable: boolean;
  }>;
}
export default function ManualInvoiceForm({
  correction,
}: {
  correction?: InvoiceCorrectionSource & {
    kind: 'replacement' | 'adjustment';
    onLocked: (value: boolean) => void;
    onDenied?: () => void;
    unavailable?: boolean;
  };
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const unavailable = Boolean(correction?.unavailable);
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
  const draft = useInvoiceDraftForm(correction?.kind ?? 'manual', () => {
    const lines = correction?.lines.length
      ? correction.lines.map((line) => ({
          id: crypto.randomUUID(),
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: line.unitPrice,
          vat: line.isTaxable ? String(line.vatRate / 100) : '0',
        }))
      : [blankLine()];
    return {
      profileId: correction?.profileId ?? '',
      reason: '',
      amount: '',
      lineOrder: lines.map((line) => line.id),
      lines: Object.fromEntries(lines.map((line) => [line.id, line])),
    };
  });
  const [reason, setReason] = draft.field('reason'),
    [amount, setAmount] = draft.field('amount');
  const [profileId, setProfileId] = draft.field('profileId');
  const lines = draft.values.lineOrder.map((id) => draft.values.lines[id]!);
  const setLines: Dispatch<SetStateAction<DraftLine[]>> = (update) => {
    if (busy.current || locked || unavailable) return;
    const next = typeof update === 'function' ? update(lines) : update;
    const removed = lines.filter((line) => !next.some((value) => value.id === line.id));
    for (const line of removed) draft.form.unregister(`lines.${line.id}`);
    draft.form.setValue(
      'lineOrder',
      next.map((line) => line.id),
      { shouldDirty: true }
    );
    draft.form.setValue('lines', Object.fromEntries(next.map((line) => [line.id, line])), {
      shouldDirty: true,
      shouldValidate: draft.form.formState.isSubmitted,
    });
  };
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0),
    [profiles, setProfiles] = useState<Profile[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(!correction),
    [ready, setReady] = useState(Boolean(correction));
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null),
    [acting, setActing] = useState(false);
  const live = useRef(false);
  const reviewController = useRef<AbortController | null>(null);
  const submittedLineIds = useRef<string[]>([]);
  const submittedTotal = useRef('0');
  const [accessDenied, setAccessDenied] = useState(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      reviewController.current?.abort();
      request.current = null;
      correction?.onLocked(false);
    };
  }, []);
  const busy = useRef(false),
    request = useRef<InvoiceRequest | null>(null),
    uncertain = useRef(false);
  const [locked, setLocked] = useState(false),
    [stepUp, setStepUp] = useState(false);
  const [password, setPassword] = useState(''),
    [stepError, setStepError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invoiceId: string; totalAmount: string } | null>(null);
  const [approval, setApproval] = useState<{ id: string; amount: string } | null>(null);
  const [adjustmentReview, setAdjustmentReview] = useState<InvoiceAdjustmentReview | null>(null);
  const [replacementReview, setReplacementReview] = useState<InvoiceReplacementReview | null>(null);
  const [manualReview, setManualReview] = useState<ManualInvoiceReview | null>(null);
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
  const lineError = [draft.errors.lines?.message, draft.errors.lines?.root?.message].find(
    (message): message is string => typeof message === 'string'
  );

  function changeLock(value: boolean) {
    setLocked(value);
    correction?.onLocked(value);
  }

  const sourceFingerprint = correction
    ? JSON.stringify({
        invoiceId: correction.invoiceId,
        profileId: correction.profileId,
        state: correction.state,
        paidAmount: correction.paidAmount,
        totalAmount: correction.totalAmount,
        lines: correction.lines,
      })
    : null;
  const acceptedSource = useRef(sourceFingerprint);
  useEffect(() => {
    if (acceptedSource.current === sourceFingerprint) return;
    acceptedSource.current = sourceFingerprint;
    if (!request.current || uncertain.current) return;
    unlock();
    setStepUp(false);
    setPassword('');
    setError('conflict');
  }, [sourceFingerprint]);

  useEffect(() => {
    if (correction) return;
    const abort = new AbortController();
    setLoading(true);
    setLookupError(null);
    if (!before) {
      setReady(false);
    }
    const params = new URLSearchParams({ search: query });
    if (before) params.set('before', before);
    void fetch(`/api/admin/invoices/manual/profiles?${params}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(response.status === 403 || response.status === 401 ? 'denied' : 'lookup');
        const data = (await response.json()) as {
          items?: Profile[];
          nextBefore?: string | null;
        };
        if (
          !Array.isArray(data.items) ||
          data.items.some((item) => typeof item.id !== 'string' || typeof item.title !== 'string')
        )
          throw new Error('lookup');
        if (!abort.signal.aborted) {
          if (!before && !data.items.some((item) => item.id === draft.form.getValues('profileId')))
            setProfileId('');
          setProfiles((current) => {
            if (!before) return data.items!;
            const shown = new Set(current.map((profile) => profile.id));
            return [...current, ...data.items!.filter((profile) => !shown.has(profile.id))];
          });
          setNextBefore(data.nextBefore ?? null);
          setReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          if (cause instanceof Error && cause.message === 'denied') {
            denyWork();
            return;
          }
          setLookupError(cause instanceof Error ? cause.message : 'lookup');
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [query, revision, correction, before]);

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
    reviewController.current?.abort();
    submittedLineIds.current = [];
    request.current = null;
    uncertain.current = false;
    changeLock(false);
    setAdjustmentReview(null);
    setReplacementReview(null);
    setManualReview(null);
  }
  function publicFields(status: number, value: unknown): unknown[] | null {
    if (status !== 400 || !value || typeof value !== 'object') return null;
    const error = (value as { error?: unknown }).error;
    if (!error || typeof error !== 'object') return null;
    const item = error as { code?: unknown; fields?: unknown };
    return item.code === 'VALIDATION:INPUT:INVALID' && Array.isArray(item.fields)
      ? item.fields
      : null;
  }
  function denyWork() {
    unlock();
    setStepUp(false);
    setPassword('');
    setProfiles([]);
    setNextBefore(null);
    setReady(false);
    const line = blankLine();
    draft.form.reset({
      profileId: '',
      reason: '',
      amount: '',
      lineOrder: [line.id],
      lines: { [line.id]: line },
    });
    setAccessDenied(true);
    correction?.onDenied?.();
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
              ? {
                  lines: submitted.lines,
                  expectedReviewHash: submitted.correction.expectedReviewHash,
                }
              : {
                  amount: submitted.correction.amount,
                  expectedReviewHash: submitted.correction.expectedReviewHash,
                }),
          }
        : submitted;
      const response = await fetch(path, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        error?: unknown;
        invoiceId?: string;
        profileId?: string;
        totalAmount?: string;
        state?: string;
        originalInvoiceId?: string;
        kind?: string;
        amount?: string;
        idempotencyKey?: string;
        reason?: string;
        status?: string;
        approvalRequestId?: string;
      };
      if (!live.current || request.current !== submitted) return 'error';
      if (response.status === 403 && authErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code)
        return 'step-up';
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          denyWork();
          return 'error';
        }
        const fields = publicFields(response.status, data);
        if (
          !uncertain.current &&
          fields &&
          draft.applyServerErrors(fields, submittedLineIds.current)
        ) {
          setError(null);
          unlock();
          return 'error';
        }
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
      if (response.status === 202) {
        if (
          submitted.correction?.kind !== 'adjustment' ||
          data.status !== 'pending_approval' ||
          typeof data.approvalRequestId !== 'string' ||
          !isInvoiceUuid(data.approvalRequestId) ||
          data.originalInvoiceId !== submitted.correction.invoiceId ||
          data.kind !== 'adjustment' ||
          data.idempotencyKey !== submitted.idempotencyKey ||
          data.reason !== submitted.correction.reason ||
          data.amount !== submitted.correction.amount
        )
          throw new Error('Invalid pending approval response');
        setApproval({ id: data.approvalRequestId, amount: submitted.correction.amount });
        setError(null);
        unlock();
        return 'done';
      }
      if (
        typeof data.invoiceId !== 'string' ||
        !isInvoiceUuid(data.invoiceId) ||
        data.profileId !== submitted.profileId ||
        typeof data.totalAmount !== 'string' ||
        !/^\d{1,19}$/.test(data.totalAmount) ||
        BigInt(data.totalAmount) <= 0n ||
        BigInt(data.totalAmount) > maxIrr ||
        (!submitted.correction &&
          (![
            'Unpaid',
            'PaymentUnderReview',
            'PartiallyFunded',
            'Paid',
            'Overdue',
            'Cancelled',
            'PartiallyRefunded',
            'Refunded',
          ].includes(data.state ?? '') ||
            BigInt(data.totalAmount) !== BigInt(submittedTotal.current))) ||
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
      if (!live.current || request.current !== submitted) return 'error';
      uncertain.current = true;
      setError('uncertain');
      return 'error';
    }
  }
  async function resume() {
    const submitted = request.current;
    if (!submitted || !live.current) return;
    const owns = () => live.current && request.current === submitted;
    const correctionCommand = submitted.correction;
    if (
      !(correctionCommand ? correctionCommand.expectedReviewHash : submitted.expectedReviewHash)
    ) {
      const controller = new AbortController();
      reviewController.current = controller;
      try {
        const response = await fetch(
          correctionCommand
            ? `/api/admin/invoices/${encodeURIComponent(correctionCommand.invoiceId)}/corrections/review`
            : '/api/admin/invoices/manual/review',
          {
            method: 'POST',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            signal: controller.signal,
            body: JSON.stringify(
              correctionCommand
                ? {
                    kind: correctionCommand.kind,
                    reason: correctionCommand.reason,
                    ...(correctionCommand.kind === 'replacement'
                      ? { lines: submitted.lines }
                      : { amount: correctionCommand.amount }),
                  }
                : submitted
            ),
          }
        );
        const value: unknown = await response.json();
        if (!owns()) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) {
            denyWork();
            return;
          }
          const fields = publicFields(response.status, value);
          if (!(fields && draft.applyServerErrors(fields, submittedLineIds.current)))
            setError(
              response.status === 409
                ? 'conflict'
                : response.status >= 500
                  ? 'reviewFailed'
                  : 'invalid'
            );
          unlock();
          return;
        }
        const {
          parseManualInvoiceReview,
          parseInvoiceAdjustmentReview,
          parseInvoiceReplacementReview,
        } = await import('@barghsa/shared/finance/invoices');
        if (!owns()) return;
        if (!correctionCommand) {
          const review = parseManualInvoiceReview(value);
          if (
            !review ||
            review.scope.profileId !== submitted.profileId ||
            review.scope.resourceId !== submitted.idempotencyKey ||
            review.data.contractId !== null ||
            review.data.totals.total !== submittedTotal.current ||
            review.data.lines.length !== submitted.lines.length ||
            review.data.lines.some((line, index) => {
              const original = submitted.lines[index]!;
              return (
                line.description !== original.description ||
                line.quantity !== original.quantity ||
                line.unitPrice !== original.unitPrice ||
                line.vatRate !== original.vatRate ||
                line.isTaxable !== original.isTaxable
              );
            })
          )
            throw Error('Invalid manual invoice review');
          submitted.expectedReviewHash = review.hash;
          setManualReview(review);
        } else if (correctionCommand.kind === 'replacement') {
          const review = parseInvoiceReplacementReview(value);
          if (
            !review ||
            review.scope.resourceId !== correctionCommand.invoiceId ||
            review.scope.profileId !== submitted.profileId ||
            review.data.replacement.reason !== correctionCommand.reason ||
            review.data.replacement.totals.total !== correctionCommand.amount ||
            review.data.replacement.lines.length !== submitted.lines.length ||
            review.data.replacement.lines.some((line, index) => {
              const original = submitted.lines[index]!;
              return (
                line.description !== original.description ||
                line.quantity !== original.quantity ||
                line.unitPrice !== original.unitPrice ||
                line.vatRate !== original.vatRate ||
                line.taxable !== original.isTaxable
              );
            })
          )
            throw Error('Invalid replacement review');
          correctionCommand.expectedReviewHash = review.hash;
          setReplacementReview(review);
        } else {
          const review = parseInvoiceAdjustmentReview(value);
          if (
            !review ||
            review.scope.resourceId !== correctionCommand.invoiceId ||
            review.scope.profileId !== submitted.profileId ||
            review.data.adjustment.amount !== correctionCommand.amount ||
            review.data.adjustment.reason !== correctionCommand.reason
          )
            throw Error('Invalid adjustment review');
          correctionCommand.expectedReviewHash = review.hash;
          setAdjustmentReview(review);
        }
      } catch {
        if (!owns()) return;
        setError('reviewFailed');
        unlock();
      }
      return;
    }
    if ((await send()) === 'step-up' && owns()) {
      setPassword('');
      setStepError(null);
      setStepUp(true);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      busy.current ||
      result ||
      approval ||
      accessDenied ||
      (!request.current && (!ready || loading || lookupError || unavailable))
    )
      return;
    busy.current = true;
    setActing(true);
    changeLock(true);
    setError(null);
    try {
      if (request.current) {
        await resume();
        return;
      }
      await draft.form.handleSubmit(async (values) => {
        if (!live.current) return;
        const rows = values.lineOrder.map((id) => values.lines[id]!);
        const calculated = correction?.kind === 'adjustment' ? null : calculate(rows);
        const value =
          correction?.kind === 'adjustment' ? BigInt(digits(values.amount)) : calculated!.total;
        submittedTotal.current = (value < 0n ? -value : value).toString();
        submittedLineIds.current = [...values.lineOrder];
        request.current = {
          profileId: values.profileId.trim().toLowerCase(),
          lines: calculated?.lines ?? [],
          idempotencyKey: crypto.randomUUID(),
          ...(correction
            ? {
                correction: {
                  kind: correction.kind,
                  invoiceId: correction.invoiceId,
                  reason: values.reason.trim(),
                  amount: value.toString(),
                },
              }
            : {}),
        };
        await resume();
      })();
      if (live.current && !request.current) changeLock(false);
    } finally {
      if (live.current) {
        busy.current = false;
        setActing(false);
      }
    }
  }
  async function confirmCorrectionReview() {
    if (
      busy.current ||
      unavailable ||
      !live.current ||
      !request.current ||
      (!adjustmentReview && !replacementReview)
    )
      return;
    setAdjustmentReview(null);
    setReplacementReview(null);
    busy.current = true;
    setActing(true);
    try {
      if ((await send()) === 'step-up') {
        setPassword('');
        setStepError(null);
        setStepUp(true);
      }
    } finally {
      if (live.current) {
        busy.current = false;
        setActing(false);
      }
    }
  }
  async function confirmManualReview() {
    if (busy.current || unavailable || !live.current || !request.current || !manualReview) return;
    setManualReview(null);
    busy.current = true;
    setActing(true);
    try {
      if ((await send()) === 'step-up') {
        setPassword('');
        setStepError(null);
        setStepUp(true);
      }
    } finally {
      if (live.current) {
        busy.current = false;
        setActing(false);
      }
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
    if (!password || busy.current || unavailable || !request.current) return;
    const submitted = request.current;
    busy.current = true;
    setActing(true);
    setStepError(null);
    try {
      const response = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      if (!live.current || request.current !== submitted) return;
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
      if (live.current) {
        setStepUp(false);
        submitButton.current?.focus();
      }
    } catch {
      setPassword('');
      setStepError('verifyFailed');
    } finally {
      if (live.current) {
        busy.current = false;
        setActing(false);
      }
    }
  }
  function updateLine(id: string, field: keyof Omit<DraftLine, 'id'>, value: string) {
    const [, setValue] = draft.field(`lines.${id}.${field}`);
    setValue(value);
    if (lineError) void draft.form.trigger('lines');
    setError(null);
  }

  if (accessDenied) return <InvoiceFormAlert message={text('denied')} />;
  if (approval)
    return (
      <div className="mt-6 flex flex-col gap-4" role="status">
        <p>
          {text('pendingApproval')} <strong>{numbers.money(approval.amount)}</strong>
        </p>
        <p>
          {text('approvalReference')} <bdi>{approval.id}</bdi>
        </p>
        <a href="/admin/approval-requests" className="text-foreground underline underline-offset-4">
          {text('openApprovals')}
        </a>
      </div>
    );

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
              setProfileId('');
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
            if (!locked && !busy.current) {
              setBefore(null);
              setNextBefore(null);
              setQuery(search.trim());
              setRevision((value) => value + 1);
            }
          }}
        >
          <FieldGroup>
            <Field data-disabled={locked || unavailable}>
              <FieldLabel htmlFor="manual-profile-search">{text('searchProfiles')}</FieldLabel>
              <Input
                id="manual-profile-search"
                maxLength={100}
                value={search}
                disabled={locked || unavailable}
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
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-6"
        aria-label={text('title')}
        aria-busy={acting || draft.form.formState.isSubmitting || undefined}
      >
        <FieldGroup>
          {!correction && (
            <Field
              data-disabled={locked || !ready}
              data-invalid={error === 'invalid' && !profileId}
            >
              <FieldLabel htmlFor="manual-profile">{text('profile')}</FieldLabel>
              <NativeSelect
                id="manual-profile"
                {...draft.bind('profileId')}
                value={profileId ?? ''}
                onChange={(event) => setProfileId(event.target.value)}
                disabled={locked || !ready}
                className="w-full"
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
              <InvoiceFieldFeedback
                id={draft.errorId('profileId')}
                error={draft.errors.profileId}
                message={text('profileInvalid')}
              />
              {ready && profiles.length === 0 && (
                <p className="text-sm text-muted-foreground">{text('noProfiles')}</p>
              )}
              {nextBefore && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || loading}
                  onClick={() => {
                    setBefore(nextBefore);
                    setRevision((value) => value + 1);
                  }}
                >
                  {text('moreProfiles')}
                </Button>
              )}
            </Field>
          )}
          {correction && (
            <Field data-disabled={locked || unavailable}>
              <FieldLabel htmlFor="correction-reason">{text('reason')}</FieldLabel>
              <Input
                id="correction-reason"
                {...draft.bind('reason')}
                required
                maxLength={1000}
                disabled={locked || unavailable}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <InvoiceFieldFeedback
                id={draft.errorId('reason')}
                error={draft.errors.reason}
                message={text('reasonInvalid')}
              />
            </Field>
          )}
          {correction?.kind === 'adjustment' && (
            <Field data-disabled={locked || unavailable}>
              <FieldLabel htmlFor="correction-amount">{text('amount')}</FieldLabel>
              <Input
                id="correction-amount"
                {...draft.bind('amount')}
                required
                dir="ltr"
                inputMode="text"
                maxLength={20}
                disabled={locked || unavailable}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-describedby={[
                  'correction-amount-hint',
                  draft.errors.amount ? draft.errorId('amount') : undefined,
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
              <InvoiceFieldFeedback
                id={draft.errorId('amount')}
                error={draft.errors.amount}
                message={text('amountInvalid')}
              />
              <p id="correction-amount-hint" className="text-sm text-muted-foreground">
                {text('amountHint')}
              </p>
            </Field>
          )}
          {correction?.kind !== 'adjustment' && (
            <DynamicFieldArray
              value={lines}
              onChange={setLines}
              getItemKey={(line) => line.id}
              createItem={blankLine}
              addLabel={text('addLine')}
              removeLabel={(_, index) => `${text('removeLine')} ${numbers.number(index + 1)}`}
              moveUpLabel={(_, index) => `${text('moveLineUp')} ${numbers.number(index + 1)}`}
              moveDownLabel={(_, index) => `${text('moveLineDown')} ${numbers.number(index + 1)}`}
              minItems={1}
              maxItems={100}
              disabled={locked || unavailable}
              renderItem={(line, index, actions) => (
                <FieldSet disabled={locked || unavailable} className="rounded-md border p-4">
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
                        {...draft.bind(`lines.${line.id}.description`)}
                        required
                        maxLength={1000}
                        value={line.description}
                        onChange={(event) => updateLine(line.id, 'description', event.target.value)}
                      />
                      <InvoiceFieldFeedback
                        id={draft.errorId(`lines.${line.id}.description`)}
                        error={draft.errors.lines?.[line.id]?.description}
                        message={text('descriptionInvalid')}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`manual-quantity-${line.id}`}>
                        {text('quantity')}
                      </FieldLabel>
                      <Input
                        id={`manual-quantity-${line.id}`}
                        {...draft.bind(`lines.${line.id}.quantity`)}
                        required
                        inputMode="numeric"
                        dir="ltr"
                        maxLength={10}
                        value={line.quantity}
                        onChange={(event) => updateLine(line.id, 'quantity', event.target.value)}
                      />
                      <InvoiceFieldFeedback
                        id={draft.errorId(`lines.${line.id}.quantity`)}
                        error={draft.errors.lines?.[line.id]?.quantity}
                        message={text('quantityInvalid')}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`manual-price-${line.id}`}>
                        {text('unitPrice')}
                      </FieldLabel>
                      <Input
                        id={`manual-price-${line.id}`}
                        {...draft.bind(`lines.${line.id}.unitPrice`)}
                        required
                        inputMode="numeric"
                        dir="ltr"
                        maxLength={19}
                        value={line.unitPrice}
                        onChange={(event) => updateLine(line.id, 'unitPrice', event.target.value)}
                      />
                      <InvoiceFieldFeedback
                        id={draft.errorId(`lines.${line.id}.unitPrice`)}
                        error={draft.errors.lines?.[line.id]?.unitPrice}
                        message={text('priceInvalid')}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`manual-vat-${line.id}`}>{text('vat')}</FieldLabel>
                      <Input
                        id={`manual-vat-${line.id}`}
                        {...draft.bind(`lines.${line.id}.vat`)}
                        required
                        inputMode="decimal"
                        dir="ltr"
                        maxLength={6}
                        value={line.vat}
                        onChange={(event) => updateLine(line.id, 'vat', event.target.value)}
                      />
                      <InvoiceFieldFeedback
                        id={draft.errorId(`lines.${line.id}.vat`)}
                        error={draft.errors.lines?.[line.id]?.vat}
                        message={text('vatInvalid')}
                      />
                    </Field>
                    {actions}
                  </FieldGroup>
                </FieldSet>
              )}
            />
          )}
        </FieldGroup>
        <p aria-live="polite">
          {text('total')}{' '}
          <strong>
            {calculation
              ? numbers.money(correction?.kind === 'adjustment' ? signed : calculation.total)
              : text('incomplete')}
          </strong>
        </p>
        <InvoiceFormAlert message={draft.errors.root?.validation?.message ?? lineError} />
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
            draft.form.formState.isSubmitting ||
            stepUp ||
            (!locked && (!ready || !!lookupError || unavailable))
          }
        >
          {acting && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {acting ? text('issuing') : locked ? text('retry') : text('issue')}
        </Button>
      </form>
      <Dialog
        open={Boolean(manualReview)}
        onOpenChange={(open) => {
          if (!open && !acting) unlock();
        }}
      >
        <DialogContent
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{text('manualReviewTitle')}</DialogTitle>
            <DialogDescription>{text('manualReviewDescription')}</DialogDescription>
          </DialogHeader>
          {manualReview && (
            <FinancialReviewSummary
              title={text('manualReviewTitle')}
              rows={[
                {
                  id: 'profile',
                  label: text('profile'),
                  value: `${manualReview.data.profile.title} · ${manualReview.data.profile.id}`,
                },
                ...manualReview.data.lines.map((line, index) => ({
                  id: `line-${index}`,
                  label: `${text('line')} ${numbers.number(index + 1)} · ${line.description}`,
                  value: (
                    <span className="flex flex-col gap-1">
                      <span>
                        {numbers.number(line.quantity)} × {numbers.money(line.unitPrice)}
                      </span>
                      <span>
                        {text('manualReviewSubtotal')}: {numbers.money(line.lineTotal)}
                      </span>
                      <span>
                        {text('manualReviewVat')}: {numbers.money(line.vatAmount)}
                      </span>
                    </span>
                  ),
                })),
                {
                  id: 'subtotal',
                  label: text('manualReviewSubtotal'),
                  value: numbers.money(manualReview.data.totals.subtotal),
                },
                {
                  id: 'vat',
                  label: text('manualReviewVat'),
                  value: numbers.money(manualReview.data.totals.vat),
                },
                {
                  id: 'due',
                  label: text('manualReviewDueRule'),
                  value: `${numbers.number(manualReview.data.dueRule.configDays)} ${text('manualReviewDueDays')}`,
                },
              ]}
              total={{ label: text('total'), value: numbers.money(manualReview.data.totals.total) }}
              notice={text('manualReviewOutcome')}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={unlock}
              disabled={acting || unavailable}
            >
              {text('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void confirmManualReview()}
              disabled={acting || unavailable}
            >
              {text('manualReviewConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(adjustmentReview)}
        onOpenChange={(open) => {
          if (!open && !acting) unlock();
        }}
      >
        <DialogContent
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{text('reviewTitle')}</DialogTitle>
            <DialogDescription>{text('reviewDescription')}</DialogDescription>
          </DialogHeader>
          {adjustmentReview && (
            <FinancialReviewSummary
              title={text('reviewTitle')}
              rows={[
                ...invoiceFinancialReviewRows(adjustmentReview.data, locale, numbers, (value) =>
                  new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(value))
                ),
                {
                  id: 'direction',
                  label: text('reviewDirection'),
                  value: text(
                    adjustmentReview.data.adjustment.direction === 'charge'
                      ? 'reviewCharge'
                      : 'reviewCredit'
                  ),
                },
                {
                  id: 'reason',
                  label: text('reason'),
                  value: adjustmentReview.data.adjustment.reason,
                },
                {
                  id: 'approval',
                  label: text('reviewApproval'),
                  value: text(
                    adjustmentReview.data.adjustment.approvalRequired
                      ? 'reviewApprovalRequired'
                      : 'reviewApprovalNotRequired'
                  ),
                },
              ]}
              total={{
                label: text('amount'),
                value: numbers.money(adjustmentReview.data.adjustment.absoluteAmount),
              }}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={unlock}
              disabled={acting || unavailable}
            >
              {text('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void confirmCorrectionReview()}
              disabled={acting || unavailable}
            >
              {text('reviewConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(replacementReview)}
        onOpenChange={(open) => {
          if (!open && !acting) unlock();
        }}
      >
        <DialogContent
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{text('replacementReviewTitle')}</DialogTitle>
            <DialogDescription>{text('replacementReviewDescription')}</DialogDescription>
          </DialogHeader>
          {replacementReview && (
            <FinancialReviewSummary
              title={text('replacementReviewTitle')}
              rows={[
                ...invoiceFinancialReviewRows(replacementReview.data, locale, numbers, (value) =>
                  new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(value))
                ),
                ...replacementReview.data.replacement.lines.map((line, index) => ({
                  id: `replacement-${index}`,
                  label: `${text('replacementReviewLine')} ${numbers.number(index + 1)} · ${line.description}`,
                  value: (
                    <span className="flex flex-col gap-1">
                      <span>
                        {numbers.number(line.quantity)} × {numbers.money(line.unitPrice)}
                      </span>
                      <span>
                        {text('replacementReviewSubtotal')}: {numbers.money(line.subtotal)}
                      </span>
                      <span>
                        {text('replacementReviewVat')}: {numbers.money(line.vatAmount)}
                      </span>
                    </span>
                  ),
                })),
                {
                  id: 'replacement-due-rule',
                  label: text('replacementReviewDueRule'),
                  value:
                    replacementReview.data.replacement.dueRule.configDays === null
                      ? text('replacementReviewDueAtIssue')
                      : `${numbers.number(replacementReview.data.replacement.dueRule.configDays)} ${text('replacementReviewDueDays')}`,
                },
                {
                  id: 'replacement-reason',
                  label: text('reason'),
                  value: replacementReview.data.replacement.reason,
                },
              ]}
              total={{
                label: text('total'),
                value: numbers.money(replacementReview.data.replacement.totals.total),
              }}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={unlock}
              disabled={acting || unavailable}
            >
              {text('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void confirmCorrectionReview()}
              disabled={acting || unavailable}
            >
              {text('replacementReviewConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
              <Field data-invalid={Boolean(stepError)} data-disabled={acting || unavailable}>
                <FieldLabel htmlFor="manual-step-password">{text('password')}</FieldLabel>
                <Input
                  id="manual-step-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  disabled={acting || unavailable}
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
              <Button
                type="button"
                variant="outline"
                onClick={closeStepUp}
                disabled={acting || unavailable}
              >
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
