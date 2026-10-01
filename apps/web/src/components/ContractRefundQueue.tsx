import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  Input,
  ListPage,
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
  const acceptedRows = useRef<Obligation[]>([]);
  const selected = useRef<Obligation | null>(null);
  const accessDenied = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      ++generation.current;
    },
    []
  );
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
        if (
          !Array.isArray(page.obligations) ||
          (page.nextBefore !== null && typeof page.nextBefore !== 'string')
        )
          throw new Error('Invalid refund queue');
        const old = acceptedRows.current;
        const items = cursor
          ? [
              ...old.map((row) => page.obligations.find((item) => item.id === row.id) ?? row),
              ...page.obligations.filter((row) => !old.some((existing) => existing.id === row.id)),
            ]
          : page.obligations;
        if (
          selected.current &&
          !items.some((row) => JSON.stringify(row) === JSON.stringify(selected.current))
        )
          clearAction();
        acceptedRows.current = items;
        accessDenied.current = false;
        setDenied(false);
        setRows(items);
        setNext(page.nextBefore);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof DocumentRequestError && [401, 403].includes(e.status)) {
          accessDenied.current = true;
          acceptedRows.current = [];
          clearAction();
          setRows([]);
          setNext(null);
          setReferences({});
          setInvalid(null);
          setDenied(true);
        } else setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, reload]);
  function refresh() {
    setCursor(null);
    setNext(null);
    setReload((n) => n + 1);
  }
  function clearAction() {
    ++generation.current;
    selected.current = null;
    setAction(null);
  }
  function choose(row: Obligation, command: 'process' | 'record-transfer' | 'reconcile') {
    if (
      loading ||
      error ||
      accessDenied.current ||
      !(command === 'process'
        ? row.destination === 'wallet' && row.state === 'Failed' && row.exhausted
        : row.destination === 'external_bank' &&
          row.state === (command === 'record-transfer' ? 'Approved' : 'Processing'))
    )
      return;
    const bankReference = command === 'reconcile' ? row.bankReference : references[row.id]?.trim();
    if (command !== 'process' && (!bankReference || bankReference.length > 200)) {
      setInvalid(row.id);
      return;
    }
    setInvalid(null);
    ++generation.current;
    selected.current = row;
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
  const actionGeneration = generation.current;
  if (denied) return null;
  return (
    <section
      id="refund-obligations"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={word('cancellationQueue')}
    >
      <ListPage>
        <ListPage.Toolbar>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{word('cancellationQueue')}</h2>
            <Button variant="ghost" disabled={loading} onClick={refresh}>
              {word('refresh')}
            </Button>
          </div>
        </ListPage.Toolbar>
        <p className="text-sm text-muted-foreground">{word('cancellationQueueNotice')}</p>
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!rows.length}
          retainContent={!!rows.length}
          loadingView={<PageLoading label={word('loading')} />}
          errorView={
            <Alert variant="destructive">
              <AlertDescription>{word('cancellationQueueError')}</AlertDescription>
              <Button type="button" variant="outline" onClick={() => setReload((n) => n + 1)}>
                {word('retry')}
              </Button>
            </Alert>
          }
          emptyView={<p>{word('cancellationQueueEmpty')}</p>}
        >
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    <bdi>{new Intl.NumberFormat(locale).format(BigInt(row.amount))}</bdi>{' '}
                    {word('irr')} · {word('cancellation.' + row.destination)}
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
                        disabled={loading || error}
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
                        onChange={(e) =>
                          setReferences((old) => ({ ...old, [row.id]: e.target.value }))
                        }
                      />
                    </Field>
                    <Button
                      variant="outline"
                      className="self-start"
                      disabled={loading || error}
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
                      disabled={loading || error}
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
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!next && !error}
          loading={loading}
          label={word('cancellationQueuePages')}
          nextLabel={word('next')}
          onNext={() => {
            if (next) setCursor(next);
          }}
        />
      </ListPage>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => {
            if (actionGeneration === generation.current) clearAction();
          }}
          onSuccess={async () => {
            if (accessDenied.current || actionGeneration !== generation.current) return;
            const id = selected.current?.id;
            clearAction();
            if (id)
              setReferences((old) => {
                const next = { ...old };
                delete next[id];
                return next;
              });
            setInvalid(null);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}
