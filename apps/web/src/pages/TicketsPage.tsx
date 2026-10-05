import { TicketIntakeForm } from '../components/TicketIntakeForm.js';
import { TicketStaffForms } from '../components/TicketStaffForms.js';
import { useTicketCommand } from '../hooks/useTicketCommand.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import {
  ticketRecord,
  ticketAssignmentOptions,
  ticketReplyReceipt,
  ticketStatusReceipt,
  type TicketCommand,
  type TicketOwner,
} from '../lib/ticket-form.js';
import { TicketReplyInput } from '../components/TicketReplyInput.js';
import { FilePreview } from '../components/FilePreview.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { Button, Input, Label, ListPage, ListViewToggle } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import type { SupportListQuery } from '../lib/support-list-query.js';
import { useListView } from '../hooks/useListView.js';
import {
  TicketQueueRecords,
  RelatedTicketRecord,
  TicketStatusBadge,
  TicketPriorityBadge,
  type Ticket,
  type TicketStatus,
} from '../components/TicketQueueRecords.js';
import { TicketCommentThread, type TicketComment } from '../components/TicketCommentThread.js';
import { documentUrl } from '../lib/documents.js';
import { ProfileClosureReview } from '../components/ProfileClosureReview.js';

function safeAttachmentUrl(value: string) {
  try {
    return documentUrl(value);
  } catch {
    return null;
  }
}

interface Queue {
  responseTargetHours?: number | null;
  data: Ticket[];
  totalPages: number;
  viewer?: {
    userId: string;
    canWrite: boolean;
    canAssignOthers: boolean;
    canApproveClosure?: boolean;
  };
}
const statuses: TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_customer',
  'waiting_staff',
  'resolved',
  'closed',
];
export function CustomerTicketsPage({ queries }: { queries?: SupportListQuery } = {}) {
  return <Tickets staff={false} {...(queries ? { queries } : {})} />;
}
export function StaffTicketsPage({ queries }: { queries?: SupportListQuery } = {}) {
  return <Tickets staff {...(queries ? { queries } : {})} />;
}
function Tickets({ staff, queries }: { staff: boolean; queries?: SupportListQuery }) {
  const queryRef = useRef(queries);
  queryRef.current = queries;
  const time = useAccountTime(),
    { view, setView } = useListView(staff ? 'staff-tickets' : 'customer-tickets'),
    locale = useLocale(),
    prefix = staff ? '/api/staff/tickets' : '/api/tickets',
    actor = useAccountUser(),
    profileRevision = useProfileContextRevision();
  const routeSearch = useSearch({ strict: false }) as {
      ticketId?: string;
      status?: 'active';
      scope?: 'active';
    },
    activeScoped = !staff && routeSearch.scope === 'active',
    text = (key: string) => t('tickets.' + key, locale);
  const generation = useRef(0),
    detailGeneration = useRef(0),
    heading = useRef<HTMLHeadingElement>(null),
    queueDenied = useRef(false);
  const [queue, setQueue] = useState<Queue | null>(null),
    [loading, setLoading] = useState(true),
    [queueError, setQueueError] = useState(''),
    [acceptedContext, setAcceptedContext] = useState(''),
    [acceptedPage, setAcceptedPage] = useState(1),
    [acceptedIdentity, setAcceptedIdentity] = useState(''),
    [queueAccessDenied, setQueueAccessDenied] = useState(false);
  const [localPage, setLocalPage] = useState(1),
    [localFilter, setLocalFilter] = useState(routeSearch.status === 'active' ? 'active' : ''),
    [localSearch, setLocalSearch] = useState(''),
    [localTerm, setTerm] = useState(''),
    [localSort, setLocalSort] = useState('desc'),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const page = queries?.queue.query.page ?? localPage,
    filter = queries?.queue.query.filters.status ?? localFilter,
    search = queries?.queue.searchInput ?? localSearch,
    term = queries?.queue.query.search ?? localTerm,
    sort = queries?.queue.query.order ?? localSort;
  const setPage = (value: number, replace = false) => {
    if (commandRef.current.coordination.isLocked()) return;
    if (queryRef.current) queryRef.current.queue.setQuery({ page: value }, replace);
    else setLocalPage(value);
  };
  const setFilter = (value: string) => {
    if (commandRef.current.coordination.isLocked()) return;
    if (queries) queries.queue.setQuery({ filters: { status: value } });
    else setLocalFilter(value);
  };
  const setSearch = (value: string) => {
    if (commandRef.current.coordination.isLocked()) return;
    if (queries) queries.queue.setSearchInput(value);
    else setLocalSearch(value);
  };
  const setSort = (value: string) => {
    if (commandRef.current.coordination.isLocked()) return;
    if (queries) queries.queue.setQuery({ order: value === 'asc' ? 'asc' : 'desc' });
    else setLocalSort(value);
  };
  const [loadedDetail, setDetail] = useState<Ticket | null>(null),
    [comments, setComments] = useState<TicketComment[]>([]),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState(''),
    [selectedId, setSelectedId] = useState(''),
    [detailIdentity, setDetailIdentity] = useState('');

  const [replyDrafts, setReplyDrafts] = useState({ public: '', internal: '' }),
    [internal, setInternal] = useState(false),
    [teams, setTeams] = useState<{ id: string; name: string; members: string[] }[]>([]),
    [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]),
    [assignmentError, setAssignmentError] = useState(''),
    [assignmentLoading, setAssignmentLoading] = useState(false),
    [assignmentVersion, setAssignmentVersion] = useState(0),
    [creating, setCreating] = useState(false),
    [editorRevision, setEditorRevision] = useState(0);
  const reply = replyDrafts[internal ? 'internal' : 'public'],
    setReply = (v: string, visibility?: 'public' | 'internal') =>
      setReplyDrafts((d) => ({ ...d, [visibility ?? (internal ? 'internal' : 'public')]: v })),
    selectedLink = queries ? queries.selected : routeSearch.ticketId;
  const identity = JSON.stringify([actor, profileRevision, prefix]),
    identityRef = useRef(identity);
  identityRef.current = identity;
  const detail =
    detailIdentity === identity && (!queries || loadedDetail?.id === queries.selected)
      ? loadedDetail
      : null;
  const scope = JSON.stringify([identity, editorRevision, selectedLink ?? null, selectedId]),
    scopeRef = useRef(scope);
  scopeRef.current = scope;
  const authority = useRef<(owner: TicketOwner) => boolean>(() => false);
  authority.current = (owner) => {
    if (!actor || queueDenied.current) return false;
    if (owner === 'intake') return !staff && !queueAccessDenied;
    if (!detail) return false;
    if (owner === 'reopen') return !staff;
    if (owner === 'assignment') return staff && !!queue?.viewer?.canAssignOthers;
    if (owner === 'closure') return staff && !!queue?.viewer?.canApproveClosure;
    if (owner === 'reply-internal' || owner === 'status') {
      if (!staff) return false;
    }
    return (
      !staff ||
      !!(queue?.viewer?.canWrite && (queue.viewer.canAssignOthers || detail.assignedTo === actor))
    );
  };
  const command = useTicketCommand(
    scope,
    () => {
      ++generation.current;
      queueDenied.current = true;
      setQueueAccessDenied(true);
      setQueue(null);
      discardDetail();
      setCreating(false);
      setReplyDrafts({ public: '', internal: '' });
      setEditorRevision((v) => v + 1);
      setSaved(false);
    },
    (owner) => authority.current(owner)
  );
  const commandRef = useRef(command);
  commandRef.current = command;
  const busy = !!command.locked,
    context = JSON.stringify([prefix, term, sort, filter, activeScoped]),
    visibleQueue = acceptedContext === context && acceptedIdentity === identity ? queue : null;
  function discardDetail(updateUrl = true) {
    if (updateUrl && queryRef.current?.selected) queryRef.current.select(null, true);
    ++detailGeneration.current;
    setDetail(null);
    setComments([]);
    setDetailLoading(false);
    setDetailError('');
    setSelectedId('');
    setReplyDrafts({ public: '', internal: '' });
    setInternal(false);
  }
  const load = useCallback(
    async (owned = false) => {
      if (!owned && commandRef.current.coordination.isLocked()) return;
      const current = ++generation.current,
        token = identityRef.current;
      setLoading(true);
      setQueueError('');
      try {
        const query = new URLSearchParams({
            page: String(page),
            limit: '20',
            search: term,
            sortOrder: sort,
            ...(filter ? { status: filter } : {}),
            ...(activeScoped ? { scope: 'active' } : {}),
          }),
          response = await fetch(prefix + '?' + query, { credentials: 'include' });
        if (!response.ok)
          throw new Error([401, 403].includes(response.status) ? 'forbidden' : 'error');
        const data = (await response.json()) as Queue;
        if (
          !Array.isArray(data.data) ||
          !Number.isSafeInteger(data.totalPages) ||
          data.totalPages < 0 ||
          data.data.some((row) => !ticketRecord(row)) ||
          (staff &&
            (!data.viewer ||
              typeof data.viewer.userId !== 'string' ||
              typeof data.viewer.canWrite !== 'boolean' ||
              typeof data.viewer.canAssignOthers !== 'boolean' ||
              (actor && data.viewer.userId !== actor)))
        )
          throw new Error('error');
        if (current === generation.current && identityRef.current === token) {
          queueDenied.current = false;
          setQueueAccessDenied(false);
          setQueue(data);
          setAcceptedIdentity(token);
          setAcceptedContext(context);
          setAcceptedPage(page);
          if (page > Math.max(1, data.totalPages)) {
            if (queryRef.current)
              queryRef.current.queue.setQuery({ page: Math.max(1, data.totalPages) }, true);
            else setLocalPage(Math.max(1, data.totalPages));
          }
          if (staff && !data.viewer?.canAssignOthers) {
            setAssignees([]);
            setTeams([]);
          }
          if (staff && !data.viewer?.canWrite && !data.viewer?.canAssignOthers) {
            setReplyDrafts({ public: '', internal: '' });
          }
        }
      } catch (reason) {
        if (current === generation.current && identityRef.current === token) {
          const failure = reason instanceof Error ? reason.message : 'error';
          setQueueError(failure);
          if (failure === 'forbidden') {
            queueDenied.current = true;
            setQueueAccessDenied(true);
            setQueue(null);
            discardDetail();
            setAssignees([]);
            setTeams([]);
            setCreating(false);
            commandRef.current.reset();
            setEditorRevision((v) => v + 1);
            setSaved(false);
          }
        }
      } finally {
        if (current === generation.current && identityRef.current === token) setLoading(false);
      }
    },
    [prefix, page, term, sort, filter, activeScoped, context, staff, actor, profileRevision]
  );
  useEffect(() => {
    setCreating(false);
    discardDetail(false);
    setQueue(null);
    setSaved(false);
    setEditorRevision((v) => v + 1);
  }, [actor, profileRevision, prefix]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    if (queries) return;
    setFilter(routeSearch.status === 'active' ? 'active' : '');
    setPage(1);
  }, [routeSearch.status]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  useEffect(() => {
    if (queries || search.trim() === term) return;
    const timer = setTimeout(() => {
      if (commandRef.current.coordination.isLocked()) return;
      setTerm(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, term]);
  useEffect(() => {
    if (!staff || !queue?.viewer?.canAssignOthers || commandRef.current.coordination.isLocked())
      return;
    const controller = new AbortController(),
      token = identityRef.current;
    setAssignmentLoading(true);
    setAssignmentError('');
    void Promise.all(
      ['assignees', 'teams'].map((path) =>
        fetch(prefix + '/' + path, { credentials: 'include', signal: controller.signal })
      )
    )
      .then(async (responses) => {
        if (responses.some((r) => [401, 403].includes(r.status))) throw new Error('forbidden');
        if (responses.some((r) => !r.ok)) throw new Error('error');
        const [people, groups] = await Promise.all(responses.map((r) => r.json())),
          parsed = ticketAssignmentOptions(people, groups);
        if (!parsed) throw new Error('error');
        if (!controller.signal.aborted && identityRef.current === token) {
          setAssignees(parsed.people);
          setTeams(parsed.groups);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && identityRef.current === token) {
          const failure = reason instanceof Error ? reason.message : 'error';
          setAssignmentError(failure);
          if (failure === 'forbidden') {
            setAssignees([]);
            setTeams([]);
            commandRef.current.coordination.denied();
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && identityRef.current === token)
          setAssignmentLoading(false);
      });
    return () => controller.abort();
  }, [staff, prefix, queue?.viewer?.canAssignOthers, assignmentVersion, identity]);
  async function select(id: string, owned = false) {
    if (queueDenied.current || (!owned && commandRef.current.coordination.isLocked())) return;
    const same = loadedDetail?.id === id;
    if (!same) {
      setReplyDrafts({ public: '', internal: '' });
      setInternal(false);
      setDetail(null);
      setComments([]);
    }
    setSelectedId(id);
    setDetailError('');
    const current = ++detailGeneration.current,
      token = identityRef.current;
    setDetailLoading(true);
    try {
      const [recordResponse, commentsResponse] = await Promise.all([
        fetch(prefix + '/' + encodeURIComponent(id), { credentials: 'include' }),
        fetch(prefix + '/' + encodeURIComponent(id) + '/comments', { credentials: 'include' }),
      ]);
      if (
        [401, 403, 404].includes(recordResponse.status) ||
        [401, 403, 404].includes(commentsResponse.status)
      )
        throw new Error('forbidden');
      if (!recordResponse.ok || !commentsResponse.ok) throw new Error('error');
      const [ticket, conversation] = await Promise.all([
          recordResponse.json(),
          commentsResponse.json(),
        ]),
        parsed = ticketRecord(ticket, id);
      if (
        !parsed ||
        !Array.isArray(conversation) ||
        conversation.some(
          (comment) =>
            !comment ||
            typeof comment !== 'object' ||
            typeof comment.id !== 'string' ||
            typeof comment.body !== 'string' ||
            !['public', 'internal'].includes(comment.visibility)
        )
      )
        throw new Error('error');
      if (
        current === detailGeneration.current &&
        !queueDenied.current &&
        identityRef.current === token
      ) {
        setDetail(parsed);
        setDetailIdentity(token);
        setComments(
          staff ? conversation : conversation.filter((comment) => comment.visibility === 'public')
        );
      }
    } catch (reason) {
      if (current === detailGeneration.current && identityRef.current === token) {
        const failure = reason instanceof Error ? reason.message : 'error';
        setDetailError(failure);
        if (failure === 'forbidden') {
          commandRef.current.reset();
          discardDetail();
          setCreating(false);
          setEditorRevision((v) => v + 1);
          setSaved(false);
          setDetailError('forbidden');
        }
      }
    } finally {
      if (current === detailGeneration.current && identityRef.current === token)
        setDetailLoading(false);
    }
  }
  useEffect(() => {
    if (selectedLink) void select(selectedLink);
    else if (queries) discardDetail(false);
    return () => {
      ++detailGeneration.current;
    };
  }, [selectedLink, prefix, identity]);
  useEffect(() => {
    if (detail) heading.current?.focus();
  }, [detail?.id]);
  useEffect(
    () => () => {
      ++detailGeneration.current;
    },
    []
  );
  async function send(next: TicketCommand) {
    if (!actor) return false;
    setSaved(false);
    const accepted = next.accepted;
    return commandRef.current.submit({
      ...next,
      accepted: async (value) => {
        setSaved(true);
        await accepted(value);
      },
    });
  }
  async function refreshSelected(id: string) {
    await latestLoad.current(true);
    if (!queueDenied.current) await select(id, true);
  }
  async function submitReply(
    prepare: () => Promise<Record<string, unknown>>,
    fields?: (names: unknown[]) => boolean,
    onAccepted?: () => void
  ) {
    const source = detail,
      token = scope;
    if (!source || !actor) return false;
    const owner = internal ? 'reply-internal' : 'reply-public';
    try {
      const body = await prepare();
      if (scopeRef.current !== token || !commandRef.current.coordination.isCurrent()) return false;
      return await send({
        owner,
        path: prefix + '/' + source.id + '/comments',
        method: 'POST',
        status: 201,
        body,
        confirmed: (v) => ticketReplyReceipt(v, source.id, actor, staff, body),
        fields,
        accepted: async () => {
          onAccepted?.();
          await refreshSelected(source.id);
        },
      });
    } catch {
      commandRef.current.failed(owner);
      return false;
    }
  }
  async function reopen() {
    const source = detail;
    if (!source || !actor || !commandRef.current.coordination.claim('reopen')) return;
    try {
      await send({
        owner: 'reopen',
        path: prefix + '/' + source.id + '/status',
        method: 'PATCH',
        status: 200,
        body: { status: 'open', idempotencyKey: crypto.randomUUID() },
        confirmed: (v) => ticketStatusReceipt(v, source, 'open'),
        accepted: () => refreshSelected(source.id),
      });
    } finally {
      commandRef.current.coordination.release('reopen');
    }
  }
  const canWrite =
    !staff ||
    (queue?.viewer?.canWrite &&
      (queue.viewer.canAssignOthers || detail?.assignedTo === queue.viewer.userId));
  const formatDate = time.format;
  const guard = (event: {
    target: EventTarget | null;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    if (
      commandRef.current.coordination.isLocked() &&
      !(event.target instanceof Element && event.target.closest('[data-ticket-command-retry]'))
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return (
    <section
      onClickCapture={guard}
      onAuxClickCapture={guard}
      onSubmitCapture={guard}
      onChangeCapture={guard}
      className="mx-auto max-w-5xl space-y-5 bg-background text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{text(staff ? 'staffTitle' : 'title')}</h1>
        {!staff && (
          <Button
            className="hover:bg-primary"
            disabled={busy || queueAccessDenied}
            onClick={() => {
              if (commandRef.current.coordination.isLocked()) return;
              setCreating((value) => !value);
              setError('');
            }}
          >
            {text(creating ? 'cancel' : 'create')}
          </Button>
        )}
      </header>
      {activeScoped && (
        <p className="text-sm text-muted-foreground">
          {text('activeProfileScope')}{' '}
          <Link
            to="/tickets"
            search={{ status: undefined, scope: undefined, ticketId: undefined }}
            className="text-primary underline underline-offset-4"
          >
            {text('allMyTickets')}
          </Link>
        </p>
      )}
      {staff && <p className="text-sm text-muted-foreground">{text('targetNote')}</p>}
      {command.uncertain && (
        <div role="alert" className="flex flex-col gap-2">
          <p>{tTicketForms('uncertain', locale)}</p>
          <Button
            data-ticket-command-retry
            type="button"
            variant="outline"
            disabled={command.busy}
            onClick={() => void command.retry()}
          >
            {tTicketForms('retryOriginal', locale)}
          </Button>
        </div>
      )}
      {command.error && !command.uncertain && <p role="alert">{text(command.error)}</p>}
      {error && (
        <p role="alert">{text(['conflict', 'forbidden'].includes(error) ? error : 'error')}</p>
      )}
      {saved && <p role="status">{text('saved')}</p>}
      {!staff && !queueAccessDenied && (
        <div hidden={!creating}>
          <TicketIntakeForm
            key={identity + editorRevision}
            actor={actor}
            scope={scope}
            locale={locale}
            open={creating}
            locked={busy}
            coordination={command.coordination}
            send={send}
            failed={() => command.failed('intake')}
            formatDate={formatDate}
            onSaved={async (id) => {
              setCreating(false);
              await latestLoad.current(true);
              if (queryRef.current) queryRef.current.select(id);
              else await select(id, true);
            }}
          />
        </div>
      )}
      <fieldset disabled={busy} className="contents">
        <ListPage>
          <ListPage.Toolbar
            actions={
              <ListViewToggle
                value={view}
                onChange={(value) => {
                  if (!commandRef.current.coordination.isLocked()) setView(value);
                }}
                labels={{
                  group: t('historyView.group', locale),
                  table: t('historyView.table', locale),
                  card: t('historyView.card', locale),
                }}
              />
            }
          >
            <fieldset disabled={busy} className="flex min-w-0 flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="ticket-search">{text('search')}</Label>
                <Input
                  id="ticket-search"
                  maxLength={200}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ticket-filter">{text('status')}</Label>
                <select
                  id="ticket-filter"
                  className="block rounded border border-input bg-background text-foreground p-2"
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    if (!queries) setPage(1);
                  }}
                >
                  <option value="">{text('all')}</option>
                  <option value="active">{text('active')}</option>
                  {statuses.map((value) => (
                    <option key={value} value={value}>
                      {text(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="ticket-sort">{text('sort')}</Label>
                <select
                  id="ticket-sort"
                  className="block rounded border border-input bg-background text-foreground p-2"
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value);
                    if (!queries) setPage(1);
                  }}
                >
                  <option value="desc">{text('newest')}</option>
                  <option value="asc">{text('oldest')}</option>
                </select>
              </div>
              <Button variant="outline" disabled={loading} onClick={() => void load()}>
                {text('refresh')}
              </Button>
            </fieldset>
          </ListPage.Toolbar>
          <ListPage.Content
            loading={loading}
            error={!!queueError}
            empty={!visibleQueue?.data.length}
            retainContent={!!visibleQueue?.data.length && queueError !== 'forbidden'}
            loadingView={<p role="status">{text('loading')}</p>}
            errorView={
              <div role="alert" className="space-y-2">
                <p>{text(queueError === 'forbidden' ? 'forbidden' : 'queueError')}</p>
                {queueError !== 'forbidden' && (
                  <Button type="button" variant="outline" onClick={() => void load()}>
                    {text('retry')}
                  </Button>
                )}
              </div>
            }
            emptyView={<p>{text('empty')}</p>}
          >
            {visibleQueue && (
              <TicketQueueRecords
                key={context}
                items={visibleQueue.data}
                staff={staff}
                locale={locale}
                view={view}
                busy={busy}
                selectedId={selectedId}
                assignees={assignees}
                responseTargetHours={visibleQueue.responseTargetHours}
                formatDate={formatDate}
                onSelect={(id) => {
                  if (commandRef.current.coordination.isLocked()) return;
                  setError('');
                  if (queries && queries.selected !== id) queries.select(id);
                  else void select(id);
                }}
              />
            )}
          </ListPage.Content>
          <ListPage.Pagination
            kind="page"
            page={acceptedPage}
            pageCount={visibleQueue?.totalPages ?? 1}
            onPageChange={setPage}
            label={text('pages')}
            previousLabel={text('previous')}
            nextLabel={text('next')}
            pageLabel={(value) => `${text('page')} ${value.toLocaleString(locale)}`}
            formatPage={(value) => value.toLocaleString(locale)}
            disabled={loading || busy || !!queueError || !visibleQueue}
          />
        </ListPage>
      </fieldset>
      {detailLoading && <p role="status">{text('loading')}</p>}
      {detailError && (
        <div role="alert" className="space-y-2">
          <p>{text(detailError === 'forbidden' ? 'forbidden' : 'detailError')}</p>
          {detailError !== 'forbidden' && selectedId && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void select(selectedId)}
            >
              {text('retry')}
            </Button>
          )}
        </div>
      )}
      {detail && (
        <article
          data-slot="ticket-detail"
          className="rounded border bg-card text-card-foreground p-4 space-y-4 break-words"
        >
          <header className="flex flex-col gap-3">
            <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">
              {detail.subject}
            </h2>
            <div className="flex flex-wrap gap-2">
              <TicketStatusBadge status={detail.status} locale={locale} />
              <TicketPriorityBadge priority={detail.priority} locale={locale} />
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">{text('created')}</dt>
                <dd>
                  <time dateTime={detail.createdAt}>{formatDate(detail.createdAt ?? null)}</time>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{text('updated')}</dt>
                <dd>
                  <time dateTime={detail.updatedAt}>{formatDate(detail.updatedAt)}</time>
                </dd>
              </div>
              {detail.relatedEntityId && (
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-sm text-muted-foreground">{text('related')}</dt>
                  <dd>
                    <RelatedTicketRecord ticket={detail} staff={staff} locale={locale} />
                  </dd>
                </div>
              )}
            </dl>
          </header>
          <p className="whitespace-pre-wrap">{detail.body}</p>
          <p>
            {text('category')}: {text(`category.${detail.category ?? 'general'}`)}
          </p>
          <p>
            {text('assignee')}:{' '}
            {assignees.find((person) => person.id === detail.assignedTo)?.name ??
              detail.assignedTo ??
              text('unassigned')}
          </p>
          {staff && detail.customer && (
            <section
              aria-labelledby="ticket-customer-heading"
              className="rounded border bg-muted p-3 space-y-2"
            >
              <h3 id="ticket-customer-heading" className="font-semibold">
                {text('customerInfo')}
              </h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">{text('account')}</dt>
                  <dd>
                    <bdi dir="ltr">{detail.customer.username}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{text('email')}</dt>
                  <dd>
                    {detail.customer.email ? (
                      <bdi dir="ltr">{detail.customer.email}</bdi>
                    ) : (
                      text('none')
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{text('mobile')}</dt>
                  <dd>
                    {detail.customer.mobile ? (
                      <bdi dir="ltr">{detail.customer.mobile}</bdi>
                    ) : (
                      text('none')
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{text('profile')}</dt>
                  <dd>
                    {detail.customer.profile ? (
                      <>
                        <span className="block">
                          {detail.customer.profile.title ?? text('unnamed')}
                        </span>
                        <a
                          className="text-blue-700 dark:text-blue-300 underline"
                          href={`/admin/crm/profiles/${encodeURIComponent(detail.customer.profile.id)}`}
                        >
                          {text('openProfile')}
                        </a>
                      </>
                    ) : (
                      text('none')
                    )}
                  </dd>
                </div>
              </dl>
            </section>
          )}
          {detail.attachmentFiles?.length ? (
            <ul aria-label={text('files')} className="flex flex-wrap gap-3">
              {detail.attachmentFiles
                .filter((file) => safeAttachmentUrl(file.url))
                .map((file) => (
                  <li key={file.key} className="min-w-0 max-w-full">
                    <a
                      href={file.url}
                      aria-label={file.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      className="flex max-w-full flex-col gap-2 rounded-md border p-2 text-sm text-primary underline"
                    >
                      <FilePreview
                        name={file.fileName}
                        locale={locale}
                        imageUrl={
                          Number.isSafeInteger(file.fileIndex) &&
                          file.fileIndex >= 0 &&
                          file.fileIndex < 5
                            ? new URL(
                                `${prefix}/${encodeURIComponent(detail.id)}/attachments/${file.fileIndex}/preview`,
                                window.location.origin
                              ).href
                            : undefined
                        }
                      />
                      <bdi className="break-words">{file.fileName}</bdi>
                    </a>
                  </li>
                ))}
            </ul>
          ) : (
            (detail.attachmentDownloadUrls ?? [])
              .filter((url) => safeAttachmentUrl(url))
              .map((url, index) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="block text-blue-700 dark:text-blue-300 underline"
                >
                  {text('attachment')} {index + 1}
                </a>
              ))
          )}
          {!!detail.attachments?.length && !detail.attachmentDownloadUrls?.length && (
            <p role="status">{text('filesUnavailable')}</p>
          )}
          {detail.privacyRequestType === 'closure' && detail.privacyClosureCompletedAt && (
            <section
              className="space-y-2 rounded border p-3"
              aria-label={t('tickets.closure.review', locale)}
            >
              <h3 className="font-semibold">{t('tickets.closure.completed', locale)}</h3>
              <p>{t('tickets.closure.consequences', locale)}</p>
              <p>
                {t(
                  detail.privacyClosureAnonymized
                    ? 'tickets.closure.redacted'
                    : 'tickets.closure.retainedIdentity',
                  locale
                )}
              </p>
              <p>{t('tickets.closure.supportHistory', locale)}</p>
              <ul className="list-disc ps-5">
                {Object.entries(detail.privacyClosureRetained ?? {})
                  .filter(([, count]) => count > 0)
                  .map(([key, count]) => (
                    <li key={key}>
                      {t(`tickets.closure.record.${key}`, locale)}: {count}
                    </li>
                  ))}
              </ul>
              {detail.privacyClosureExportTicketId && (
                <a
                  href={`${staff ? '/admin/tickets' : '/tickets'}?ticketId=${encodeURIComponent(detail.privacyClosureExportTicketId)}`}
                  className="text-primary underline underline-offset-2"
                >
                  {t('tickets.closure.export', locale)} · {detail.privacyClosureExportTicketId}
                </a>
              )}
              {!staff && (
                <a href="/tickets" className="block text-primary underline underline-offset-2">
                  {text('create')}
                </a>
              )}
            </section>
          )}
          {staff &&
            detail.privacyRequestType === 'closure' &&
            queue?.viewer?.canApproveClosure &&
            !detail.privacyClosureCompletedAt && (
              <ProfileClosureReview
                ticketId={detail.id}
                locale={locale}
                coordination={command.coordination}
                disabled={busy}
                onCompleted={() => {
                  void latestLoad.current(true);
                  void select(detail.id, true);
                }}
              />
            )}
          {staff && (
            <TicketStaffForms
              key={identity + editorRevision + detail.id}
              ticket={detail}
              scope={scope}
              locale={locale}
              canWrite={!!canWrite}
              canAssign={!!queue?.viewer?.canAssignOthers}
              people={assignees}
              groups={teams}
              optionsLoading={assignmentLoading}
              optionsError={assignmentError}
              refreshOptions={() => setAssignmentVersion((v) => v + 1)}
              locked={busy}
              coordination={command.coordination}
              send={send}
              failed={command.failed}
              onSaved={() => refreshSelected(detail.id)}
            />
          )}
          {!staff && detail.status !== 'open' && !detail.privacyClosureCompletedAt && (
            <Button className="hover:bg-primary" disabled={busy} onClick={() => void reopen()}>
              {text('reopen')}
            </Button>
          )}
          <TicketCommentThread
            ticketId={detail.id}
            comments={comments}
            ownerId={detail.userId}
            staff={staff}
            locale={locale}
            customerName={
              staff ? (detail.customer?.profile?.title ?? detail.customer?.username) : null
            }
            assignees={assignees}
            formatDate={formatDate}
          />
          {canWrite && (
            <div hidden={['closed', 'resolved'].includes(detail.status)}>
              <TicketReplyInput
                key={identity + editorRevision + detail.id}
                scope={scope}
                coordination={command.coordination}
                ticketId={detail.id}
                profileId={detail.profileId}
                locale={locale}
                staff={staff}
                busy={busy}
                body={reply}
                onBodyChange={setReply}
                internal={internal}
                onInternalChange={setInternal}
                onSubmit={submitReply}
              />
            </div>
          )}
        </article>
      )}
    </section>
  );
}
