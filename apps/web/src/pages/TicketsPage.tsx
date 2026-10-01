import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { Button, Input, Label, ListPage, ScrollArea } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import type { SupportListQuery } from '../lib/support-list-query.js';
import { ProfileClosureReview } from '../components/ProfileClosureReview.js';
import {
  isAllowedInvoiceReceiptFile,
  uploadTicketAttachment,
} from '../lib/invoice-bank-receipt-upload.js';

type Status = 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed';
interface Ticket {
  id: string;
  subject: string;
  body: string;
  category?: 'general' | 'billing' | 'orders' | 'privacy';
  privacyRequestType?: 'export' | 'closure' | null;
  privacyClosureCompletedAt?: string | null;
  privacyClosureAnonymized?: boolean | null;
  privacyClosureRetained?: Record<string, number> | null;
  privacyClosureExportTicketId?: string | null;
  status: Status;
  priority: string;
  profileId: string | null;
  assignedTeamId?: string | null;
  userId: string;
  assignedTo: string | null;
  updatedAt: string;
  relatedEntityId: string | null;
  relatedEntityType: string | null;
  attachments: string[];
  attachmentDownloadUrls?: string[];
  customer?: {
    userId: string;
    username: string;
    email: string | null;
    mobile: string | null;
    profile: { id: string; title: string | null } | null;
  };
}
interface Comment {
  id: string;
  authorId: string;
  body: string;
  visibility: string;
  createdAt: string;
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
interface Options {
  profiles: { id: string; title: string | null }[];
  records: { id: string; type: string; created_at: string }[];
  hasMoreRecords?: boolean;
}
const statuses: Status[] = [
  'open',
  'in_progress',
  'waiting_customer',
  'waiting_staff',
  'resolved',
  'closed',
];
const transitions: Record<Status, Status[]> = {
  open: ['in_progress'],
  in_progress: ['waiting_customer', 'waiting_staff', 'resolved'],
  waiting_customer: ['in_progress'],
  waiting_staff: ['in_progress'],
  resolved: ['closed'],
  closed: [],
};
export function CustomerTicketsPage({ queries }: { queries?: SupportListQuery } = {}) {
  return <Tickets staff={false} {...(queries ? { queries } : {})} />;
}
function RelatedTicketRecord({
  ticket,
  staff,
  locale,
}: {
  ticket: Ticket;
  staff: boolean;
  locale: 'fa' | 'en';
}) {
  if (!ticket.relatedEntityId) return <>{t('tickets.none', locale)}</>;
  const label = `${t(`tickets.${ticket.relatedEntityType ?? 'related'}`, locale)} ${ticket.relatedEntityId}`;
  if (!staff && ticket.relatedEntityType === 'invoice')
    return (
      <a
        className="text-blue-700 dark:text-blue-300 underline break-all"
        href={`/invoices/${encodeURIComponent(ticket.relatedEntityId)}`}
      >
        {label}
      </a>
    );
  return (
    <span className="break-all">
      {label}
      <span className="block text-sm text-muted-foreground">
        {t('tickets.recordUnavailable', locale)}
      </span>
    </span>
  );
}
export function StaffTicketsPage({ queries }: { queries?: SupportListQuery } = {}) {
  return <Tickets staff {...(queries ? { queries } : {})} />;
}
function Tickets({ staff, queries }: { staff: boolean; queries?: SupportListQuery }) {
  const queryRef = useRef(queries);
  queryRef.current = queries;
  const time = useAccountTime();
  const routeSearch = useSearch({ strict: false }) as {
    ticketId?: string;
    status?: 'active';
    scope?: 'active';
  };
  const activeScoped = !staff && routeSearch.scope === 'active';
  const locale = useLocale(),
    prefix = staff ? '/api/staff/tickets' : '/api/tickets';
  const text = (key: string) => t(`tickets.${key}`, locale);
  const generation = useRef(0),
    detailGeneration = useRef(0),
    inFlight = useRef(false);
  const uploads = useRef(new Map<File, string>()),
    heading = useRef<HTMLHeadingElement>(null);
  const [queue, setQueue] = useState<Queue | null>(null),
    [loading, setLoading] = useState(true),
    [queueError, setQueueError] = useState(''),
    [acceptedContext, setAcceptedContext] = useState(''),
    [acceptedPage, setAcceptedPage] = useState(1),
    [queueAccessDenied, setQueueAccessDenied] = useState(false);
  const queueDenied = useRef(false);
  const [localPage, setLocalPage] = useState(1),
    [localFilter, setLocalFilter] = useState(routeSearch.status === 'active' ? 'active' : ''),
    [localSearch, setLocalSearch] = useState(''),
    [localTerm, setTerm] = useState('');
  const page = queries?.queue.query.page ?? localPage;
  const filter = queries?.queue.query.filters.status ?? localFilter;
  const search = queries?.queue.searchInput ?? localSearch;
  const term = queries?.queue.query.search ?? localTerm;
  const setPage = (value: number, replace = false) =>
    queryRef.current
      ? queryRef.current.queue.setQuery({ page: value }, replace)
      : setLocalPage(value);
  const setFilter = (value: string) =>
    queries ? queries.queue.setQuery({ filters: { status: value } }) : setLocalFilter(value);
  const setSearch = (value: string) =>
    queries ? queries.queue.setSearchInput(value) : setLocalSearch(value);
  const [localSort, setLocalSort] = useState('desc'),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const sort = queries?.queue.query.order ?? localSort;
  const setSort = (value: string) =>
    queries
      ? queries.queue.setQuery({ order: value === 'asc' ? 'asc' : 'desc' })
      : setLocalSort(value);
  const [loadedDetail, setDetail] = useState<Ticket | null>(null),
    [comments, setComments] = useState<Comment[]>([]),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState(''),
    [selectedId, setSelectedId] = useState('');
  const detail = !queries || loadedDetail?.id === queries.selected ? loadedDetail : null;
  const [reply, setReply] = useState(''),
    [internal, setInternal] = useState(false),
    [nextStatus, setNextStatus] = useState<Status>('open');
  const [teams, setTeams] = useState<{ id: string; name: string; members: string[] }[]>([]),
    [teamId, setTeamId] = useState('');
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]),
    [assignee, setAssignee] = useState(''),
    [assignmentError, setAssignmentError] = useState(''),
    [assignmentLoading, setAssignmentLoading] = useState(false),
    [assignmentVersion, setAssignmentVersion] = useState(0);
  const [creating, setCreating] = useState(false),
    [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [category, setCategory] = useState('general'),
    [priority, setPriority] = useState('normal');
  const [recordPage, setRecordPage] = useState(1);
  const [profileId, setProfileId] = useState(''),
    [record, setRecord] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [fileVersion, setFileVersion] = useState(0);
  const [options, setOptions] = useState<Options | null>(null),
    [optionsLoading, setOptionsLoading] = useState(false),
    [optionsVersion, setOptionsVersion] = useState(0),
    [optionsError, setOptionsError] = useState('');
  const context = JSON.stringify([prefix, term, sort, filter, activeScoped]);
  const visibleQueue = acceptedContext === context ? queue : null;
  function discardDetail(updateUrl = true) {
    if (updateUrl && queryRef.current?.selected) queryRef.current.select(null, true);
    ++detailGeneration.current;
    setDetail(null);
    setComments([]);
    setDetailLoading(false);
    setDetailError('');
    setSelectedId('');
    setReply('');
    setInternal(false);
    setAssignee('');
    setTeamId('');
  }
  const load = useCallback(async () => {
    const current = ++generation.current;
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
      });
      const response = await fetch(`${prefix}?${query}`, { credentials: 'include' });
      if (!response.ok)
        throw new Error([401, 403].includes(response.status) ? 'forbidden' : 'error');
      const data = (await response.json()) as Queue;
      if (
        !Array.isArray(data.data) ||
        !Number.isSafeInteger(data.totalPages) ||
        data.totalPages < 0
      )
        throw new Error('error');
      if (current === generation.current) {
        queueDenied.current = false;
        setQueueAccessDenied(false);
        setQueue(data);
        setAcceptedContext(context);
        setAcceptedPage(page);
        // Removed tickets can make the requested page disappear while it is loading.
        if (page > Math.max(1, data.totalPages)) setPage(Math.max(1, data.totalPages), true);
        // A refreshed authority can revoke closure approval or assignment controls.
        if (staff && !data.viewer?.canAssignOthers) {
          setAssignees([]);
          setTeams([]);
        }
      }
    } catch (reason) {
      if (current === generation.current) {
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
          setSubject('');
          setBody('');
          setOptions(null);
          setProfileId('');
          setRecord('');
          setRecordPage(1);
          setFiles([]);
          uploads.current.clear();
          setSaved(false);
        }
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [prefix, page, term, sort, filter, activeScoped, context, staff]);
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
      setTerm(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, term]);
  useEffect(() => {
    if (staff || !creating) return;
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError('');
    setOptions(null);
    void fetch(
      `/api/tickets/options${profileId ? `?profileId=${encodeURIComponent(profileId)}&recordPage=${recordPage}` : ''}`,
      { credentials: 'include', signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? 'forbidden' : 'error');
        const data = await response.json();
        if (!controller.signal.aborted) setOptions(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setOptionsError(reason instanceof Error ? reason.message : 'error');
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [staff, creating, profileId, optionsVersion, recordPage]);
  useEffect(() => {
    if (!staff || !queue?.viewer?.canAssignOthers) return;
    const controller = new AbortController();
    setAssignmentLoading(true);
    setAssignmentError('');
    void Promise.all(
      ['assignees', 'teams'].map((path) =>
        fetch(`${prefix}/${path}`, { credentials: 'include', signal: controller.signal })
      )
    )
      .then(async (responses) => {
        if (responses.some((response) => response.status === 403)) throw new Error('forbidden');
        if (responses.some((response) => !response.ok)) throw new Error('error');
        const [people, groups] = await Promise.all(responses.map((response) => response.json()));
        if (!controller.signal.aborted) {
          setAssignees(people);
          setTeams(groups);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          const failure = reason instanceof Error ? reason.message : 'error';
          setAssignmentError(failure);
          if (failure === 'forbidden') {
            setAssignees([]);
            setTeams([]);
            setAssignee('');
            setTeamId('');
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAssignmentLoading(false);
      });
    return () => controller.abort();
  }, [staff, prefix, queue?.viewer?.canAssignOthers, assignmentVersion]);
  async function select(id: string) {
    if (queueDenied.current) return;
    setSelectedId(id);
    setDetailError('');
    const current = ++detailGeneration.current;
    setDetail(null);
    setComments([]);
    setDetailLoading(true);
    setReply('');
    setInternal(false);
    try {
      const [recordResponse, commentsResponse] = await Promise.all([
        fetch(`${prefix}/${encodeURIComponent(id)}`, { credentials: 'include' }),
        fetch(`${prefix}/${encodeURIComponent(id)}/comments`, { credentials: 'include' }),
      ]);
      if (
        [401, 403].includes(recordResponse.status) ||
        [401, 403].includes(commentsResponse.status)
      )
        throw new Error('forbidden');
      if (!recordResponse.ok || !commentsResponse.ok) throw new Error('error');
      const [ticket, conversation] = await Promise.all([
        recordResponse.json(),
        commentsResponse.json(),
      ]);
      if (current === detailGeneration.current && !queueDenied.current) {
        setDetail(ticket);
        setComments(conversation);
        setNextStatus(transitions[ticket.status as Status]?.[0] ?? 'open');
        setAssignee(ticket.assignedTo ?? '');
        setTeamId(ticket.assignedTeamId ?? '');
      }
    } catch (reason) {
      if (current === detailGeneration.current)
        setDetailError(reason instanceof Error ? reason.message : 'error');
    } finally {
      if (current === detailGeneration.current) setDetailLoading(false);
    }
  }
  const selectedLink = queries ? queries.selected : routeSearch.ticketId;
  useEffect(() => {
    if (selectedLink) void select(selectedLink);
    else if (queries) discardDetail(false);
    return () => {
      ++detailGeneration.current;
    };
  }, [selectedLink, prefix]);
  useEffect(() => {
    if (detail) heading.current?.focus();
  }, [detail?.id]);
  useEffect(
    () => () => {
      ++detailGeneration.current;
    },
    []
  );
  async function mutate(path: string, method: string, payload: unknown, id?: string) {
    const selection = detailGeneration.current;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch(path, {
        method,
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (selection === detailGeneration.current)
          setError(
            response.status === 409 ? 'conflict' : response.status === 403 ? 'forbidden' : 'error'
          );
        return;
      }
      if (selection === detailGeneration.current) setSaved(true);
      await latestLoad.current();
      if (id && selection === detailGeneration.current) await select(id);
    } catch {
      if (selection === detailGeneration.current) setError('error');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    const selection = detailGeneration.current;
    event.preventDefault();
    if (
      inFlight.current ||
      files.length > 5 ||
      files.some((file) => !isAllowedInvoiceReceiptFile(file))
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      const keys: string[] = [];
      for (const file of files) {
        let key = uploads.current.get(file);
        if (!key) {
          key = (await uploadTicketAttachment(file, profileId || null)) ?? undefined;
          if (!key) throw new Error();
          uploads.current.set(file, key);
        }
        keys.push(key);
      }
      const related = options?.records.find((item) => `${item.type}:${item.id}` === record);
      const response = await fetch(prefix, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          category,
          priority,
          profileId: profileId || null,
          attachments: keys,
          ...(related ? { relatedEntityType: related.type, relatedEntityId: related.id } : {}),
        }),
      });
      if (!response.ok) {
        setError(response.status === 409 ? 'conflict' : 'error');
        return;
      }
      const created = (await response.json()) as Ticket;
      setSaved(true);
      setCreating(false);
      setSubject('');
      setBody('');
      setCategory('general');
      setFiles([]);
      uploads.current.clear();
      setFileVersion((value) => value + 1);
      await latestLoad.current();
      if (selection === detailGeneration.current) {
        if (queryRef.current) queryRef.current.select(created.id);
        else await select(created.id);
      }
    } catch {
      setError('error');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const canWrite =
    !staff ||
    (queue?.viewer?.canWrite &&
      (queue.viewer.canAssignOthers || detail?.assignedTo === queue.viewer.userId));
  const formatDate = time.format;
  return (
    <section
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
      {error && (
        <p role="alert">{text(['conflict', 'forbidden'].includes(error) ? error : 'error')}</p>
      )}
      {saved && <p role="status">{text('saved')}</p>}
      {creating && (
        <form
          onSubmit={(event) => void create(event)}
          className="rounded border bg-card text-card-foreground p-4"
        >
          <fieldset disabled={busy} className="space-y-3">
            <div>
              <Label htmlFor="ticket-subject">{text('subject')}</Label>
              <Input
                id="ticket-subject"
                maxLength={200}
                required
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ticket-body">{text('body')}</Label>
              <textarea
                id="ticket-body"
                className="block w-full rounded border border-input bg-background text-foreground p-2"
                maxLength={10000}
                required
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ticket-category">{text('category')}</Label>
              <select
                id="ticket-category"
                className="block rounded border border-input bg-background text-foreground p-2"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {['general', 'billing', 'orders', 'privacy'].map((value) => (
                  <option key={value} value={value}>
                    {text(`category.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="ticket-priority">{text('priority')}</Label>
              <select
                id="ticket-priority"
                className="block rounded border border-input bg-background text-foreground p-2"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                {['normal', 'high'].map((value) => (
                  <option value={value} key={value}>
                    {text(value)}
                  </option>
                ))}
              </select>
            </div>
            {optionsLoading ? (
              <p role="status">{text('loading')}</p>
            ) : options ? (
              <>
                <div>
                  <Label htmlFor="ticket-profile">{text('profile')}</Label>
                  <select
                    id="ticket-profile"
                    className="block max-w-full rounded border border-input bg-background text-foreground p-2"
                    value={profileId}
                    onChange={(event) => {
                      setProfileId(event.target.value);
                      setRecord('');
                      setRecordPage(1);
                      uploads.current.clear();
                    }}
                  >
                    <option value="">{text('noProfile')}</option>
                    {options.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.title ?? text('unnamed')}
                      </option>
                    ))}
                  </select>
                </div>
                {profileId && (
                  <div>
                    <Label htmlFor="ticket-record">{text('related')}</Label>
                    <select
                      id="ticket-record"
                      className="block max-w-full rounded border border-input bg-background text-foreground p-2"
                      value={record}
                      onChange={(event) => setRecord(event.target.value)}
                    >
                      <option value="">{text('none')}</option>
                      {options.records.map((item) => (
                        <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>
                          {text(item.type)} · {item.id.slice(-8)} · {formatDate(item.created_at)}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={recordPage === 1}
                        onClick={() => {
                          setRecord('');
                          setRecordPage((value) => value - 1);
                        }}
                      >
                        {text('previous')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!options.hasMoreRecords}
                        onClick={() => {
                          setRecord('');
                          setRecordPage((value) => value + 1);
                        }}
                      >
                        {text('next')}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div role="alert" className="space-y-2">
                <p>{text(optionsError === 'forbidden' ? 'forbidden' : 'optionsError')}</p>
                {optionsError !== 'forbidden' && (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setOptionsVersion((value) => value + 1)}
                  >
                    {text('retry')}
                  </Button>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="ticket-files">{text('files')}</Label>
              <Input
                id="ticket-files"
                key={fileVersion}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
              <p className="text-sm">{text('fileHelp')}</p>
              {(files.length > 5 || files.some((file) => !isAllowedInvoiceReceiptFile(file))) && (
                <p role="alert">{text('invalidFiles')}</p>
              )}
            </div>
            <Button
              className="hover:bg-primary"
              type="submit"
              disabled={
                !subject.trim() ||
                !body.trim() ||
                files.length > 5 ||
                files.some((file) => !isAllowedInvoiceReceiptFile(file)) ||
                optionsLoading ||
                !options
              }
            >
              {text(busy ? 'saving' : 'submit')}
            </Button>
          </fieldset>
        </form>
      )}
      <ListPage>
        <ListPage.Toolbar>
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
            <ScrollArea
              scrollbarOrientation="horizontal"
              role="region"
              aria-label={text(staff ? 'staffTitle' : 'title')}
            >
              <table className="w-full text-start">
                <caption className="sr-only">{text(staff ? 'staffTitle' : 'title')}</caption>
                <thead>
                  <tr>
                    {[
                      'subject',
                      'category',
                      'status',
                      'priority',
                      'updated',
                      'related',
                      ...(staff ? ['customer', 'assignee', 'target'] : []),
                    ].map((key) => (
                      <th scope="col" key={key} className="p-2 text-start">
                        {text(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleQueue.data.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2">
                        <button
                          disabled={busy}
                          className="text-blue-700 dark:text-blue-300 underline text-start"
                          onClick={() => {
                            setError('');
                            if (queries && queries.selected !== item.id) queries.select(item.id);
                            else void select(item.id);
                          }}
                        >
                          {item.subject}
                        </button>
                      </td>
                      <td className="p-2">{text(`category.${item.category ?? 'general'}`)}</td>
                      <td className="p-2">
                        <span className="rounded-full bg-muted px-2 py-1 text-sm font-medium">
                          {text(item.status)}
                        </span>
                      </td>
                      <td className="p-2">
                        <span className="rounded-full border px-2 py-1 text-sm">
                          {text(item.priority)}
                        </span>
                      </td>
                      <td className="p-2 whitespace-nowrap">{formatDate(item.updatedAt)}</td>
                      <td className="p-2">
                        <RelatedTicketRecord ticket={item} staff={staff} locale={locale} />
                      </td>
                      {staff && (
                        <>
                          <td className="p-2">{item.userId}</td>
                          <td className="p-2">
                            {assignees.find((person) => person.id === item.assignedTo)?.name ??
                              item.assignedTo ??
                              text('unassigned')}
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            {visibleQueue.responseTargetHours &&
                            ['open', 'in_progress', 'waiting_staff'].includes(item.status)
                              ? formatDate(
                                  new Date(
                                    new Date(item.updatedAt).getTime() +
                                      visibleQueue.responseTargetHours * 3600000
                                  ).toISOString()
                                )
                              : text('none')}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
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
        <article className="rounded border bg-card text-card-foreground p-4 space-y-4 break-words">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">
            {detail.subject}
          </h2>
          <p>
            {text(detail.status)} · {text(detail.priority)}
          </p>
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
          {detail.relatedEntityId && (
            <p>
              <RelatedTicketRecord ticket={detail} staff={staff} locale={locale} />
            </p>
          )}
          {(detail.attachmentDownloadUrls ?? [])
            .filter((url) => /^https?:\/\//.test(url))
            .map((url, index) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-blue-700 dark:text-blue-300 underline"
              >
                {text('attachment')} {index + 1}
              </a>
            ))}
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
                onCompleted={() => {
                  void load();
                  void select(detail.id);
                }}
              />
            )}
          {staff && queue?.viewer?.canAssignOthers && (
            <div className="space-y-3">
              {assignmentLoading && <p role="status">{text('loading')}</p>}
              {assignmentError && (
                <div role="alert" className="space-y-2">
                  <p>{text(assignmentError === 'forbidden' ? 'forbidden' : 'assignmentError')}</p>
                  {assignmentError !== 'forbidden' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setAssignmentVersion((value) => value + 1)}
                    >
                      {text('retry')}
                    </Button>
                  )}
                </div>
              )}
              <fieldset
                disabled={busy || assignmentLoading || !!assignmentError}
                className="flex min-w-0 flex-wrap items-end gap-3"
              >
                <div>
                  <Label htmlFor="ticket-team">{text('team')}</Label>
                  <select
                    id="ticket-team"
                    disabled={busy}
                    className="block rounded border border-input bg-background text-foreground p-2"
                    value={teamId}
                    onChange={(event) => {
                      setTeamId(event.target.value);
                      setAssignee('');
                    }}
                  >
                    <option value="">{text('directAssignment')}</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="ticket-assignee">{text('assignee')}</Label>
                  <select
                    id="ticket-assignee"
                    disabled={busy}
                    className="block rounded border border-input bg-background text-foreground p-2"
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                  >
                    <option value="">{text('choose')}</option>
                    {assignees
                      .filter(
                        (person) =>
                          !teamId ||
                          teams.find((team) => team.id === teamId)?.members.includes(person.id)
                      )
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                  </select>
                </div>
                <Button
                  className="hover:bg-primary"
                  disabled={busy || !assignee}
                  onClick={() =>
                    void mutate(
                      `${prefix}/${detail.id}/assign`,
                      'PUT',
                      { assigneeId: assignee, ...(teamId ? { teamId } : {}) },
                      detail.id
                    )
                  }
                >
                  {text('assign')}
                </Button>
              </fieldset>
            </div>
          )}
          {staff && canWrite && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="ticket-next-status">{text('changeStatus')}</Label>
                <select
                  id="ticket-next-status"
                  disabled={busy}
                  className="block rounded border border-input bg-background text-foreground p-2"
                  value={nextStatus}
                  onChange={(event) => setNextStatus(event.target.value as Status)}
                >
                  {[
                    ...transitions[detail.status],
                    ...(detail.status !== 'open' ? ['open'] : []),
                  ].map((value) => (
                    <option key={value} value={value}>
                      {text(value)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                className="hover:bg-primary"
                disabled={busy || (detail.status === 'open' && !detail.assignedTo)}
                onClick={() =>
                  void mutate(
                    `${prefix}/${detail.id}/status`,
                    'PATCH',
                    { status: nextStatus },
                    detail.id
                  )
                }
              >
                {text('saveStatus')}
              </Button>
            </div>
          )}
          {!staff && detail.status !== 'open' && !detail.privacyClosureCompletedAt && (
            <Button
              className="hover:bg-primary"
              disabled={busy}
              onClick={() =>
                void mutate(`${prefix}/${detail.id}/status`, 'PATCH', { status: 'open' }, detail.id)
              }
            >
              {text('reopen')}
            </Button>
          )}
          <h3 className="font-semibold">{text('conversation')}</h3>
          {comments
            .filter((item) => staff || item.visibility === 'public')
            .map((item) => (
              <div
                key={item.id}
                className={`rounded border p-3 ${item.visibility === 'internal' ? 'border-warning/20 bg-warning-soft dark:border-amber-700 dark:bg-amber-950' : 'bg-muted'}`}
              >
                <p className="text-sm">
                  {item.authorId} · {formatDate(item.createdAt)} · {text(item.visibility)}
                </p>
                <p className="whitespace-pre-wrap">{item.body}</p>
              </div>
            ))}
          {canWrite && !['closed', 'resolved'].includes(detail.status) && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (reply.trim())
                  void mutate(
                    `${prefix}/${detail.id}/comments`,
                    'POST',
                    { body: reply.trim(), visibility: staff && internal ? 'internal' : 'public' },
                    detail.id
                  );
              }}
            >
              <Label htmlFor="ticket-reply">{text('reply')}</Label>
              <textarea
                id="ticket-reply"
                disabled={busy}
                required
                maxLength={10000}
                className="block w-full rounded border border-input bg-background text-foreground p-2"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
              />
              {staff && (
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={internal}
                    onChange={(event) => setInternal(event.target.checked)}
                  />
                  {text('internal')}
                </Label>
              )}
              <Button className="hover:bg-primary" disabled={busy || !reply.trim()} type="submit">
                {text(busy ? 'saving' : 'send')}
              </Button>
            </form>
          )}
        </article>
      )}
    </section>
  );
}
