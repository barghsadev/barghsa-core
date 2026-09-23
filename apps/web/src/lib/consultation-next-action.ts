import { t } from '@barghsa/i18n/app';
import { tConsultation } from '@barghsa/i18n/consultation';
import type { WorkflowOwner } from '../components/WorkflowStatusBanner.js';

export interface ConsultationActionRequest {
  status: string;
  expected_next_step: string | null;
  offer_valid_until: string | null;
  invoice_id: string | null;
  invoice_state: string | null;
  accepted_at: string | null;
}

export function consultationNextAction(
  request: ConsultationActionRequest,
  refundPending: boolean,
  locale: 'fa' | 'en'
): { text: string; owner: WorkflowOwner; href?: string } {
  const copy = (key: string) => tConsultation(key, locale);
  if (request.status === 'awaiting_customer_info')
    return { text: copy('provideInfo'), owner: 'customer', href: '#consultation-information-form' };
  if (request.status === 'offer_pending') {
    const offerExpired =
      !!request.offer_valid_until &&
      new Date(request.offer_valid_until) <= new Date() &&
      request.invoice_state !== 'Paid' &&
      !request.accepted_at;
    if (offerExpired) return { text: copy('offerExpired'), owner: 'customer', href: '/tickets' };
    if (request.invoice_state === 'PaymentUnderReview')
      return { text: copy('paymentUnderReview'), owner: 'staff' };
    if (request.accepted_at && request.invoice_id && request.invoice_state !== 'Paid')
      return {
        text: copy('acceptedAwaitingPayment'),
        owner: 'customer',
        href: `/invoices/${encodeURIComponent(request.invoice_id)}`,
      };
    return { text: copy('reviewOffer'), owner: 'customer', href: '#consultation-offer' };
  }
  if (request.status === 'offer_accepted' && request.invoice_id && request.invoice_state !== 'Paid')
    return {
      text: copy('acceptedAwaitingPayment'),
      owner: 'customer',
      href: `/invoices/${encodeURIComponent(request.invoice_id)}`,
    };
  if (['completed', 'cancelled', 'rejected', 'offer_declined'].includes(request.status))
    return refundPending
      ? { text: copy('paidClosurePending'), owner: 'staff' }
      : { text: t('workflow.none', locale), owner: 'none' };
  return {
    text:
      locale === 'en' ? (request.expected_next_step ?? copy('staffReview')) : copy('staffReview'),
    owner: 'staff',
  };
}
