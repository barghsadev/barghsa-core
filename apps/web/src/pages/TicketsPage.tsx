import { CommandFeedback } from '../components/CommandFeedback.js';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { TicketIntakeForm } from '../components/TicketIntakeForm.js';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { useTicketCommand } from '../hooks/useTicketCommand.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { sendToast } from '../lib/toast-api.js';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { lifecycleFormText } from '@barghsa/i18n/profile-lifecycle-forms';
import { Archive, ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import {
  ticketRecord,
  ticketViewer,
  ticketAssignmentOptions,
  ticketReplyReceipt,
  ticketStatusReceipt,
  type TicketCommand,
  type TicketOwner,
} from '../lib/ticket-form.js';
import { TicketReplyInput } from '../components/TicketReplyInput.js';
import { FilePreview } from '../components/FilePreview.js';
import { QueueEmptyState } from '../components/QueueEmptyState.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import {
  LoadingStatus,
  Button,
  buttonVariants,
  ListPage,
  ListRefreshButton,
  ListSearchInput,
  ListViewToggle,
  NativeSelect,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import type {
  SupportListQuery,
  TicketListFilters,
  TicketRelatedRecord,
} from '../lib/support-list-query.js';
import { useListView } from '../hooks/useListView.js';
import {
  TicketQueueRecords,
  RelatedTicketRecord,
  TicketStatusBadge,
  TicketPriorityBadge,
  type Ticket,
  type TicketStatus,
  type TicketViewer,
} from '../components/TicketQueueRecords.js';
import { TicketCommentThread, type TicketComment } from '../components/TicketCommentThread.js';
import { TicketRepliesSeen } from '../components/TicketRepliesSeen.js';
import { ticketRepliesSeen } from '../lib/notifications.js';
import { documentUrl } from '../lib/documents.js';
import { ProfileClosureReview } from '../components/ProfileClosureReview.js';

const TicketStaffForms = lazy(() => import('../components/TicketStaffForms.js'));

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
  viewer?: TicketViewer;
}
const statuses: TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_customer',
  'waiting_staff',
  'resolved',
  'closed',
];
type TicketEntry =
  | { kind: 'record'; ticketId: string; closure?: boolean }
  | { kind: 'new'; onCreated: (ticketId: string) => Promise<void>; related?: TicketRelatedRecord };

interface TicketsProps {
  queries?: Pick<SupportListQuery, 'queue'> & Partial<Omit<SupportListQuery, 'queue'>>;
  recordSearch?: TicketListFilters;
  entry?: TicketEntry;
}
export function CustomerTicketsPage(props: TicketsProps = {}) {
  return <Tickets staff={false} {...props} />;
}
export function StaffTicketsPage(props: TicketsProps = {}) {
  return <Tickets staff {...props} />;
}
function Tickets({ staff, queries, recordSearch, entry }: TicketsProps & { staff: boolean }) {
  const showQueue = !entry;
  const closureTicketId =
    staff && entry?.kind === 'record' && entry.closure ? entry.ticketId : null;
  const departingAfterSave = useRef(false);
  const reader = useId();
  const client = useQueryClient();
  const readSequence = useRef(0);
  const reads = useRef(new Map<string, ServerQueryKey>());
  const cancelRead = useCallback(
    (channel: string) => {
      const key = reads.current.get(channel);
      if (key) {
        reads.current.delete(channel);
        void client.cancelQueries({ queryKey: key, exact: true });
      }
    },
    [client]
  );
  const queryRead = useCallback(
    async <T,>(
      channel: string,
      key: ServerQueryKey,
      signal: AbortSignal | undefined,
      read: (signal: AbortSignal) => Promise<T>
    ): Promise<T> => {
      cancelRead(channel);
      if (signal?.aborted) throw new DOMException('Abandoned ticket read', 'AbortError');
      reads.current.set(channel, key);
      const abort = () => void client.cancelQueries({ queryKey: key, exact: true });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        return await client.fetchQuery({
          queryKey: key,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: ({ signal }) =>
            readWithDeadline(signal, async (signal) => {
              const transport = new AbortController();
              const abort = () => transport.abort();
              if (signal.aborted) abort();
              signal.addEventListener('abort', abort, { once: true });
              try {
                return await read(transport.signal);
              } finally {
                // Bound response bodies and abort sibling reads when a grouped read fails.
                transport.abort();
                signal.removeEventListener('abort', abort);
              }
            }),
        });
      } finally {
        signal?.removeEventListener('abort', abort);
        if (reads.current.get(channel) === key) reads.current.delete(channel);
      }
    },
    [client, cancelRead]
  );
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
    selectedLink =
      entry?.kind === 'record' ? entry.ticketId : queries ? queries.selected : routeSearch.ticketId;
  const identity = JSON.stringify([actor, profileRevision, prefix]),
    identityRef = useRef(identity),
    editorIdentity = useRef(identity);
  identityRef.current = identity;
  useEffect(
    () => () => {
      for (const channel of [...reads.current.keys()]) cancelRead(channel);
    },
    [identity, cancelRead]
  );
  const detail =
    detailIdentity === identity && (!(entry || queries) || loadedDetail?.id === selectedLink)
      ? loadedDetail
      : null;
  const viewer = showQueue ? queue?.viewer : detail?.viewer;
  const canReviewClosure =
    staff && detail?.privacyRequestType === 'closure' && viewer?.canApproveClosure;
  const scope = JSON.stringify([identity, editorRevision, selectedLink ?? null, selectedId]),
    scopeRef = useRef(scope);
  scopeRef.current = scope;
  const authority = useRef<(owner: TicketOwner) => boolean>(() => false);
  authority.current = (owner) => {
    if (!actor || queueDenied.current) return false;
    if (owner === 'intake') return !staff && !queueAccessDenied;
    if (!detail) return false;
    if (owner === 'reopen') return !staff;
    if (owner === 'assignment') return staff && !!viewer?.canAssignOthers;
    if (owner === 'closure') return !!canReviewClosure;
    if (owner === 'reply-internal' || owner === 'status') {
      if (!staff) return false;
    }
    return (
      !staff || !!(viewer?.canWrite && (viewer.canAssignOthers || detail.assignedTo === actor))
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
    (owner) => authority.current(owner),
    () => sendToast('warning', tTicketForms('uncertain', locale), { id: reader })
  );
  const commandRef = useRef(command);
  commandRef.current = command;
  const busy = !!command.locked,
    context = JSON.stringify([prefix, term, sort, filter, activeScoped]),
    visibleQueue = acceptedContext === context && acceptedIdentity === identity ? queue : null;
  function discardDetail(updateUrl = true) {
    cancelRead('detail');
    if (updateUrl && queryRef.current?.selected) queryRef.current.select?.(null, true);
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
          data = await queryRead(
            'queue',
            queryKeys.tickets.list(
              {
                context: staff ? 'staff' : 'account',
                ownerId: actor?.trim() ? actor : reader,
                accountId: actor,
                revision: profileRevision,
              },
              new URLSearchParams([...query, ['reader', reader], ['endpoint', prefix]]),
              ++readSequence.current
            ),
            undefined,
            async (signal) => {
              const response = await fetch(prefix + '?' + query, {
                credentials: 'include',
                signal,
              });
              if (!response.ok)
                throw new Error([401, 403].includes(response.status) ? 'forbidden' : 'error');
              return (await response.json()) as Queue;
            }
          );
        if (
          !Array.isArray(data.data) ||
          !Number.isSafeInteger(data.totalPages) ||
          data.totalPages < 0 ||
          data.data.some((row) => !ticketRecord(row)) ||
          (staff && !ticketViewer(data.viewer, actor))
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
    [
      prefix,
      page,
      term,
      sort,
      filter,
      activeScoped,
      context,
      staff,
      actor,
      profileRevision,
      queryRead,
      reader,
    ]
  );
  useEffect(() => {
    if (editorIdentity.current === identity) return;
    editorIdentity.current = identity;
    setCreating(false);
    discardDetail(false);
    setQueue(null);
    setAssignees([]);
    setTeams([]);
    setSaved(false);
    setEditorRevision((v) => v + 1);
  }, [identity]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    if (!showQueue || staff) return;
    const refresh = () => void latestLoad.current();
    window.addEventListener(ticketRepliesSeen, refresh);
    return () => window.removeEventListener(ticketRepliesSeen, refresh);
  }, [showQueue, staff]);
  useEffect(() => {
    if (queries) return;
    setFilter(routeSearch.status === 'active' ? 'active' : '');
    setPage(1);
  }, [routeSearch.status]);
  useEffect(() => {
    if (!showQueue) return;
    void load();
    return () => {
      ++generation.current;
      cancelRead('queue');
    };
  }, [load, showQueue]);
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
    if (!staff || closureTicketId || !viewer?.canAssignOthers) {
      setAssignees([]);
      setTeams([]);
      setAssignmentLoading(false);
      return;
    }
    const endpoints = showQueue && recordSearch ? ['assignees'] : ['assignees', 'teams'];
    const controller = new AbortController(),
      token = identityRef.current;
    setAssignmentLoading(true);
    setAssignmentError('');
    void queryRead(
      'assignment',
      queryKeys.catalogue.detail(
        {
          context: 'staff',
          ownerId: actor?.trim() ? actor : reader,
          accountId: actor,
          revision: profileRevision,
        },
        JSON.stringify([reader, identity, 'ticket-assignment-options', ++readSequence.current])
      ),
      controller.signal,
      async (signal) => {
        const responses = await Promise.all(
          endpoints.map((path) => fetch(prefix + '/' + path, { credentials: 'include', signal }))
        );
        if (responses.some((r) => [401, 403].includes(r.status))) throw new Error('forbidden');
        if (responses.some((r) => !r.ok)) throw new Error('error');
        return Promise.all(responses.map((r) => r.json()));
      }
    )
      .then(([people, groups]) => {
        const parsed = ticketAssignmentOptions(people, groups ?? []);
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
  }, [staff, closureTicketId, prefix, viewer?.canAssignOthers, assignmentVersion, identity]);
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
      const [ticket, conversation] = await queryRead(
        'detail',
        queryKeys.tickets.detail(
          {
            context: staff ? 'staff' : 'account',
            ownerId: actor?.trim() ? actor : reader,
            accountId: actor,
            revision: profileRevision,
          },
          JSON.stringify([reader, prefix, id, ++readSequence.current])
        ),
        undefined,
        async (signal) => {
          const [recordResponse, commentsResponse] = await Promise.all([
            fetch(prefix + '/' + encodeURIComponent(id), { credentials: 'include', signal }),
            fetch(prefix + '/' + encodeURIComponent(id) + '/comments', {
              credentials: 'include',
              signal,
            }),
          ]);
          if (
            [401, 403, 404].includes(recordResponse.status) ||
            [401, 403, 404].includes(commentsResponse.status)
          )
            throw new Error('forbidden');
          if (!recordResponse.ok || !commentsResponse.ok) throw new Error('error');
          return Promise.all([recordResponse.json(), commentsResponse.json()]);
        }
      );
      const parsed = ticketRecord(ticket, id);
      if (
        !parsed ||
        (staff && !showQueue && !ticketViewer(parsed.viewer, actor)) ||
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
    if (detail || closureTicketId) heading.current?.focus({ preventScroll: true });
  }, [detail?.id, closureTicketId]);
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
        if (entry?.kind !== 'new') setSaved(true);
        await accepted(value);
      },
    });
  }
  async function refreshSelected(id: string) {
    if (showQueue) await latestLoad.current(true);
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
    (viewer?.canWrite && (viewer.canAssignOthers || detail?.assignedTo === viewer.userId));
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
  const isCreating = entry?.kind === 'new' || creating;
  const showIntake =
    !staff && !queueAccessDenied && (entry?.kind === 'new' || (!entry && !recordSearch));
  const viewToggle = (
    <ListViewToggle
      compact
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
  );
  return (
    <section
      data-slot="tickets-page"
      onClickCapture={guard}
      onAuxClickCapture={guard}
      onSubmitCapture={guard}
      onChangeCapture={guard}
      className={`mx-auto min-w-0 text-foreground ${closureTicketId ? 'max-w-3xl space-y-3' : `space-y-4 ${entry && !staff ? 'max-w-3xl' : 'max-w-5xl'}`}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {entry && (
        <RecordCommandGuard
          blocked={() => !departingAfterSave.current && commandRef.current.coordination.isLocked()}
        />
      )}
      {time.notice}
      {closureTicketId ? (
        <Link
          to="/admin/tickets/$ticketId/{-$section}"
          params={{ ticketId: closureTicketId, section: undefined }}
          search={recordSearch ?? {}}
          activeOptions={{ exact: true }}
          aria-disabled={busy || undefined}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline aria-disabled:opacity-60"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:hidden" />
          <ArrowRight aria-hidden="true" className="hidden size-4 rtl:block" />
          {lifecycleFormText('backToTicket', locale)}
        </Link>
      ) : (
        entry && (
          <Link
            activeOptions={{ exact: true }}
            aria-disabled={busy || undefined}
            to={staff ? '/admin/tickets' : '/tickets'}
            search={recordSearch ?? {}}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-4"
          >
            <ArrowLeft aria-hidden="true" className="size-4 rtl:hidden" />
            <ArrowRight aria-hidden="true" className="hidden size-4 rtl:block" />
            {tTicketForms(staff ? 'backToStaffQueue' : 'backToTickets', locale)}
          </Link>
        )
      )}
      {closureTicketId ? (
        <header className="space-y-1">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight sm:text-2xl"
          >
            {text('closure.review')}
          </h1>
          {canReviewClosure && detail?.customer?.profile?.title && (
            <p dir="auto" className="wrap-anywhere text-sm text-muted-foreground">
              {detail.customer.profile.title}
            </p>
          )}
        </header>
      ) : (
        !(entry?.kind === 'record' && (detail || detailLoading)) && (
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {text(entry?.kind === 'new' ? 'create' : staff ? 'staffTitle' : 'title')}
              </h1>
              {entry?.kind === 'new' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {tTicketForms('describeRequest', locale)}
                </p>
              )}
            </div>
            {!staff && showQueue && recordSearch && !queueAccessDenied && (
              <Link className={buttonVariants()} to="/tickets/new" search={recordSearch}>
                <Plus aria-hidden="true" data-icon="inline-start" />
                {text('create')}
              </Link>
            )}
            {!staff && showQueue && !recordSearch && (
              <Button
                aria-controls={queueAccessDenied ? undefined : 'customer-ticket-intake'}
                aria-expanded={creating && !queueAccessDenied}
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
        )
      )}
      {showQueue && activeScoped && (
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
      <CommandFeedback
        kind="error"
        message={command.error && !command.uncertain ? text(command.error) : null}
      />
      {error && (
        <p role="alert">{text(['conflict', 'forbidden'].includes(error) ? error : 'error')}</p>
      )}
      <CommandFeedback message={saved ? text('saved') : null} />
      {showIntake && (
        <div id="customer-ticket-intake" hidden={!isCreating}>
          <TicketIntakeForm
            key={identity + editorRevision}
            actor={actor}
            scope={scope}
            locale={locale}
            open={isCreating}
            {...(entry?.kind === 'new' && entry.related ? { related: entry.related } : {})}
            locked={busy}
            coordination={command.coordination}
            send={send}
            failed={() => command.failed('intake')}
            formatDate={formatDate}
            onSaved={async (id) => {
              if (entry?.kind === 'new') {
                departingAfterSave.current = true;
                try {
                  await entry.onCreated(id);
                  sendToast('success', text('saved'), { id: reader });
                } finally {
                  departingAfterSave.current = false;
                }
                return;
              }
              setCreating(false);
              await latestLoad.current(true);
              if (queryRef.current?.select) queryRef.current.select(id);
              else await select(id, true);
            }}
          />
        </div>
      )}
      {showQueue && (
        <fieldset disabled={busy} className="contents">
          <ListPage>
            <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
              <ListPage.Toolbar
                className="items-center p-3 min-[23rem]:[&>[data-slot=list-toolbar-search]]:basis-0"
                search={
                  <ListSearchInput
                    id="ticket-search"
                    label={text('search')}
                    maxLength={200}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                }
                sort={
                  <NativeSelect
                    id="ticket-filter"
                    aria-label={text('status')}
                    className="max-w-full sm:min-w-44"
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
                  </NativeSelect>
                }
              >
                <div className="flex grow basis-full flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-2 lg:grow-0 lg:basis-auto lg:border-0 lg:pt-0">
                  <NativeSelect
                    id="ticket-sort"
                    aria-label={text('sort')}
                    className="max-w-full [&_select]:border-transparent [&_select]:hover:bg-muted"
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value);
                      if (!queries) setPage(1);
                    }}
                  >
                    <option value="desc">{text('newest')}</option>
                    <option value="asc">{text('oldest')}</option>
                  </NativeSelect>
                  <div className="ms-auto flex items-center gap-2">
                    {viewToggle}
                    <ListRefreshButton
                      label={text('refresh')}
                      refreshing={loading}
                      onClick={() => void load()}
                    />
                  </div>
                </div>
              </ListPage.Toolbar>
            </div>
            <ListPage.Content
              loading={loading}
              error={!!queueError}
              empty={!visibleQueue?.data.length}
              retainContent={!!visibleQueue?.data.length && queueError !== 'forbidden'}
              loadingView={
                visibleQueue?.data.length ? (
                  <p role="status" className="sr-only">
                    {text('loading')}
                  </p>
                ) : (
                  <RecordListSkeleton
                    label={text('loading')}
                    view={view}
                    headings={[
                      text('subject'),
                      text('status'),
                      text('updated'),
                      ...(staff ? [text('assignee')] : []),
                      text('queueDetails'),
                    ]}
                  />
                )
              }
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
              emptyView={
                filter && page === 1 && acceptedPage === page && visibleQueue ? (
                  <QueueEmptyState
                    locale={locale}
                    message={text('empty')}
                    status={text(filter)}
                    alternatives={[
                      {
                        value: 'all',
                        label: text('all'),
                        path: `${prefix}?${new URLSearchParams({ page: '1', limit: '1', search: term, sortOrder: sort, ...(activeScoped ? { scope: 'active' } : {}) })}`,
                      },
                    ]}
                    hasResults={(body) => {
                      const value = body as Partial<Queue> | null;
                      return (
                        (!staff || ticketViewer(value?.viewer, actor)) &&
                        Array.isArray(value?.data) &&
                        value.data.some(
                          (row) =>
                            ticketRecord(row) &&
                            (filter === 'active'
                              ? ['resolved', 'closed'].includes(row.status)
                              : row.status !== filter)
                        )
                      );
                    }}
                    all={() => {
                      if (commandRef.current.coordination.isLocked()) return;
                      setFilter('');
                      if (!queries) setPage(1);
                    }}
                    disabled={busy}
                  />
                ) : (
                  <p>{text('empty')}</p>
                )
              }
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
                  {...(recordSearch ? { recordSearch } : {})}
                  onSelect={(id) => {
                    if (commandRef.current.coordination.isLocked()) return;
                    setError('');
                    if (queries?.select && queries.selected !== id) queries.select(id);
                    else void select(id);
                  }}
                />
              )}
            </ListPage.Content>
            {staff && visibleQueue?.responseTargetHours && (
              <p className="text-xs text-muted-foreground">{text('targetNote')}</p>
            )}
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
      )}
      {detailLoading &&
        (detail ? (
          <p role="status" className="sr-only">
            {text('loading')}
          </p>
        ) : (
          <RecordDetailSkeleton label={text('loading')} sidebar={staff && !closureTicketId} />
        ))}
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
      {closureTicketId ? (
        canReviewClosure && detail ? (
          <ProfileClosureReview
            ticketId={detail.id}
            locale={locale}
            coordination={command.coordination}
            disabled={busy}
            dedicated
            onCompleted={() => void refreshSelected(detail.id)}
          />
        ) : (
          (detail || queueAccessDenied) && (
            <p role="alert" className="rounded-lg border bg-card px-4 py-3 text-sm">
              {lifecycleFormText('closureUnavailable', locale)}
            </p>
          )
        )
      ) : (
        detail && (
          <article
            data-slot="ticket-detail"
            className={`min-w-0 wrap-anywhere ${staff ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.5fr)]' : 'space-y-4'}`}
          >
            {!staff && entry?.kind === 'record' && actor && (
              <TicketRepliesSeen
                key={identity + detail.id}
                ticketId={detail.id}
                comments={comments}
              />
            )}
            <header className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-6 lg:col-span-full">
              {entry?.kind === 'record' ? (
                <h1
                  ref={heading}
                  tabIndex={-1}
                  dir="auto"
                  className="w-fit max-w-full text-2xl leading-tight font-semibold sm:text-3xl"
                >
                  {detail.subject}
                </h1>
              ) : (
                <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">
                  {detail.subject}
                </h2>
              )}
              <div className="flex flex-wrap gap-2">
                <TicketStatusBadge status={detail.status} locale={locale} />
                <TicketPriorityBadge priority={detail.priority} locale={locale} />
              </div>
              {entry?.kind === 'record' &&
                canReviewClosure &&
                !detail.privacyClosureCompletedAt && (
                  <Link
                    to="/admin/tickets/$ticketId/{-$section}"
                    params={{ ticketId: detail.id, section: 'closure' }}
                    search={recordSearch ?? {}}
                    aria-disabled={busy || undefined}
                    className={buttonVariants({ variant: 'outline', className: 'min-h-11 w-fit' })}
                  >
                    <Archive aria-hidden="true" className="size-4" />
                    {lifecycleFormText('openClosureReview', locale)}
                  </Link>
                )}
              <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
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
                  <div className="min-w-0">
                    <dt className="text-sm text-muted-foreground">{text('related')}</dt>
                    <dd>
                      <RelatedTicketRecord ticket={detail} staff={staff} locale={locale} />
                    </dd>
                  </div>
                )}
              </dl>
            </header>
            <div className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-6">
              <p className="text-xs font-medium text-muted-foreground">
                {text(`category.${detail.category ?? 'general'}`)}
              </p>
              <p className="whitespace-pre-wrap" dir="auto">
                {detail.body}
              </p>
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
                      href={
                        staff
                          ? `/admin/tickets/${encodeURIComponent(detail.privacyClosureExportTicketId)}`
                          : `/tickets/${encodeURIComponent(detail.privacyClosureExportTicketId)}`
                      }
                      className="text-primary underline underline-offset-2"
                    >
                      {t('tickets.closure.export', locale)} · {detail.privacyClosureExportTicketId}
                    </a>
                  )}
                  {!staff && (
                    <Link
                      to="/tickets/new"
                      search={{}}
                      className="block text-primary underline underline-offset-2"
                    >
                      {text('create')}
                    </Link>
                  )}
                </section>
              )}
              {!staff && detail.status !== 'open' && !detail.privacyClosureCompletedAt && (
                <Button className="hover:bg-primary" disabled={busy} onClick={() => void reopen()}>
                  {text('reopen')}
                </Button>
              )}
              <div className="border-t pt-4">
                <TicketCommentThread
                  ticketId={detail.id}
                  headingLevel={entry?.kind === 'record' ? 2 : 3}
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
              </div>
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
            </div>
            {staff && (
              <section
                className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-5"
                aria-labelledby="ticket-management-heading"
              >
                <h2 id="ticket-management-heading" className="font-semibold">
                  {tTicketForms('manageTicket', locale)}
                </h2>
                {!canWrite && (
                  <p className="text-sm text-muted-foreground">
                    {tTicketForms('staffReadOnly', locale)}
                  </p>
                )}
                {staff && (
                  <p>
                    {text('assignee')}:{' '}
                    {assignees.find((person) => person.id === detail.assignedTo)?.name ??
                      detail.assignedTo ??
                      text('unassigned')}
                  </p>
                )}
                {staff && detail.customer && (
                  <section
                    aria-labelledby="ticket-customer-heading"
                    className="space-y-2 border-y py-3"
                  >
                    <h3 id="ticket-customer-heading" className="font-semibold">
                      {text('customerInfo')}
                    </h3>
                    <dl className="grid gap-3 text-sm sm:max-lg:grid-cols-2">
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
                                className="touch-action text-blue-700 dark:text-blue-300 underline"
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
                {!entry && canReviewClosure && !detail.privacyClosureCompletedAt && (
                  <ProfileClosureReview
                    ticketId={detail.id}
                    locale={locale}
                    coordination={command.coordination}
                    disabled={busy}
                    onCompleted={() => void refreshSelected(detail.id)}
                  />
                )}
                {staff && (canWrite || viewer?.canAssignOthers) && (
                  <Suspense fallback={<LoadingStatus>{text('loading')}</LoadingStatus>}>
                    <TicketStaffForms
                      key={identity + editorRevision + detail.id}
                      ticket={detail}
                      scope={scope}
                      locale={locale}
                      canWrite={!!canWrite}
                      canAssign={!!viewer?.canAssignOthers}
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
                  </Suspense>
                )}
              </section>
            )}
          </article>
        )
      )}
    </section>
  );
}
