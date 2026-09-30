import type { StatusTone } from '@barghsa/ui';

export function statusFilterTone(status: string): StatusTone {
  if (['cancelled', 'rejected', 'offer_declined'].includes(status)) return 'destructive';
  if (['approved', 'active', 'offer_accepted', 'contract_created'].includes(status))
    return 'success';
  if (status === 'completed') return 'default';
  if (status === 'submitted') return 'info';
  return 'warning';
}
