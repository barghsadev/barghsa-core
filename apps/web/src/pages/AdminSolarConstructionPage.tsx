import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { tSolar } from '@barghsa/i18n/solar';
import { Button, Input, Label, ListPage, Textarea } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import type { SolarProgress } from '../lib/solar-progress.js';
import { withCsrf } from '../lib/csrf.js';
import { SolarStageProgress } from '../components/SolarStageProgress.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
interface Row {
  requestId: string;
  contractId: string;
  contractNumber: string;
  submittedAt: string;
  contractState: string;
  stage: string | null;
  revision: number;
}
export function AdminSolarConstructionPage({
  queries,
  selected,
  onSelect,
}: {
  queries: ListQueryBinding;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [queue, setQueue] = useState<{
    items: Row[];
    nextBefore: string | null;
    search: string;
    key: string;
  } | null>(null);
  const [queueState, setQueueState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [queueRevision, setQueueRevision] = useState(0);
  const [progress, setProgress] = useState<SolarProgress | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error' | 'denied'>(
    'loading'
  );
  const [detailRevision, setDetailRevision] = useState(0);
  const [note, setNote] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const accessDenied = useRef(false);
  const q = queries.query.search,
    before = queries.query.cursor;
  const queueKey = JSON.stringify([q, before]);
  const currentSelection = useRef(selected);
  currentSelection.current = selected;
  const currentQuery = useRef(queueKey);
  currentQuery.current = queueKey;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  function invalidate() {
    generation.current += 1;
    setAction(null);
    setPreparing(false);
    setSaveError(false);
  }
  function deny() {
    accessDenied.current = true;
    invalidate();
    setNote('');
    setProgress(null);
    setQueue(null);
    setDetailState('denied');
    setQueueState('denied');
  }
  useEffect(() => {
    const abort = new AbortController();
    if (accessDenied.current) return () => abort.abort();
    invalidate();
    setQueueState('loading');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (before) params.set('before', before);
    void fetch(`/api/admin/solar/construction?${params}`, {
      credentials: 'include',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (response.status === 401 || response.status === 403) {
          deny();
          return;
        }
        if (!response.ok) throw new Error('queue');
        const result = (await response.json()) as { items: Row[]; nextBefore: string | null };
        if (!abort.signal.aborted && !accessDenied.current) {
          setQueue({ ...result, search: q, key: queueKey });
          setQueueState('ready');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted && !accessDenied.current) setQueueState('error');
      });
    return () => abort.abort();
  }, [q, before, queueRevision]);
  useEffect(() => {
    const abort = new AbortController();
    if (accessDenied.current) return () => abort.abort();
    invalidate();
    setNote('');
    setProgress(null);
    setDetailState('loading');
    if (!selected) return () => abort.abort();
    void fetch(`/api/admin/solar/construction/${encodeURIComponent(selected)}`, {
      credentials: 'include',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (abort.signal.aborted || accessDenied.current) return;
        if (response.status === 401 || response.status === 403) {
          deny();
          return;
        }
        if (!response.ok) throw new Error('detail');
        const result = (await response.json()) as SolarProgress;
        if (!abort.signal.aborted && !accessDenied.current) {
          setProgress(result);
          setDetailState('ready');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted && !accessDenied.current) setDetailState('error');
      });
    return () => abort.abort();
  }, [selected, detailRevision]);
  async function review(event: FormEvent) {
    event.preventDefault();
    if (!progress?.canRecord || !progress.nextMilestone || preparing || !note.trim()) return;
    const id = selected!,
      token = ++generation.current,
      key = queueKey;
    const command = {
      stage: progress.nextMilestone,
      note: note.trim(),
      expectedRevision: progress.revision,
      operationId: crypto.randomUUID(),
    };
    setPreparing(true);
    setSaveError(false);
    try {
      const response = await fetch(
        `/api/admin/solar/construction/${encodeURIComponent(id)}/review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(command),
        }
      );
      if (
        !mounted.current ||
        generation.current !== token ||
        currentSelection.current !== id ||
        currentQuery.current !== key
      )
        return;
      if (response.status === 401 || response.status === 403) {
        deny();
        return;
      }
      if (!response.ok) throw new Error('review');
      const result = (await response.json()) as { hash: string };
      if (
        !mounted.current ||
        generation.current !== token ||
        currentSelection.current !== id ||
        currentQuery.current !== key
      )
        return;
      setAction({
        title: copy('constructionReviewTitle'),
        description: copy('constructionReviewDescription'),
        path: `/api/admin/solar/construction/${encodeURIComponent(id)}`,
        method: 'POST',
        successStatus: 200,
        body: { ...command, expectedReviewHash: result.hash },
        conflictMessage: copy('constructionConflict'),
      });
    } catch {
      if (mounted.current && generation.current === token) setSaveError(true);
    } finally {
      if (mounted.current && generation.current === token) setPreparing(false);
    }
  }
  // Route changes immediately hide old details even before their fetch cleanup runs.
  const visible = progress?.requestId === selected ? progress : null;
  const rows = queue?.search === q && queueState !== 'denied' ? queue.items : [];
  const fresh = queue?.key === queueKey && queueState === 'ready';
  const command = action?.body as { stage: string; note: string } | undefined;
  return (
    <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-3xl font-semibold">{copy('constructionStaffTitle')}</h1>
        <p className="mt-2 text-muted-foreground">{copy('constructionStaffDescription')}</p>
      </header>
      {time.notice}
      <ListPage>
        <ListPage.Toolbar
          search={
            <div className="max-w-md space-y-2">
              <Label htmlFor="solar-construction-search">{copy('constructionSearch')}</Label>
              <Input
                id="solar-construction-search"
                value={queries.searchInput}
                onChange={(event) => queries.setSearchInput(event.target.value)}
              />
            </div>
          }
        />
        <ListPage.Content
          loading={queueState === 'loading'}
          error={queueState === 'error' || queueState === 'denied'}
          empty={!rows.length}
          retainContent={!!rows.length}
          loadingView={<p role="status">{copy('loading')}</p>}
          errorView={
            <div className="space-y-2">
              <p role="alert">
                {copy(queueState === 'denied' ? 'staffQueueForbidden' : 'staffQueueLoadError')}
              </p>
              {queueState !== 'denied' && (
                <Button variant="outline" onClick={() => setQueueRevision((v) => v + 1)}>
                  {copy('retry')}
                </Button>
              )}
            </div>
          }
          emptyView={<p>{copy('constructionEmpty')}</p>}
        >
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <li key={row.requestId}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full min-w-0 flex-col items-start gap-2 whitespace-normal p-4 text-start"
                  aria-pressed={selected === row.requestId}
                  onClick={() => {
                    invalidate();
                    setNote('');
                    setProgress(null);
                    onSelect(row.requestId);
                  }}
                >
                  <span>
                    {copy('solarViewContract')}: <bdi>{row.contractNumber}</bdi>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {row.stage ? copy(`construction_${row.stage}`) : copy('constructionNoUpdates')}
                  </span>
                  <span className="text-xs text-muted-foreground break-all">
                    <bdi>{row.requestId}</bdi>
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={row.submittedAt}>
                    {time.format(row.submittedAt, { dateStyle: 'medium' })}
                  </time>
                </Button>
              </li>
            ))}
          </ul>
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          loading={queueState === 'loading'}
          hasMore={fresh && !!queue?.nextBefore && queries.canAdvance(queue.nextBefore)}
          label={copy('constructionStaffTitle')}
          nextLabel={copy('moreRequests')}
          onNext={() => {
            invalidate();
            if (queue?.nextBefore) queries.next(queue.nextBefore);
          }}
          previous={{
            enabled: queries.hasPrevious,
            label: copy('previous'),
            onClick: () => {
              invalidate();
              queries.previous();
            },
          }}
        />
      </ListPage>
      {!selected && <p>{copy('constructionSelect')}</p>}
      {selected && !visible && (
        <div className="space-y-2">
          <p role={detailState === 'loading' ? 'status' : 'alert'}>
            {copy(
              detailState === 'loading'
                ? 'loading'
                : detailState === 'denied'
                  ? 'staffQueueForbidden'
                  : 'constructionDetailError'
            )}
          </p>
          {detailState === 'error' && (
            <Button variant="outline" onClick={() => setDetailRevision((v) => v + 1)}>
              {copy('retry')}
            </Button>
          )}
        </div>
      )}
      {visible && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {visible.contractId && (
              <Link
                className="underline"
                to="/admin/contracts/$contractId"
                params={{ contractId: visible.contractId }}
              >
                {copy('solarViewContract')}
              </Link>
            )}
            <Button
              variant="outline"
              onClick={() => {
                invalidate();
                setDetailRevision((v) => v + 1);
              }}
            >
              {copy('constructionReload')}
            </Button>
          </div>
          <SolarStageProgress progress={visible} showTimeNotice={false} />
          {visible.canRecord && visible.nextMilestone ? (
            <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={review}>
              <h2 className="text-lg font-semibold">
                {copy(`construction_${visible.nextMilestone}`)}
              </h2>
              <div className="space-y-2">
                <Label htmlFor="solar-construction-note">{copy('constructionNote')}</Label>
                <Textarea
                  id="solar-construction-note"
                  value={note}
                  onChange={(event) => {
                    invalidate();
                    setNote(event.target.value);
                  }}
                  required
                  maxLength={1000}
                  disabled={preparing || !!action}
                  aria-describedby="solar-construction-note-help"
                />
                <p id="solar-construction-note-help" className="text-sm text-muted-foreground">
                  {copy('constructionNoteHelp')}
                </p>
              </div>
              {saveError && <p role="alert">{copy('constructionSaveError')}</p>}
              <Button type="submit" loading={preparing} disabled={!note.trim() || !!action}>
                {copy('constructionReview')}
              </Button>
            </form>
          ) : (
            <p role="status">
              {copy(visible.revision === 3 ? 'constructionDone' : 'constructionBlocked')}
            </p>
          )}
        </>
      )}
      {action && visible && (
        <TeamActionDialog
          action={action}
          onClose={invalidate}
          onDenied={deny}
          onSuccess={async (result) => {
            setProgress(result as SolarProgress);
            setNote('');
            setSaveError(false);
            setQueueRevision((v) => v + 1);
          }}
          summary={
            <div className="space-y-2 rounded-md border p-4">
              <p className="font-medium">{copy(`construction_${command!.stage}`)}</p>
              <p className="whitespace-pre-wrap break-words">{command!.note}</p>
            </div>
          }
        />
      )}
    </div>
  );
}
