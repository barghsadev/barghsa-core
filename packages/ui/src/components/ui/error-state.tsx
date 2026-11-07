import type { ReactNode } from 'react';

/** Safe, localized render-error content; never displays raw exception details. */
export interface ErrorStateProps {
  title: string;
  heading?: 'h1' | 'h2';
  description: string;
  retryLabel: string;
  /** Product-provided contact instructions or a support link. */
  supportContact: ReactNode;
  onRetry: () => void;
  /** Only a product-defined code and opaque reference; never an exception message or stack. */
  details?: { label: string; code: string; referenceLabel: string; reference: string };
}
export function ErrorState({
  title,
  heading: Heading = 'h2',
  description,
  retryLabel,
  supportContact,
  onRetry,
  details,
}: ErrorStateProps) {
  return (
    <div className="mx-auto w-full max-w-lg p-6">
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-destructive bg-card p-4 text-foreground"
      >
        <svg
          aria-hidden="true"
          className="size-5 text-destructive"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m10.3 3.9-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4m0 4h.01" />
        </svg>
        <Heading className="font-semibold">{title}</Heading>
        <div className="space-y-3 text-sm">
          <p>{description}</p>
          {details &&
            /^[A-Z0-9_:-]{1,80}$/.test(details.code) &&
            /^[a-zA-Z0-9-]{8,64}$/.test(details.reference) && (
              <details className="min-w-0">
                <summary className="min-h-11 cursor-pointer py-3">{details.label}</summary>
                <dl className="mt-2 space-y-1 text-xs">
                  <div>
                    <dt className="sr-only">{details.label}</dt>
                    <dd>
                      <bdi>{details.code}</bdi>
                    </dd>
                  </div>
                  <div>
                    <dt>{details.referenceLabel}</dt>
                    <dd className="break-all">
                      <bdi>{details.reference}</bdi>
                    </dd>
                  </div>
                </dl>
              </details>
            )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-border bg-background px-4 py-2 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={onRetry}
            >
              {retryLabel}
            </button>
            {supportContact}
          </div>
        </div>
      </div>
    </div>
  );
}
