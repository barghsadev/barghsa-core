import { expect, it } from 'vitest';
import {
  canTransitionElectricityOrder,
  electricityCommercialStatuses,
} from '../electricity/electricity-order-status.js';
import { canTransitionSavingOrder, savingCommercialStatuses } from '../saving/saving-state.js';
import { canTransitionSolarRequest, solarCommercialStatuses } from '../solar/solar-state.js';
import {
  canTransitionConsultation,
  CONSULTATION_STATUSES,
  type ConsultationActor,
} from '../consultation/consultation-state.js';

// Business journeys are independent fixtures: every other pair must be denied.
const electricityJourney = [
  'draft>submitted',
  'draft>rejected',
  'draft>cancelled',
  'submitted>awaiting_staff_review',
  'submitted>rejected',
  'submitted>cancelled',
  'awaiting_staff_review>changes_requested',
  'awaiting_staff_review>approved',
  'awaiting_staff_review>rejected',
  'awaiting_staff_review>cancelled',
  'changes_requested>submitted',
  'changes_requested>rejected',
  'changes_requested>cancelled',
  'approved>active',
  'approved>rejected',
  'approved>cancelled',
  'active>completed',
  'active>cancelled',
];
const savingJourney = [
  'draft>submitted',
  'draft>cancelled',
  'submitted>awaiting_staff_review',
  'submitted>rejected',
  'submitted>cancelled',
  'awaiting_staff_review>approved',
  'awaiting_staff_review>rejected',
  'awaiting_staff_review>cancelled',
  // An unpaid revision returns to review; fulfillment can advance within its phase.
  'approved>awaiting_staff_review',
  'approved>in_progress',
  'approved>cancelled',
  'in_progress>in_progress',
  'in_progress>completed',
  'in_progress>cancelled',
];
const solarJourney = [
  'draft>submitted',
  'draft>cancelled',
  'submitted>uploading_documents',
  'submitted>documents_under_review',
  'uploading_documents>documents_under_review',
  'documents_under_review>changes_requested',
  'documents_under_review>waiting_for_postal_submission',
  'changes_requested>uploading_documents',
  'changes_requested>documents_under_review',
  'changes_requested>changes_requested',
  'changes_requested>waiting_for_postal_submission',
  'waiting_for_postal_submission>postal_documents_received',
  'postal_documents_received>final_review',
  'final_review>approved',
  'final_review>rejected',
  'final_review>cancelled',
  'approved>contract_created',
  'approved>cancelled',
];

for (const [domain, states, permitted, transition] of [
  ['electricity', electricityCommercialStatuses, electricityJourney, canTransitionElectricityOrder],
  ['saving', savingCommercialStatuses, savingJourney, canTransitionSavingOrder],
  ['solar', solarCommercialStatuses, solarJourney, canTransitionSolarRequest],
] as const) {
  it(`enforces every ${domain} source/target pair, including draft and terminal states`, () => {
    for (const from of states)
      for (const to of states)
        expect(transition(from, to), `${domain}: ${from}>${to}`).toBe(
          permitted.includes(`${from}>${to}`)
        );
    for (const missing of ['missing', '__proto__', 'constructor']) {
      expect(transition(missing, states[0])).toBe(false);
      expect(transition(states[0], missing)).toBe(false);
    }
  });
}

it('enforces every consultation state pair separately for staff, customer and payment actors', () => {
  const permitted: Record<ConsultationActor, readonly string[]> = {
    staff: [
      'submitted>under_review',
      'under_review>awaiting_customer_info',
      'under_review>offer_pending',
      'offer_pending>under_review',
      'offer_accepted>completed',
      'submitted>rejected',
      'submitted>cancelled',
      'under_review>rejected',
      'under_review>cancelled',
      'awaiting_customer_info>rejected',
      'awaiting_customer_info>cancelled',
      'offer_pending>rejected',
      'offer_pending>cancelled',
      'offer_accepted>rejected',
      'offer_accepted>cancelled',
    ],
    customer: ['awaiting_customer_info>under_review', 'offer_pending>offer_declined'],
    payment: ['offer_pending>offer_accepted'],
  };
  for (const actor of ['staff', 'customer', 'payment'] as const)
    for (const from of CONSULTATION_STATUSES)
      for (const to of CONSULTATION_STATUSES)
        expect(canTransitionConsultation(from, to, actor), `${actor}: ${from}>${to}`).toBe(
          permitted[actor].includes(`${from}>${to}`)
        );
  expect(
    canTransitionConsultation('offer_pending', 'offer_accepted', 'system' as ConsultationActor)
  ).toBe(false);
  expect(
    canTransitionConsultation(
      'missing' as (typeof CONSULTATION_STATUSES)[number],
      'rejected',
      'staff'
    )
  ).toBe(false);
});
