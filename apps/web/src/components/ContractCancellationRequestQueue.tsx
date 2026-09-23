import { useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { ContractDetail } from './ContractDetail.js';
import type { CancellationRequest } from './ContractCancellationRequestPanel.js';

export function ContractCancellationRequestQueue({
  service,
  onOpenSavingOrder,
}: {
  service?: 'savings';
  onOpenSavingOrder?: (id: string) => void;
} = {}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [rows, setRows] = useState<CancellationRequest[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null);
  const [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const query = new URLSearchParams({
      ...(cursor ? { before: cursor } : {}),
      ...(service ? { service } : {}),
    }).toString();
    void documentRequest<{ requests: CancellationRequest[]; nextBefore: string | null }>(
      `/api/admin/contract-cancellation-requests${query ? '?' + query : ''}`,
      { signal: controller.signal }
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setRows((old) =>
          cursor
            ? [...old, ...page.requests.filter((row) => !old.some((item) => item.id === row.id))]
            : page.requests
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
  }, [cursor, reload, service]);
  function refresh() {
    setCursor(null);
    setReload((n) => n + 1);
  }
  if (denied) return null;
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={word('cancellationRequestQueue')}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{word('cancellationRequestQueue')}</h2>
        <Button variant="ghost" disabled={loading} onClick={refresh}>
          {word('refresh')}
        </Button>
      </div>
      {selected ? (
        <ContractDetail
          key={selected}
          id={selected}
          staff
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : null}
      {loading && !rows.length ? (
        <PageLoading label={word('loading')} />
      ) : !error && !rows.length ? (
        <p>{word('cancellationRequestQueueEmpty')}</p>
      ) : null}
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3">
            {row.savingOrderId ? (
              <p className="text-sm font-medium">
                {row.customerName} · {row.planTitle?.[locale]} · <bdi>{row.billIdentifier}</bdi>
              </p>
            ) : null}
            <p className="break-all text-xs text-muted-foreground">
              {word('cancellationQueueContract')}: <bdi>{row.contractId}</bdi>
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">{row.reason}</p>
            <p className="text-sm">
              {word('cancellationRequestPreference')}:{' '}
              {word('cancellation.' + row.preferredDestination)}
            </p>
            {row.stale ? <p className="text-sm">{word('cancellationRequestStale')}</p> : null}
            <Button
              variant="outline"
              className="self-start"
              onClick={() => {
                setSelected(row.contractId);
                if (row.savingOrderId) onOpenSavingOrder?.(row.savingOrderId);
              }}
            >
              {word('cancellationRequestOpen')}
            </Button>
          </li>
        ))}
      </ul>
      {next ? (
        <Button variant="outline" disabled={loading} onClick={() => setCursor(next)}>
          {word('next')}
        </Button>
      ) : null}
    </section>
  );
}
