import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  Input,
  PageLoading,
  StatusBadge,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
interface Obligation {
  id: string;
  contractId: string;
  invoiceId: string;
  amount: string;
  destination: string;
  state: string;
  bankReference: string | null;
  nextAttemptAt: string | null;
  exhausted: boolean;
  orderId: string | null;
}
export function ContractRefundQueue() {
  useEffect(() => {
    if (window.location.hash === '#refund-obligations')
      document.getElementById('refund-obligations')?.scrollIntoView();
  }, []);
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [rows, setRows] = useState<Obligation[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false);
  const [references, setReferences] = useState<Record<string, string>>({}),
    [invalid, setInvalid] = useState<string | null>(null),
    [action, setAction] = useState<TeamAction | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void documentRequest<{ obligations: Obligation[]; nextBefore: string | null }>(
      `/api/admin/wallet-refunds/contract-obligations${cursor ? '?before=' + encodeURIComponent(cursor) : ''}`,
      { signal: controller.signal }
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setRows((old) =>
          cursor
            ? [
                ...old,
                ...page.obligations.filter(
                  (row) => !old.some((existing) => existing.id === row.id)
                ),
              ]
            : page.obligations
        );
        setNext(page.nextBefore);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof DocumentRequestError && e.status === 403) setDenied(true);
        else setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, reload]);
  function refresh() {
    setCursor(null);
    setReload((n) => n + 1);
    setReferences({});
    setInvalid(null);
  }
  function choose(row: Obligation, command: 'process' | 'record-transfer' | 'reconcile') {
    const bankReference = command === 'reconcile' ? row.bankReference : references[row.id]?.trim();
    if (command !== 'process' && (!bankReference || bankReference.length > 200)) {
      setInvalid(row.id);
      return;
    }
    setInvalid(null);
    setAction({
      title: word('cancellation.queue.' + command),
      description: word(
        command === 'reconcile'
          ? 'cancellationQueueReconcileNotice'
          : 'cancellationQueueRetryNotice'
      ),
      path: `/api/admin/${row.destination === 'wallet' ? 'wallet-refunds' : 'external-refunds'}/${row.id}/${command}`,
      method: 'POST',
      body: command === 'process' ? {} : { bankReference },
      conflictMessage: word('cancellationConflict'),
      forbiddenMessage: word('denied'),
    });
  }
  if (denied) return null;
  return (
    <section
      id="refund-obligations"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={word('cancellationQueue')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{word('cancellationQueue')}</h2>
        <Button variant="ghost" disabled={loading} onClick={refresh}>
          {word('refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{word('cancellationQueueNotice')}</p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : null}
      {loading && rows.length === 0 ? (
        <PageLoading label={word('loading')} />
      ) : !error && rows.length === 0 ? (
        <p>{word('cancellationQueueEmpty')}</p>
      ) : null}
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                <bdi>{new Intl.NumberFormat(locale).format(BigInt(row.amount))}</bdi> {word('irr')}{' '}
                · {word('cancellation.' + row.destination)}
              </p>
              <StatusBadge label={word('cancellation.refund.' + row.state)} />
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {word('cancellationQueueContract')}: <bdi>{row.contractId}</bdi>
            </p>
            {row.orderId ? (
              <p className="break-all text-xs text-muted-foreground">
                {t('electricity.order.success.order', locale)}: <bdi>{row.orderId}</bdi>
              </p>
            ) : null}
            <p className="break-all text-xs text-muted-foreground">
              {word('cancellationInvoice')}: <bdi>{row.invoiceId}</bdi>
            </p>
            {row.destination === 'wallet' && row.state === 'Failed' ? (
              row.exhausted ? (
                <>
                  <p className="text-sm">{word('cancellationQueueExhausted')}</p>
                  <Button
                    variant="outline"
                    className="self-start"
                    onClick={() => choose(row, 'process')}
                  >
                    {word('cancellation.queue.process')}
                  </Button>
                </>
              ) : (
                <p className="text-sm">{word('cancellationQueueScheduled')}</p>
              )
            ) : null}
            {row.destination === 'external_bank' && row.state === 'Approved' ? (
              <>
                <Field>
                  <FieldLabel htmlFor={'bank-return-' + row.id}>
                    {word('cancellationBankReference')}
                  </FieldLabel>
                  <Input
                    id={'bank-return-' + row.id}
                    dir="ltr"
                    maxLength={200}
                    value={references[row.id] ?? ''}
                    onChange={(e) => setReferences((old) => ({ ...old, [row.id]: e.target.value }))}
                  />
                </Field>
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() => choose(row, 'record-transfer')}
                >
                  {word('cancellation.queue.record-transfer')}
                </Button>
              </>
            ) : null}
            {row.destination === 'external_bank' && row.state === 'Processing' ? (
              <>
                <p className="text-sm">
                  {word('cancellationBankReference')}: <bdi>{row.bankReference}</bdi>
                </p>
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() => choose(row, 'reconcile')}
                >
                  {word('cancellation.queue.reconcile')}
                </Button>
              </>
            ) : null}
            {invalid === row.id ? (
              <p role="alert">{word('cancellationBankReferenceRequired')}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {next ? (
        <Button variant="outline" disabled={loading} onClick={() => setCursor(next)}>
          {word('next')}
        </Button>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}
