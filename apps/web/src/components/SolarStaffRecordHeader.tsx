import { tSolarStaffRecord } from '@barghsa/i18n/solar-staff-record';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';

const stages = {
  documents: { queue: '/admin/solar-requests', back: 'backToRequests', title: 'title' },
  postal: { queue: '/admin/solar-postal', back: 'backToPostal', title: 'postalTitle' },
  construction: {
    queue: '/admin/solar-construction',
    back: 'backToConstruction',
    title: 'constructionTitle',
  },
} as const;

export function SolarStaffRecordHeader({
  stage,
  search,
  reference,
  blocked,
  action,
  headingText,
  backLink,
}: {
  stage: keyof typeof stages;
  search: Record<string, unknown>;
  reference?: ReactNode;
  blocked: () => boolean;
  action?: ReactNode;
  headingText?: string;
  backLink?: ReactNode;
}) {
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  const { queue, back, title } = stages[stage];
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  return (
    <header className="space-y-2">
      <RecordCommandGuard blocked={blocked} />
      {backLink ?? (
        <Link
          to={queue}
          search={search}
          className="touch-action text-sm text-primary underline underline-offset-4"
          aria-disabled={blocked() || undefined}
          onClick={(event) => {
            if (blocked()) event.preventDefault();
          }}
        >
          {tSolarStaffRecord(back, locale)}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 ref={heading} tabIndex={-1} className="w-fit text-xl font-semibold">
            {headingText ?? tSolarStaffRecord(title, locale)}
          </h1>
          {reference && (
            <p className="flex flex-wrap gap-x-2 wrap-anywhere text-sm text-muted-foreground">
              {reference}
            </p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}
