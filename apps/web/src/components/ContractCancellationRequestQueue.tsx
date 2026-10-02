import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, ListPage, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { ContractDetailLoader } from './ContractDetailLoader.js';
import type { CancellationRequest } from './ContractCancellationRequestPanel.js';

type QueueProps = { service?: 'savings'; onOpenSavingOrder?: (id: string) => void };
export function ContractCancellationRequestQueue(props: QueueProps = {}) {
  return <CancellationQueue key={props.service ?? 'all'} {...props} />;
}
function CancellationQueue({ service, onOpenSavingOrder }: QueueProps) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [rows, setRows] = useState<CancellationRequest[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null);
  const [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false);
  const generation = useRef(0);
  const accessDenied = useRef(false);
  useEffect(
    () => () => {
      ++generation.current;
    },
    []
  );
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
        if (
          !Array.isArray(page.requests) ||
          (page.nextBefore !== null && typeof page.nextBefore !== 'string')
        )
          throw new Error('Invalid cancellation queue');
        accessDenied.current = false;
        setDenied(false);
        setRows((old) =>
          cursor
            ? [
                ...old.map((row) => page.requests.find((item) => item.id === row.id) ?? row),
                ...page.requests.filter((row) => !old.some((item) => item.id === row.id)),
              ]
            : page.requests
        );
        setNext(page.nextBefore);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof DocumentRequestError && [401, 403].includes(e.status)) {
          accessDenied.current = true;
          ++generation.current;
          setDenied(true);
          setRows([]);
          setNext(null);
          setSelected(null);
        } else setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, reload, service]);
  function refresh() {
    setCursor(null);
    setNext(null);
    setReload((n) => n + 1);
  }
  const selectedGeneration = generation.current;
  if (denied) return null;
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={word('cancellationRequestQueue')}
    >
      <ListPage>
        <ListPage.Toolbar>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{word('cancellationRequestQueue')}</h2>
            <Button variant="ghost" disabled={loading} onClick={refresh}>
              {word('refresh')}
            </Button>
          </div>
        </ListPage.Toolbar>
        {selected ? (
          <ContractDetailLoader
            key={selected}
            id={selected}
            staff
            onClose={() => {
              if (selectedGeneration === generation.current) {
                ++generation.current;
                setSelected(null);
              }
            }}
            onChanged={() => {
              if (!accessDenied.current && selectedGeneration === generation.current) refresh();
            }}
          />
        ) : null}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!rows.length}
          retainContent={!!rows.length}
          loadingView={<PageLoading label={word('loading')} />}
          errorView={
            <Alert variant="destructive">
              <AlertDescription>{word('cancellationRequestQueueError')}</AlertDescription>
              <Button type="button" variant="outline" onClick={() => setReload((n) => n + 1)}>
                {word('retry')}
              </Button>
            </Alert>
          }
          emptyView={<p>{word('cancellationRequestQueueEmpty')}</p>}
        >
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
                    if (accessDenied.current) return;
                    if (selected !== row.contractId) {
                      ++generation.current;
                      setSelected(row.contractId);
                    }
                    if (row.savingOrderId) onOpenSavingOrder?.(row.savingOrderId);
                  }}
                >
                  {word('cancellationRequestOpen')}
                </Button>
              </li>
            ))}
          </ul>
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!next && !error}
          loading={loading}
          label={word('cancellationRequestQueuePages')}
          nextLabel={word('next')}
          onNext={() => {
            if (next) setCursor(next);
          }}
        />
      </ListPage>
    </section>
  );
}
