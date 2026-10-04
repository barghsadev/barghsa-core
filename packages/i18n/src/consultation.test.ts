import { expect, it } from 'vitest';
import { tConsultation } from './consultation.js';

it.each(['en', 'fa'] as const)(
  'supplies consultation assignment fallbacks and activity labels (%s)',
  (locale) => {
    for (const key of [
      'owner',
      'team',
      'assignedStaff',
      'awaitingOwner',
      'unassigned',
      'history',
      'actor_staff',
      'actor_customer',
      'actor_unknown',
      'status_unknown',
      'status_submitted',
      'status_under_review',
      'status_awaiting_customer_info',
      'status_offer_pending',
      'status_offer_accepted',
      'status_offer_declined',
      'status_completed',
      'status_rejected',
      'status_cancelled',
    ]) {
      expect(tConsultation(key, locale).trim()).not.toBe('');
      expect(tConsultation(key, locale)).not.toBe(key);
    }
    expect(tConsultation('assignedStaff', locale)).not.toBe(tConsultation('unassigned', locale));
    expect(tConsultation('awaitingOwner', locale)).not.toBe(tConsultation('unassigned', locale));
  }
);
