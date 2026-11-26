import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { TicketListFilters } from '../lib/support-list-query.js';
import { Badge, Button, StatusBadge, type ListView, type StatusTone } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { HistoryTable, type HistoryColumn } from './HistoryTable.js';
import { formatRelativeTime } from '../lib/relative-time.js';

export type TicketStatus =
  'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed';
export interface TicketViewer {
  userId: string;
  canWrite: boolean;
  canAssignOthers: boolean;
  canApproveClosure?: boolean;
}
export interface Ticket {
  id: string;
  subject: string;
  body: string;
  category?: 'general' | 'billing' | 'orders' | 'privacy';
  privacyRequestType?: 'export' | 'closure' | null;
  privacyClosureCompletedAt?: string | null;
  privacyClosureAnonymized?: boolean | null;
  privacyClosureRetained?: Record<string, number> | null;
  privacyClosureExportTicketId?: string | null;
  status: TicketStatus;
  priority: string;
  profileId: string | null;
  assignedTeamId?: string | null;
  userId: string;
  assignedTo: string | null;
  createdAt?: string;
  updatedAt: string;
  relatedEntityId: string | null;
  relatedEntityType: string | null;
  relatedRecord?: {
    sourceId: string;
    destination: 'contract' | 'invoice' | 'electricity_order' | 'saving_order';
    id: string;
  } | null;
  attachments: string[];
  attachmentDownloadUrls?: string[];
  attachmentFiles?: {
    key: string;
    fileName: string;
    contentType: string;
    url: string;
    fileIndex: number;
  }[];
  customer?: {
    userId: string;
    username: string;
    email: string | null;
    mobile: string | null;
    profile: { id: string; title: string | null } | null;
  };
  viewer?: TicketViewer;
  latestReply?: { id: string; preview: string; createdAt: string } | null;
  hasUnreadReply?: boolean;
}
export function RelatedTicketRecord({
  ticket,
  staff,
  locale,
}: {
  ticket: Ticket;
  staff: boolean;
  locale: 'fa' | 'en';
}) {
  if (!ticket.relatedEntityId) return <>{t('tickets.none', locale)}</>;
  const label = (
    <>
      {t(`tickets.${ticket.relatedEntityType ?? 'related'}`, locale)}{' '}
      <bdi dir="ltr">{ticket.relatedEntityId}</bdi>
    </>
  );
  const record = ticket.relatedRecord;
  let href: string | null = null;
  if (
    record &&
    record.sourceId === ticket.relatedEntityId &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(record.id)
  ) {
    const id = encodeURIComponent(record.id);
    if (record.destination === 'contract' && ticket.relatedEntityType === 'contract')
      href = staff ? `/admin/contracts/${id}` : `/contracts/${id}`;
    if (record.destination === 'invoice' && ticket.relatedEntityType === 'invoice')
      href = staff ? `/admin/invoices/${id}` : `/invoices/${id}`;
    if (record.destination === 'electricity_order' && ticket.relatedEntityType === 'order')
      href = staff ? `/admin/electricity-orders/${id}` : `/electricity/orders/${id}`;
    if (record.destination === 'saving_order' && ticket.relatedEntityType === 'order')
      href = staff ? `/admin/saving-orders/${id}` : `/savings/orders/${id}`;
  } else if (record === undefined && !staff && ticket.relatedEntityType === 'invoice') {
    href = `/invoices/${encodeURIComponent(ticket.relatedEntityId)}`;
  }
  if (href)
    return (
      <a className="text-primary underline break-all" href={href}>
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

/** Present only the accepted queue; view and disclosure changes never fetch tickets. */
export function TicketQueueRecords({
  items,
  staff,
  locale,
  view,
  busy,
  selectedId,
  assignees,
  responseTargetHours,
  formatDate,
  recordSearch,
  onSelect,
}: {
  items: readonly Ticket[];
  staff: boolean;
  locale: Locale;
  view: ListView;
  busy: boolean;
  selectedId: string | null;
  assignees: readonly { id: string; name: string }[];
  responseTargetHours?: number | null | undefined;
  formatDate: (value: string) => string;
  recordSearch?: TicketListFilters;
  onSelect: (id: string) => void;
}) {
  const text = (key: string) => t(`tickets.${key}`, locale);
  const copy = (key: string) => tTicketForms(key, locale);
  const [now, setNow] = useState(() => new Date());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    setExpanded((previous) => {
      const kept = new Set([...previous].filter((id) => ids.has(id)));
      return kept.size === previous.size ? previous : kept;
    });
  }, [items]);
  function subject(item: Ticket) {
    if (recordSearch) {
      return (
        <Link
          to={staff ? '/admin/tickets/$ticketId/{-$section}' : '/tickets/$ticketId'}
          params={{ ticketId: item.id }}
          search={recordSearch}
          className="inline-flex min-h-8 max-w-full items-center text-start font-semibold wrap-anywhere text-primary hover:underline pointer-coarse:min-h-11"
        >
          {item.subject}
        </Link>
      );
    }
    return (
      <Button
        variant="link"
        className="h-auto max-w-full justify-start whitespace-normal p-0 text-start break-words"
        disabled={busy}
        aria-current={selectedId === item.id ? 'true' : undefined}
        onClick={() => onSelect(item.id)}
      >
        {item.subject}
      </Button>
    );
  }
  const status = (item: Ticket) => <TicketStatusBadge status={item.status} locale={locale} />;
  const priority = (item: Ticket) =>
    item.priority === 'high' ? (
      <TicketPriorityBadge priority={item.priority} locale={locale} />
    ) : null;
  const unread = (item: Ticket) =>
    !staff && item.hasUnreadReply ? (
      <Badge className="bg-primary text-primary-foreground">{copy('newReply')}</Badge>
    ) : null;
  function replyPreview(item: Ticket) {
    const reply = item.latestReply;
    if (!reply) return null;
    return (
      <div data-slot="ticket-reply-preview" className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium">
            {copy(staff ? 'latestPublicReply' : 'latestStaffReply')}
          </span>
          <time dateTime={reply.createdAt}>{formatDate(reply.createdAt)}</time>
        </div>
        <p
          dir="auto"
          className="line-clamp-2 text-sm font-normal wrap-anywhere text-muted-foreground"
        >
          {reply.preview || copy('replyWithAttachment')}
        </p>
      </div>
    );
  }
  function updated(item: Ticket) {
    const stamp = new Date(item.updatedAt);
    const age = now.getTime() - stamp.getTime();
    const relative =
      age >= 0 && Number.isFinite(age)
        ? formatRelativeTime(stamp, locale, now) || text('updatedNow')
        : '';
    const absolute = formatDate(item.updatedAt);
    return (
      <div className="space-y-0.5">
        <time
          dateTime={Number.isFinite(stamp.getTime()) ? item.updatedAt : undefined}
          title={relative ? absolute : undefined}
        >
          {relative || absolute}
        </time>
      </div>
    );
  }
  function target(item: Ticket) {
    const due = new Date(new Date(item.updatedAt).getTime() + (responseTargetHours ?? 0) * 3600000);
    return responseTargetHours &&
      Number.isFinite(due.getTime()) &&
      ['open', 'in_progress', 'waiting_staff'].includes(item.status)
      ? formatDate(due.toISOString())
      : null;
  }
  function owner(item: Ticket) {
    return (
      assignees.find((person) => person.id === item.assignedTo)?.name ??
      item.assignedTo ??
      text('unassigned')
    );
  }
  function classification(item: Ticket) {
    return (
      <span className="text-xs font-normal text-muted-foreground">
        {text(`category.${item.category ?? 'general'}`)}
      </span>
    );
  }
  function state(item: Ticket) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {status(item)}
        {priority(item)}
      </div>
    );
  }
  function more(item: Ticket) {
    return (
      <details open={expanded.has(item.id)} className="min-w-0">
        <summary
          className="w-fit cursor-pointer rounded py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:py-3"
          aria-label={`${text('queueDetails')}: ${item.subject}`}
          onClick={(event) => {
            // Keep disclosure when changing between table and card views.
            event.preventDefault();
            setExpanded((previous) => {
              const next = new Set(previous);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
          }}
        >
          {text('queueDetails')}
        </summary>
        <dl className="grid gap-3 pb-2 text-sm font-normal">
          <div>
            <dt className="text-xs text-muted-foreground">{text('updated')}</dt>
            <dd>
              <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
            </dd>
          </div>
          {item.priority !== 'high' && (
            <div>
              <dt className="text-xs text-muted-foreground">{text('priority')}</dt>
              <dd>
                <TicketPriorityBadge priority={item.priority} locale={locale} />
              </dd>
            </div>
          )}
          {item.relatedEntityId && (
            <div>
              <dt className="text-xs text-muted-foreground">{text('related')}</dt>
              <dd>
                <RelatedTicketRecord ticket={item} staff={staff} locale={locale} />
              </dd>
            </div>
          )}
          {staff && (
            <div>
              <dt className="text-xs text-muted-foreground">{text('customer')}</dt>
              <dd className="wrap-anywhere">
                <bdi>{item.userId}</bdi>
              </dd>
            </div>
          )}
        </dl>
      </details>
    );
  }
  function assignment(item: Ticket) {
    const due = target(item);
    return (
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="sr-only">{text('assignee')}</dt>
          <dd className="font-medium wrap-anywhere">{owner(item)}</dd>
        </div>
        {due && (
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
            <dt>{text('target')}</dt>
            <dd>{due}</dd>
          </div>
        )}
      </dl>
    );
  }
  const columns: HistoryColumn<Ticket>[] = [
    {
      id: 'subject',
      label: text('subject'),
      render: (item) => (
        <div className="min-w-40 max-w-80">
          <div className="flex flex-wrap items-center gap-x-2">
            {subject(item)}
            {unread(item)}
          </div>
          {classification(item)}
          {item.latestReply && <div className="mt-2">{replyPreview(item)}</div>}
        </div>
      ),
    },
    { id: 'status', label: text('status'), render: state },
    { id: 'updated', label: text('updated'), render: updated },
    ...(staff ? [{ id: 'assignee', label: text('assignee'), render: assignment }] : []),
    { id: 'details', label: text('queueDetails'), render: more },
  ];
  return (
    <div data-slot="ticket-queue-records" className="min-w-0" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {view === 'table' ? (
        <HistoryTable
          caption={text(staff ? 'staffTitle' : 'title')}
          items={items}
          columns={columns}
          rowKey={(item) => item.id}
        />
      ) : (
        <ul aria-label={text(staff ? 'staffTitle' : 'title')} className="grid gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="min-w-0 rounded-xl border bg-card px-4 pt-3 text-card-foreground"
            >
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2">
                  {subject(item)}
                  {unread(item)}
                </div>
                {classification(item)}
                {state(item)}
                {replyPreview(item)}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span>{text('updated')}</span>
                {updated(item)}
              </div>
              {staff && <div className="my-2">{assignment(item)}</div>}
              <div className="mt-3 border-t">{more(item)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TicketStatusBadge({ status, locale }: { status: TicketStatus; locale: Locale }) {
  const tone: Record<TicketStatus, StatusTone> = {
    open: 'info',
    in_progress: 'info',
    waiting_customer: 'warning',
    waiting_staff: 'warning',
    resolved: 'success',
    closed: 'default',
  };
  return <StatusBadge label={t(`tickets.${status}`, locale)} tone={tone[status]} />;
}

export function TicketPriorityBadge({ priority, locale }: { priority: string; locale: Locale }) {
  const code = { high: 'P1', normal: 'P2', low: 'P3' }[priority];
  return (
    <Badge variant={priority === 'high' ? 'destructive' : 'outline'}>
      <bdi dir="ltr">{code ?? priority}</bdi>
      {code && <span>{t(`tickets.${priority}`, locale)}</span>}
    </Badge>
  );
}
