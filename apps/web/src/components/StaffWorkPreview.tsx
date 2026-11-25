import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, LifeBuoy, MessagesSquare } from 'lucide-react';
import type { Locale } from '@barghsa/i18n/app';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { staffWorkText } from '@barghsa/i18n/staff-work-preview';
import { Button, LoadingSkeleton, ResultGlyph, buttonVariants, cn } from '@barghsa/ui';
import { t as workspaceText } from '@barghsa/i18n/workspace';
import { staffDashboardReader, useStaffDashboardData } from '../hooks/useStaffDashboardData.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { uuidReference } from '../lib/form-receipt.js';
import { formatRelativeTime } from '../lib/relative-time.js';
import { retryDashboardRead } from './dashboard/DashboardWidget.js';

const lanes = ['mine', 'urgent', 'overdue'] as const;
type WorkLane = (typeof lanes)[number];
const emptyStates = { mine: 'emptyMine', urgent: 'emptyUrgent', overdue: 'emptyOverdue' } as const;
const consultationFilters = {
  mine: { assignment: 'mine' },
  urgent: { assignment: 'unassigned', priority: 'high' },
  overdue: {},
} as const;
const statuses = {
  ticket: ['open', 'in_progress', 'waiting_staff'],
  consultation: ['submitted', 'under_review', 'offer_accepted'],
} as const;
const queueLinkClass = cn(
  buttonVariants({ variant: 'ghost' }),
  'touch-action h-auto min-h-11 w-full min-w-0 max-w-full justify-start border-border/80 bg-card py-2 text-start whitespace-normal text-primary hover:bg-primary/8 hover:text-primary sm:w-auto'
);

interface Task {
  lane: WorkLane;
  kind: keyof typeof statuses;
  id: string;
  status: string;
  title: { en: string | null; fa: string | null };
  createdAt: string;
  ownerName: string | null;
  team: string | null;
  assigned: boolean;
  mine: boolean;
  overdueHours: number | null;
}
interface WorkPreview {
  tasks: Task[];
  canOpenTickets: boolean;
  canOpenConsultations: boolean;
}
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const readWorkPreview = staffDashboardReader((value) => {
  if (!value || typeof value !== 'object') throw new Error('Invalid work queue');
  const data = value as WorkPreview;
  if (
    typeof data.canOpenTickets !== 'boolean' ||
    typeof data.canOpenConsultations !== 'boolean' ||
    !Array.isArray(data.tasks) ||
    data.tasks.length > lanes.length * 4 ||
    !data.tasks.every(
      (task) =>
        task &&
        lanes.includes(task.lane) &&
        (task.kind === 'ticket' || task.kind === 'consultation') &&
        (statuses[task.kind] as readonly string[]).includes(task.status) &&
        uuidReference(task.id) &&
        typeof task.createdAt === 'string' &&
        Number.isFinite(Date.parse(task.createdAt)) &&
        task.title &&
        nullableText(task.title.en) &&
        nullableText(task.title.fa) &&
        nullableText(task.ownerName) &&
        nullableText(task.team) &&
        typeof task.assigned === 'boolean' &&
        typeof task.mine === 'boolean' &&
        (task.overdueHours === null ||
          (Number.isSafeInteger(task.overdueHours) && task.overdueHours > 0))
    )
  )
    throw new Error('Invalid work queue');
  return data;
});

function WorkTask({ task, locale }: { task: Task; locale: Locale }) {
  const numbers = useNumberFormatting(locale);
  const copy = (key: Parameters<typeof staffWorkText>[0]) => staffWorkText(key, locale);
  const title = task.title[locale] || task.title[locale === 'fa' ? 'en' : 'fa'] || copy(task.kind);
  const owner =
    (task.mine ? copy('you') : task.ownerName) ||
    task.team ||
    copy(task.assigned ? 'assigned' : 'unassigned');
  const age = formatRelativeTime(task.createdAt, locale) || copy('newItem');
  const nextAction =
    task.kind === 'ticket'
      ? copy('respond')
      : copy(
          task.status === 'submitted'
            ? 'review'
            : task.status === 'under_review'
              ? 'continueReview'
              : 'finalize'
        );
  const text = (
    <>
      <span className="min-w-0 space-y-1">
        <span className="block text-sm text-muted-foreground">
          {copy(task.kind)} · <time dateTime={task.createdAt}>{age}</time>
        </span>
        <span className="block break-words font-semibold" dir="auto">
          {title}
        </span>
        <span className="block text-sm text-muted-foreground">
          <bdi>{owner}</bdi>
          {task.lane === 'overdue' && task.overdueHours && (
            <> · {copy('targetHours').replace('{hours}', numbers.number(task.overdueHours))}</>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-primary">
        {nextAction}
        <ArrowUpRight aria-hidden className="size-4 rtl:-scale-x-100" />
      </span>
    </>
  );
  const className =
    'flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md px-4 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring';
  return (
    <li>
      {task.kind === 'ticket' ? (
        <Link
          to="/admin/tickets/$ticketId/{-$section}"
          params={{ ticketId: task.id, section: undefined }}
          search={{ status: 'active' }}
          className={className}
        >
          {text}
        </Link>
      ) : (
        <Link
          to="/admin/consultations/$requestId"
          params={{ requestId: task.id }}
          search={consultationFilters[task.lane]}
          className={className}
        >
          {text}
        </Link>
      )}
    </li>
  );
}

export function StaffWorkPreview({ locale }: { locale: Locale }) {
  const title = useId();
  const results = useId();
  const [lane, setLane] = useState<WorkLane>('mine');
  const resource = useStaffDashboardData('/api/admin/dashboard/work-queue', readWorkPreview);
  if (!resource) return null;
  const tasks = resource.data?.tasks.filter((task) => task.lane === lane) ?? [];
  return (
    <section className="space-y-3" aria-labelledby={title}>
      <h2 id={title} className="text-xl font-semibold">
        {staffWorkText('queue', locale)}
      </h2>
      {resource.status === 'loading' ? (
        <LoadingSkeleton label={loadingText('loading', locale)} variant="table" />
      ) : resource.status === 'error' ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <ResultGlyph error />
          <div className="min-w-0 space-y-2">
            <p>{dashboardText('widget.error', locale)}</p>
            <Button variant="outline" onClick={() => retryDashboardRead(resource, locale)}>
              {dashboardText('widget.retry', locale)}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div role="group" aria-labelledby={title} className="flex flex-wrap gap-2">
            {lanes.map((choice) => {
              const hasResults = resource.data.tasks.some((task) => task.lane === choice);
              return (
                <Button
                  key={choice}
                  type="button"
                  variant={lane === choice ? 'default' : 'outline'}
                  aria-pressed={lane === choice}
                  aria-controls={results}
                  aria-description={
                    hasResults ? workspaceText('listStatus.hasResults', locale) : undefined
                  }
                  onClick={() => setLane(choice)}
                  className="min-h-11"
                >
                  {staffWorkText(choice, locale)}
                  {hasResults && (
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  )}
                </Button>
              );
            })}
          </div>
          <div id={results} className="rounded-xl border bg-card">
            {tasks.length ? (
              <ul className="divide-y">
                {tasks.map((task) => (
                  <WorkTask key={task.id} task={task} locale={locale} />
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                <ResultGlyph />
                <p>{staffWorkText(emptyStates[lane], locale)}</p>
              </div>
            )}
            {(resource.data.canOpenTickets || resource.data.canOpenConsultations) && (
              <footer className="flex flex-wrap gap-2 rounded-b-xl border-t bg-muted/40 px-3 py-2.5 sm:px-4">
                {resource.data.canOpenTickets && (
                  <Link
                    to="/admin/tickets"
                    search={{ status: 'active' }}
                    className={queueLinkClass}
                  >
                    <LifeBuoy aria-hidden="true" />
                    {staffWorkText('tickets', locale)}
                  </Link>
                )}
                {resource.data.canOpenConsultations && (
                  <Link
                    to="/admin/consultations"
                    search={consultationFilters[lane]}
                    className={queueLinkClass}
                  >
                    <MessagesSquare aria-hidden="true" />
                    {staffWorkText('consultations', locale)}
                  </Link>
                )}
              </footer>
            )}
          </div>
        </>
      )}
    </section>
  );
}
