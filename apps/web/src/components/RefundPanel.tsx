import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import {
  Button,
  Card,
  CardContent,
  FinancialReviewSummary,
  Input,
  Label,
  StatusBadge,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

interface InvoiceBalance {
  invoiceId: string;
  profileId: string;
  state: string;
  paidAmount: string;
  refundedAmount: string;
  reservedAmount: string;
  availableAmount: string;
  requestable: boolean;
}
interface WalletRefund {
  id: string;
  invoiceId: string;
  amount: string;
  state: string;
  destination: 'wallet' | 'external_bank';
  bankReference: string | null;
  reconciliationStatus: string | null;
  approvalRequestId: string | null;
  retry: { nextAttemptAt: string | null; exhausted: boolean } | null;
}
interface RefundPage {
  invoice: InvoiceBalance;
  refunds: WalletRefund[];
  nextBefore: string | null;
}

function validAmount(value: string, available: string): boolean {
  if (!/^\d{1,19}$/.test(value) || !/^\d{1,19}$/.test(available)) return false;
  const amount = BigInt(value);
  return amount > 0n && amount <= BigInt(available) && amount <= 9223372036854775807n;
}

function validPage(
  value: unknown,
  invoiceId: string,
  destination: 'wallet' | 'external_bank'
): value is RefundPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as RefundPage;
  const invoice = page.invoice;
  return (
    invoice?.invoiceId === invoiceId &&
    typeof invoice.profileId === 'string' &&
    typeof invoice.state === 'string' &&
    ['paidAmount', 'refundedAmount', 'reservedAmount', 'availableAmount'].every((key) =>
      /^\d{1,19}$/.test(invoice[key as keyof InvoiceBalance] as string)
    ) &&
    typeof invoice.requestable === 'boolean' &&
    Array.isArray(page.refunds) &&
    page.refunds.every(
      (refund) =>
        typeof refund.id === 'string' &&
        refund.invoiceId === invoiceId &&
        refund.destination === destination &&
        /^\d{1,19}$/.test(refund.amount) &&
        typeof refund.state === 'string' &&
        (refund.bankReference === null || typeof refund.bankReference === 'string') &&
        (refund.reconciliationStatus === null || typeof refund.reconciliationStatus === 'string') &&
        (refund.approvalRequestId === null || typeof refund.approvalRequestId === 'string')
    ) &&
    (page.nextBefore === null || typeof page.nextBefore === 'string')
  );
}

const externalKeys = new Set([
  'title',
  'description',
  'request',
  'confirmRequest',
  'requests',
  'empty',
  'bankReference',
  'recordedReference',
  'record-transfer',
  'reconcile',
  'secondReviewer',
]);

export function RefundPanel({
  destination,
  selectedInvoiceId = '',
}: {
  destination: 'wallet' | 'external_bank';
  selectedInvoiceId?: string;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const word = (key: string) =>
    t(
      `admin.invoices.${destination === 'external_bank' && externalKeys.has(key) ? 'externalRefunds' : 'walletRefunds'}.${key}`,
      locale
    );
  const path = destination === 'wallet' ? 'wallet-refunds' : 'external-refunds';
  const fieldPrefix = destination === 'wallet' ? 'wallet-refund' : 'external-refund';
  const [input, setInput] = useState(selectedInvoiceId);
  const [invoiceId, setInvoiceId] = useState(
    isInvoiceUuid(selectedInvoiceId) ? selectedInvoiceId : ''
  );
  const [invoice, setInvoice] = useState<InvoiceBalance | null>(null);
  const [refunds, setRefunds] = useState<WalletRefund[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'denied'>('idle');
  const [invalidId, setInvalidId] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [action, setAction] = useState<TeamAction | null>(null);
  const [actionSummary, setActionSummary] = useState<React.ReactNode>(null);

  useEffect(() => {
    if (!isInvoiceUuid(selectedInvoiceId)) return;
    setInput(selectedInvoiceId);
    setInvoiceId(selectedInvoiceId);
    setInvoice(null);
    setRefunds([]);
    setBefore(null);
    setRevision((value) => value + 1);
  }, [selectedInvoiceId]);

  useEffect(() => {
    if (!invoiceId) return;
    const controller = new AbortController();
    setStatus('loading');
    const url = `/api/admin/${path}?invoiceId=${encodeURIComponent(invoiceId)}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    void fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return null;
        if (response.status === 403) {
          setStatus('denied');
          return null;
        }
        if (!response.ok) throw new Error('Refunds unavailable');
        const data: unknown = await response.json();
        if (!validPage(data, invoiceId, destination)) throw new Error('Invalid refund page');
        return data;
      })
      .then((page) => {
        if (controller.signal.aborted || !page) return;
        setInvoice(page.invoice);
        setRefunds((current) => {
          if (!before) return page.refunds;
          const shown = new Set(current.map((refund) => refund.id));
          return [...current, ...page.refunds.filter((refund) => !shown.has(refund.id))];
        });
        setNextBefore(page.nextBefore);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [invoiceId, before, revision, destination, path]);

  function load(event: FormEvent) {
    event.preventDefault();
    const id = input.trim();
    if (!isInvoiceUuid(id)) {
      setInvalidId(true);
      return;
    }
    setInvalidId(false);
    setInvoiceId(id);
    setInvoice(null);
    setRefunds([]);
    setBefore(null);
    setRevision((value) => value + 1);
  }

  function refresh() {
    setBefore(null);
    setRevision((value) => value + 1);
  }

  function request() {
    if (
      !invoice?.requestable ||
      !validAmount(amount, invoice.availableAmount) ||
      !reason.trim() ||
      reason.trim().length > 1000
    )
      return;
    const requestedAmount = BigInt(amount).toString();
    const requestedReason = reason.trim();
    setAction({
      title: word('request'),
      description: word('confirmRequest'),
      path: `/api/admin/${path}`,
      method: 'POST',
      body: {
        invoiceId: invoice.invoiceId,
        amount: requestedAmount,
        reason: requestedReason,
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('forbidden'),
    });
    setActionSummary(
      <FinancialReviewSummary
        title={word('review')}
        rows={[
          { id: 'invoice', label: word('invoiceId'), value: invoice.invoiceId },
          { id: 'paid', label: word('paid'), value: numbers.money(invoice.paidAmount) },
          { id: 'refunded', label: word('refunded'), value: numbers.money(invoice.refundedAmount) },
          { id: 'reserved', label: word('reserved'), value: numbers.money(invoice.reservedAmount) },
          { id: 'reason', label: word('reason'), value: requestedReason },
        ]}
        total={{ label: word('requestAmount'), value: numbers.money(requestedAmount) }}
      />
    );
  }

  function decide(
    refund: WalletRefund,
    operation: 'approve' | 'reject' | 'cancel' | 'process' | 'record-transfer' | 'reconcile'
  ) {
    const decisionReason = reasons[refund.id]?.trim();
    const bankReference = references[refund.id]?.trim();
    const submittedReason =
      operation === 'reject' || operation === 'cancel' ? decisionReason : undefined;
    if ((operation === 'reject' || operation === 'cancel') && !decisionReason) return;
    if ((operation === 'record-transfer' || operation === 'reconcile') && !bankReference) return;
    setAction({
      title: word(operation),
      description: word('confirmDecision'),
      path: `/api/admin/${path}/${encodeURIComponent(refund.id)}/${operation}`,
      method: 'POST',
      body:
        operation === 'record-transfer' || operation === 'reconcile'
          ? { bankReference }
          : submittedReason
            ? { reason: submittedReason }
            : {},
      conflictMessage: word('conflict'),
      forbiddenMessage: word('forbidden'),
    });
    setActionSummary(
      <FinancialReviewSummary
        title={word('review')}
        rows={[
          { id: 'invoice', label: word('invoiceId'), value: refund.invoiceId },
          { id: 'state', label: word('state'), value: word(`state.${refund.state}`) },
          ...(submittedReason
            ? [{ id: 'reason', label: word('reason'), value: submittedReason }]
            : []),
          ...(bankReference && (operation === 'record-transfer' || operation === 'reconcile')
            ? [{ id: 'bank', label: word('bankReference'), value: bankReference }]
            : []),
        ]}
        total={{ label: word('requestAmount'), value: numbers.money(refund.amount) }}
      />
    );
  }

  return (
    <section
      id={destination === 'wallet' ? 'wallet-refunds-panel' : 'external-refunds-panel'}
      className="space-y-4 rounded-xl border bg-card p-5"
      aria-label={word('title')}
    >
      <h2 className="text-lg font-semibold">{word('title')}</h2>
      <p className="text-sm text-muted-foreground">{word('description')}</p>
      <form onSubmit={load} className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor={`${fieldPrefix}-invoice`}>{word('invoiceId')}</Label>
          <Input
            id={`${fieldPrefix}-invoice`}
            dir="ltr"
            value={input}
            aria-invalid={invalidId}
            onChange={(event) => {
              setInput(event.target.value);
              setInvalidId(false);
            }}
          />
        </div>
        <Button type="submit">{word('load')}</Button>
      </form>
      {invalidId && <p role="alert">{word('invalidInvoiceId')}</p>}
      {status === 'loading' && <p role="status">{word('loading')}</p>}
      {status === 'error' && <p role="alert">{word('error')}</p>}
      {status === 'denied' && <p role="alert">{word('forbidden')}</p>}
      {invoice && status === 'ready' && (
        <>
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              <p>
                {word('state')}: {appText(`invoices.state.${invoice.state}`, locale)}
              </p>
              <p>
                {word('paid')}: {numbers.money(invoice.paidAmount)}
              </p>
              <p>
                {word('refunded')}: {numbers.money(invoice.refundedAmount)}
              </p>
              <p>
                {word('reserved')}: {numbers.money(invoice.reservedAmount)}
              </p>
              <p className="font-semibold">
                {word('available')}: {numbers.money(invoice.availableAmount)}
              </p>
            </CardContent>
          </Card>
          {invoice.requestable && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-amount`}>{word('requestAmount')}</Label>
                <Input
                  id={`${fieldPrefix}-amount`}
                  dir="ltr"
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) => setAmount(normalizeProfileDigits(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-reason`}>{word('reason')}</Label>
                <Input
                  id={`${fieldPrefix}-reason`}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <Button
                disabled={!validAmount(amount, invoice.availableAmount) || !reason.trim()}
                onClick={request}
              >
                {word('request')}
              </Button>
            </div>
          )}
          {!invoice.requestable && <p role="status">{word('notRequestable')}</p>}
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">{word('requests')}</h3>
            <Button variant="outline" onClick={refresh}>
              {word('refresh')}
            </Button>
          </div>
          {refunds.length === 0 && status === 'ready' && <p>{word('empty')}</p>}
          <ul className="space-y-3">
            {refunds.map((refund) => (
              <li key={refund.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{numbers.money(refund.amount)}</strong>
                  <StatusBadge label={word(`state.${refund.state}`)} />
                </div>
                <p className="break-all text-xs text-muted-foreground">{refund.id}</p>
                {destination === 'external_bank' && refund.bankReference && (
                  <p className="break-all text-sm">
                    {word('recordedReference')}: {refund.bankReference}
                  </p>
                )}
                {refund.approvalRequestId && (
                  <a
                    className="text-primary underline"
                    href={`/admin/approval-requests?requestId=${encodeURIComponent(refund.approvalRequestId)}`}
                  >
                    {word('approval')}
                  </a>
                )}
                {(refund.state === 'Requested' || refund.state === 'Approved') && (
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldPrefix}-reason-${refund.id}`}>
                      {word('decisionReason')}
                    </Label>
                    <Input
                      id={`${fieldPrefix}-reason-${refund.id}`}
                      maxLength={1000}
                      value={reasons[refund.id] ?? ''}
                      onChange={(event) =>
                        setReasons((current) => ({ ...current, [refund.id]: event.target.value }))
                      }
                    />
                  </div>
                )}
                {destination === 'external_bank' &&
                  (refund.state === 'Approved' || refund.state === 'Processing') && (
                    <div className="space-y-2">
                      <Label htmlFor={`refund-bank-reference-${refund.id}`}>
                        {word('bankReference')}
                      </Label>
                      <Input
                        id={`refund-bank-reference-${refund.id}`}
                        dir="ltr"
                        maxLength={200}
                        value={references[refund.id] ?? ''}
                        onChange={(event) =>
                          setReferences((current) => ({
                            ...current,
                            [refund.id]: event.target.value,
                          }))
                        }
                      />
                      {refund.state === 'Processing' && (
                        <p className="text-sm text-muted-foreground">{word('secondReviewer')}</p>
                      )}
                    </div>
                  )}
                <div className="flex flex-wrap gap-2">
                  {refund.state === 'Requested' && (
                    <Button variant="outline" onClick={() => decide(refund, 'approve')}>
                      {word('approve')}
                    </Button>
                  )}
                  {refund.state === 'Requested' && (
                    <Button
                      variant="outline"
                      disabled={!reasons[refund.id]?.trim()}
                      onClick={() => decide(refund, 'reject')}
                    >
                      {word('reject')}
                    </Button>
                  )}
                  {(refund.state === 'Requested' || refund.state === 'Approved') && (
                    <Button
                      variant="outline"
                      disabled={!reasons[refund.id]?.trim()}
                      onClick={() => decide(refund, 'cancel')}
                    >
                      {word('cancel')}
                    </Button>
                  )}
                  {destination === 'wallet' && ['Approved', 'Failed'].includes(refund.state) && (
                    <Button variant="outline" onClick={() => decide(refund, 'process')}>
                      {word('process')}
                    </Button>
                  )}
                  {destination === 'external_bank' && refund.state === 'Approved' && (
                    <Button
                      variant="outline"
                      disabled={!references[refund.id]?.trim()}
                      onClick={() => decide(refund, 'record-transfer')}
                    >
                      {word('record-transfer')}
                    </Button>
                  )}
                  {destination === 'external_bank' && refund.state === 'Processing' && (
                    <Button
                      variant="outline"
                      disabled={references[refund.id]?.trim() !== refund.bankReference}
                      onClick={() => decide(refund, 'reconcile')}
                    >
                      {word('reconcile')}
                    </Button>
                  )}
                </div>
                {destination === 'wallet' && refund.state === 'Failed' && (
                  <p role="status">
                    {refund.retry?.exhausted ? word('retryExhausted') : word('retryScheduled')}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {nextBefore && (
            <Button variant="outline" onClick={() => setBefore(nextBefore)}>
              {word('more')}
            </Button>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          summary={actionSummary}
          onClose={() => {
            setAction(null);
            setActionSummary(null);
          }}
          onSuccess={async () => {
            setAmount('');
            setReason('');
            setReferences({});
            refresh();
          }}
        />
      )}
    </section>
  );
}
