import { Badge, cn } from '@barghsa/ui';
import { Check, CircleAlert, Clock, FileCheck, LoaderCircle, ShieldAlert, X } from 'lucide-react';
import { documentText } from '@barghsa/i18n/documents';
import type { Locale } from '@barghsa/i18n/app';
import type { DocumentState } from '../lib/documents.js';

const states = {
  Uploading: { variant: 'default', icon: LoaderCircle },
  PendingScan: { variant: 'warning', icon: Clock },
  Available: { variant: 'success', icon: Check },
  SubmittedForReview: { variant: 'info', icon: FileCheck },
  Approved: { variant: 'success', icon: Check },
  Rejected: { variant: 'destructive', icon: CircleAlert },
  Superseded: { variant: 'outline', icon: Clock },
  Quarantined: { variant: 'destructive', icon: ShieldAlert },
  Removed: { variant: 'default', icon: X },
} as const;

export function DocumentStatusBadge({
  state,
  locale,
  reason,
}: {
  state: string;
  locale: Locale;
  reason?: string | null;
}) {
  const known = Object.hasOwn(states, state);
  const config = known
    ? states[state as DocumentState]
    : { variant: 'default' as const, icon: CircleAlert };
  const Icon = config.icon;
  const label = documentText(known ? state : 'statusUnavailable', locale);
  const title =
    state === 'Quarantined'
      ? documentText('quarantinedNotice', locale)
      : state === 'Rejected' && reason
        ? `${label}: ${reason}`
        : label;
  return (
    <Badge
      variant={config.variant}
      title={title}
      className={cn(state === 'Removed' && 'line-through')}
      data-document-state={known ? state : 'unknown'}
    >
      <Icon
        aria-hidden="true"
        className={cn(state === 'PendingScan' && 'motion-safe:animate-pulse')}
      />
      {label}
    </Badge>
  );
}
