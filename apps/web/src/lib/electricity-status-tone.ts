import type { StatusTone } from '@barghsa/ui';

export function commercialStatusTone(status: string): StatusTone {
  if (['active', 'completed', 'approved'].includes(status)) return 'success';
  if (['rejected', 'cancelled'].includes(status)) return 'destructive';
  return 'warning';
}

export function financialStatusTone(status: string): StatusTone {
  if (status === 'paid' || status === 'refunded') return 'success';
  if (status === 'refund_pending' || status === 'partially_refunded') return 'warning';
  return 'default';
}
