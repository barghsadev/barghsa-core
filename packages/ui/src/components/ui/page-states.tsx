import { Component, type ErrorInfo, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './empty';
import { Skeleton } from './skeleton';

/** Localized zero-data guidance with an optional next action. */
export interface EmptyStateProps {
  /** Decorative illustration or icon; the title carries its meaning. */
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        {icon ? <EmptyMedia aria-hidden="true">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/** A route-sized placeholder; loading text is announced without visual flashing. */
export function PageLoading({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('mx-auto flex w-full max-w-4xl flex-col gap-6 p-6', className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

/** Safe, localized render-error content; never displays raw exception details. */
export interface ErrorStateProps {
  title: string;
  description: string;
  retryLabel: string;
  /** Product-provided contact instructions or a support link. */
  supportContact: ReactNode;
  onRetry: () => void;
}
export function ErrorState({
  title,
  description,
  retryLabel,
  supportContact,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="mx-auto w-full max-w-lg p-6">
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <p>{description}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={onRetry}>
              {retryLabel}
            </Button>
            {supportContact}
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

/** Catches descendant rendering failures and allows explicit retry or resource change. */
export interface ErrorBoundaryProps extends Omit<ErrorStateProps, 'onRetry'> {
  children: ReactNode;
  /** Change when navigating to a different resource to discard a stale failure. */
  resetKey?: unknown;
  onReset?: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
}
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }
  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && !Object.is(previous.resetKey, this.props.resetKey)) {
      this.setState({ failed: false });
    }
  }
  private retry = () => {
    this.props.onReset?.();
    this.setState({ failed: false });
  };
  override render() {
    return this.state.failed ? (
      <ErrorState
        title={this.props.title}
        description={this.props.description}
        retryLabel={this.props.retryLabel}
        supportContact={this.props.supportContact}
        onRetry={this.retry}
      />
    ) : (
      this.props.children
    );
  }
}
