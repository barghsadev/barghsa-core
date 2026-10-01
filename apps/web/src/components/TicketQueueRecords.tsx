import { useEffect, useState } from 'react';
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
import { HistoryTable, type HistoryColumn } from './HistoryTable.js';
import { formatRelativeTime } from '../lib/notifications.js';

export type TicketStatus =
  'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed';
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
  if (!staff && ticket.relatedEntityType === 'invoice')
    return (
      <a
        className="text-primary underline break-all"
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
  onSelect: (id: string) => void;
}) {
  const text = (key: string) => t(`tickets.${key}`, locale);
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
  function status(item: Ticket) {
    return (
      <Badge
        variant={item.status === 'resolved' || item.status === 'closed' ? 'secondary' : 'outline'}
      >
        {text(item.status)}
      </Badge>
    );
  }
  function priority(item: Ticket) {
    const code = { high: 'P1', normal: 'P2', low: 'P3' }[item.priority];
    return (
      <Badge variant={item.priority === 'high' ? 'destructive' : 'outline'}>
        <bdi dir="ltr">{code ?? item.priority}</bdi>
        {code && <span>{text(item.priority)}</span>}
      </Badge>
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
  const columns: HistoryColumn<Ticket>[] = [
    { id: 'subject', label: text('subject'), render: subject },
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
            render: (item: Ticket) =>
              assignees.find((person) => person.id === item.assignedTo)?.name ??
              item.assignedTo ??
              text('unassigned'),
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
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{text('updated')}</p>
                    {updated(item)}
                  </div>
                  <details open={expanded.has(item.id)}>
                    <summary
                      className="cursor-pointer rounded py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
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
                            !['subject', 'status', 'priority', 'updated'].includes(column.id)
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
