import { LoadingStatus, Alert, Button, Skeleton } from '@barghsa/ui';
import type { CSSProperties, ReactNode } from 'react';
import { DANGER_TEXT_COLORS } from '../lib/brand-config.js';
import { getBrandTextColor, useBrandConfig } from '../providers/BrandThemeProvider.js';
import { useCommandFeedback } from '../hooks/useCommandFeedback.js';
type Copy = (key: string) => string;

export function SettingsValueSkeleton({ label, count = 3 }: { label: string; count?: number }) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))]"
      >
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="space-y-2 rounded-lg border bg-card p-3">
            <Skeleton className="h-3 w-24 max-w-full" />
            <Skeleton className="h-6 w-16 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reserve localized feedback space so blur validation cannot move a tap target. */
export function CatalogueFieldFeedback({
  id,
  error,
  message,
  hint,
  compact = false,
}: {
  id: string;
  error?: { message?: string | undefined } | undefined;
  message: string;
  hint?: ReactNode;
  compact?: boolean;
}) {
  const { brandConfig, resolvedTheme } = useBrandConfig();
  const dark = resolvedTheme === 'dark';
  const background = dark ? brandConfig.darkBackgroundColor : brandConfig.backgroundColor;
  return (
    <p
      id={id}
      style={
        {
          '--field-error': getBrandTextColor(DANGER_TEXT_COLORS[dark ? 1 : 0], [background]),
        } as CSSProperties
      }
      role={error ? 'alert' : undefined}
      aria-hidden={!error && !hint ? true : undefined}
      className={`${error ? 'text-[var(--field-error)]' : 'text-muted-foreground'} ${compact ? 'text-xs' : 'text-sm'} ${error || hint ? '' : compact ? 'invisible line-clamp-1' : 'invisible'}`}
    >
      {error ? (error.message ?? message) : (hint ?? message)}
    </p>
  );
}
export function CatalogueEditorStatus({
  label,
  loading,
  loadingView,
  error,
  denied,
  saved,
  uncertain,
  announceUncertain = true,
  refresh,
  busy,
}: {
  label: Copy;
  loading: boolean;
  loadingView?: ReactNode;
  error: boolean;
  denied: boolean;
  saved: boolean;
  uncertain: boolean;
  announceUncertain?: boolean;
  refresh: () => void;
  busy: boolean;
}) {
  useCommandFeedback({
    success: saved && !denied && !uncertain && !error ? label('saved') : null,
    error: uncertain
      ? announceUncertain
        ? label('unverified')
        : null
      : denied
        ? label('forbidden')
        : error
          ? label('readError')
          : null,
  });
  return (
    <>
      {loading && (loadingView ?? <LoadingStatus>{label('loading')}</LoadingStatus>)}
      {denied && <Alert variant="destructive">{label('forbidden')}</Alert>}
      {error && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive p-3">
          <p>{label('readError')}</p>
          <Button type="button" variant="outline" disabled={busy} onClick={refresh}>
            {label('retry')}
          </Button>
        </div>
      )}
      {saved && <p role="status">{label('saved')}</p>}
      {uncertain && <Alert variant="destructive">{label('unverified')}</Alert>}
    </>
  );
}
export function CatalogueSaveButton({
  label,
  pending,
  disabled,
  testId,
  ariaLabel,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <Button
      data-testid={testId}
      aria-label={ariaLabel}
      type="submit"
      disabled={disabled}
      aria-busy={pending || undefined}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {label}
    </Button>
  );
}
export function catalogueRootMessage(errors: {
  root?: Record<string, { message?: string }> & { message?: string };
}) {
  return errors.root?.validation?.message ?? errors.root?.message;
}
