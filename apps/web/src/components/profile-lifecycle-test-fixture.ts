import {
  lifecycleBlockers,
  closureBlockers,
  retainedRecords,
} from '../lib/profile-lifecycle-form.js';
export const lifecycleProfileId = '11111111-1111-4111-8111-111111111112';
export const lifecycleTicketId = '11111111-1111-4111-8111-111111111111';
export const lifecycleJobId = '11111111-1111-4111-8111-111111111113';
export const lifecycleInstant = '2026-10-05T09:00:00.000Z';
export const actualBlockers = () =>
  Object.entries(lifecycleBlockers).map(([code, [owner, nextStep]]) => ({
    code,
    count: code === 'securityReview' ? 1 : 0,
    owner,
    nextStep,
  }));
export const actualClosurePreview = () => ({
  ticketId: lifecycleTicketId,
  profileId: lifecycleProfileId,
  ownerUserId: 'owner/opaque',
  eligible: true,
  completedAt: null as string | null,
  anonymized: null as boolean | null,
  anonymizeProfile: false,
  blockers: Object.entries(closureBlockers).map(([code, [owner, nextStep]]) => ({
    code,
    count: code === 'securityReview' ? 1 : 0,
    owner,
    nextStep,
  })),
  retained: Object.fromEntries(retainedRecords.map((key) => [key, key === 'invoices' ? 1 : 0])),
  exportTicketId: null,
  exportExpiresAt: null,
  previewVersion: 'a'.repeat(64),
});
export const actualLifecyclePreview = () => ({
  profileId: lifecycleProfileId,
  blockers: actualBlockers(),
  requests: [] as {
    ticketId: string;
    type: 'export' | 'closure';
    status: string;
    createdAt: string;
    exportJobId: string | null;
    exportExpiresAt: string | null;
  }[],
});
export const actualStepUp = () => ({
  message: 'Step-up authentication successful.',
  stepUpVerifiedAt: lifecycleInstant,
});
