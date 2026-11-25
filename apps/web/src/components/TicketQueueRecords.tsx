import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { TicketListFilters } from '../lib/support-list-query.js';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type ListView,
} from '@barghsa/ui';
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
          className="inline-flex min-h-8 max-w-full items-center break-words text-start font-medium text-primary hover:underline"
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
  const priority = (item: Ticket) => (
    <TicketPriorityBadge priority={item.priority} locale={locale} />
  );
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
        <p dir="auto" className="line-clamp-2 break-words text-sm">
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
      <div className="flex flex-col gap-1">
        <time dateTime={Number.isFinite(stamp.getTime()) ? item.updatedAt : undefined}>
          {relative || absolute}
        </time>
        {relative && <span className="text-xs text-muted-foreground">{absolute}</span>}
      </div>
    );
  }
  function target(item: Ticket) {
    const due = new Date(new Date(item.updatedAt).getTime() + (responseTargetHours ?? 0) * 3600000);
    return responseTargetHours &&
      Number.isFinite(due.getTime()) &&
      ['open', 'in_progress', 'waiting_staff'].includes(item.status)
      ? formatDate(due.toISOString())
      : text('none');
  }
  function owner(item: Ticket) {
    return (
      assignees.find((person) => person.id === item.assignedTo)?.name ??
      item.assignedTo ??
      text('unassigned')
    );
  }
  const columns: HistoryColumn<Ticket>[] = [
    {
      id: 'subject',
      label: text('subject'),
      render: (item) => (
        <div className="min-w-48 max-w-80 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2">
            {subject(item)}
            {unread(item)}
          </div>
          {replyPreview(item)}
        </div>
      ),
    },
    {
      id: 'category',
      label: text('category'),
      render: (item) => text(`category.${item.category ?? 'general'}`),
    },
    { id: 'status', label: text('status'), render: status },
    { id: 'priority', label: text('priority'), render: priority },
    { id: 'updated', label: text('updated'), render: updated },
    {
      id: 'related',
      label: text('related'),
      render: (item) => <RelatedTicketRecord ticket={item} staff={staff} locale={locale} />,
    },
    ...(staff
      ? [
          {
            id: 'customer',
            label: text('customer'),
            render: (item: Ticket) => <bdi>{item.userId}</bdi>,
          },
          {
            id: 'assignee',
            label: text('assignee'),
            render: owner,
          },
          { id: 'target', label: text('target'), render: target },
        ]
      : []),
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
            <li key={item.id} className="min-w-0">
              <Card>
                <CardHeader>
                  <CardTitle>{subject(item)}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {status(item)}
                    {priority(item)}
                    {unread(item)}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {replyPreview(item)}
                  <div>
                    <p className="text-sm text-muted-foreground">{text('updated')}</p>
                    {updated(item)}
                  </div>
                  {staff && (
                    <dl className="grid grid-cols-2 gap-3">
                      <div className="min-w-0 break-words">
                        <dt className="text-xs text-muted-foreground">{text('assignee')}</dt>
                        <dd className="text-sm">{owner(item)}</dd>
                      </div>
                      <div className="min-w-0 break-words">
                        <dt className="text-xs text-muted-foreground">{text('target')}</dt>
                        <dd className="text-sm">{target(item)}</dd>
                      </div>
                    </dl>
                  )}
                  <details open={expanded.has(item.id)}>
                    <summary
                      className="cursor-pointer rounded py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:py-3"
                      aria-label={`${text('queueDetails')}: ${item.subject}`}
                      onClick={(event) => {
                        // Native toggle events are deferred and can be lost during a view change.
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
                    <dl className="grid gap-3 pt-3 sm:grid-cols-2">
                      {columns
                        .filter(
                          (column) =>
                            ![
                              'subject',
                              'status',
                              'priority',
                              'updated',
                              'assignee',
                              'target',
                            ].includes(column.id)
                        )
                        .map((column) => (
                          <div key={column.id} className="min-w-0 break-words">
                            <dt className="text-sm text-muted-foreground">{column.label}</dt>
                            <dd>{column.render(item)}</dd>
                          </div>
                        ))}
                    </dl>
                  </details>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TicketStatusBadge({ status, locale }: { status: TicketStatus; locale: Locale }) {
  return (
    <Badge variant={status === 'resolved' || status === 'closed' ? 'secondary' : 'outline'}>
      {t(`tickets.${status}`, locale)}
    </Badge>
  );
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
