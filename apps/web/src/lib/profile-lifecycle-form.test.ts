import { expect, it } from 'vitest';
import {
  lifecyclePreview,
  closurePreview,
  closureReceipt,
  lifecycleRequestReceipt,
  lifecycleExportReceipt,
} from './profile-lifecycle-form.js';
import {
  actualClosurePreview,
  actualLifecyclePreview,
  lifecycleTicketId as ticketId,
  lifecycleProfileId as profileId,
  lifecycleJobId as jobId,
  lifecycleInstant,
} from '../components/profile-lifecycle-test-fixture.js';
it('accepts all eleven actual blockers and rejects missing, duplicate, negative and foreign entries', () => {
  const value = actualLifecyclePreview();
  expect(lifecyclePreview(value)).toEqual(value);
  for (const blockers of [
    value.blockers.slice(0, 6),
    [...value.blockers.slice(1), value.blockers[1]],
    value.blockers.map((b) => ({ ...b, count: -1 })),
    value.blockers.map((b) => ({ ...b, owner: 'unknown' })),
  ])
    expect(lifecyclePreview({ ...value, blockers })).toBeNull();
});
it('requires complete matching creation and export receipts', () => {
  expect(
    lifecycleRequestReceipt(
      { ticketId, profileId, type: 'closure', created: false },
      profileId,
      'closure'
    )
  ).toBe(true);
  expect(lifecycleRequestReceipt({ ticketId }, profileId, 'closure')).toBe(false);
  expect(
    lifecycleRequestReceipt(
      { ticketId, profileId, type: 'export', created: true },
      profileId,
      'closure'
    )
  ).toBe(false);
  expect(lifecycleExportReceipt({ ticketId, jobId, created: false }, ticketId)).toBe(true);
  expect(lifecycleExportReceipt({ ticketId, jobId: 'invalid', created: true }, ticketId)).toBe(
    false
  );
});
it('requires every retained count and opaque owner identity in a staff dry-run', () => {
  const value = actualClosurePreview();
  expect(closurePreview(value, ticketId)).toEqual(value);
  expect(closurePreview({ ...value, retained: { invoices: 1 } }, ticketId)).toBeNull();
  expect(closurePreview({ ...value, ticketId: jobId }, ticketId)).toBeNull();
});
it('confirms actual initial and replayed closures without demanding the pre-effect eligible flag to change', () => {
  const source = closurePreview(actualClosurePreview(), ticketId)!;
  const receipt = { ...source, completedAt: lifecycleInstant, anonymized: false, created: true };
  expect(closureReceipt(receipt, source)).toEqual(receipt);
  expect(
    closureReceipt(
      { ...receipt, created: false, eligible: false, previewVersion: 'b'.repeat(64) },
      source
    )
  ).not.toBeNull();
  expect(closureReceipt({ created: true }, source)).toBeNull();
  expect(closureReceipt({ ...receipt, profileId: jobId }, source)).toBeNull();
  expect(closureReceipt({ ...receipt, previewVersion: 'b'.repeat(64) }, source)).toBeNull();
});
