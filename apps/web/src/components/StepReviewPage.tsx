import { useId, type ReactNode } from 'react';

export interface ReviewSection {
  id: string;
  title: string;
  step?: number;
  rows?: { label: string; value: ReactNode }[];
  content?: ReactNode;
}

/** Review values are supplied by the form or its verified server snapshot. */
export function StepReviewPage({
  title,
  description,
  sections,
  editLabel,
  onEdit,
  disabled = false,
}: {
  title: string;
  description?: string;
  sections: ReviewSection[];
  editLabel: string;
  onEdit: (step: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-5">
      <div className="space-y-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {sections.map((section, index) => (
        <section
          key={section.id}
          aria-labelledby={`${id}-${index}`}
          data-review-section={section.id}
          className="space-y-3 border-t pt-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 id={`${id}-${index}`} className="font-medium">
              {section.title}
            </h3>
            {section.step !== undefined && (
              <button
                type="button"
                disabled={disabled}
                aria-label={`${editLabel} ${section.title}`}
                onClick={() => {
                  if (!disabled && section.step !== undefined) onEdit(section.step);
                }}
                className="min-h-11 rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {editLabel}
              </button>
            )}
          </div>
          {section.rows && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {section.rows.map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words font-medium">
                    <bdi>{row.value ?? '—'}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {section.content}
        </section>
      ))}
    </section>
  );
}
