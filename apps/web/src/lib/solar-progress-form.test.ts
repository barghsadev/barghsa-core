import { expect, it } from 'vitest';
import {
  captureProgress,
  confirmedProgress,
  definitiveProgressRejection,
  parseProgress,
  progressReviewHash,
} from './solar-progress-form.js';
import { progressNoteSchema } from './solar-progress-form-schemas.js';
import {
  constructionContract,
  constructionProgress,
  constructionOlder,
} from '../test/solar-progress-fixtures.js';

const operationId = '85000000-0000-4000-8000-000000000005';
it('validates required trimmed construction notes at the exact1000 boundary while preserving raw drafts', () => {
  const schema = progressNoteSchema('Invalid note');
  for (const note of ['', ' ', 'x'.repeat(1001)]) {
    const result = schema.safeParse({ note });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['note']);
  }
  const raw = ` ${'x'.repeat(1000)} `;
  expect(schema.safeParse({ note: raw })).toMatchObject({ success: true, data: { note: raw } });
  expect(captureProgress(constructionProgress(), raw, operationId)?.command.note).toHaveLength(
    1000
  );
});
it('rejects malformed progress histories before any timeline or recovery acceptance', () => {
  const valid = constructionProgress(1);
  expect(parseProgress(valid)).toEqual(valid);
  for (const value of [
    { ...valid, requestId: 'private' },
    { ...valid, events: [null] },
    { ...valid, revision: 2 },
    { ...valid, steps: [] },
    { ...valid, events: [{ ...valid.events[0], recordedAt: 'invalid' }] },
    { ...valid, nextMilestone: 'installed' },
  ])
    expect(parseProgress(value)).toBeNull();
});
it('accepts only a full review matching the captured command and immutable contract scope', () => {
  const captured = captureProgress(constructionProgress(1), ' Delivery verified ', operationId)!;
  const review = {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'solar.construction.record',
      profileId: captured.profileId,
      resourceId: captured.requestId,
    },
    data: {
      command: captured.command,
      contractId: captured.contractId,
      contractState: captured.contractState,
      versionId: constructionContract,
      revision: 1,
      previousStage: 'in_progress',
      customerVisible: true,
      collectsPayment: false,
      changesContract: false,
    },
  };
  expect(progressReviewHash(review, captured)).toBe(review.hash);
  for (const value of [
    { hash: review.hash },
    { ...review, scope: { ...review.scope, resourceId: constructionOlder } },
    {
      ...review,
      data: { ...review.data, command: { ...captured.command, operationId: constructionOlder } },
    },
    { ...review, data: { ...review.data, collectsPayment: true } },
    { ...review, data: { ...review.data, contractId: constructionOlder } },
  ])
    expect(progressReviewHash(value, captured)).toBeNull();
});
it('requires the exact next saved event and immutable prefix, allowing later milestones and consent-name changes', () => {
  const prior = constructionProgress(1);
  const captured = captureProgress(prior, ' Delivered ', operationId)!;
  const saved = constructionProgress(2);
  saved.events[1]!.note = 'Delivered';
  saved.events[0]!.actorName = null;
  expect(confirmedProgress(saved, captured)).toEqual(saved);
  const later = constructionProgress(3);
  later.events[1]!.note = 'Delivered';
  expect(confirmedProgress(later, captured)).toEqual(later);
  for (const value of [
    prior,
    { ...saved, requestId: constructionOlder },
    { ...saved, profileId: constructionOlder },
    { ...saved, contractId: constructionOlder },
    { ...saved, events: [saved.events[0], { ...saved.events[1], note: 'Unrelated update' }] },
    { ...saved, events: [{ ...saved.events[0], note: 'Changed prefix' }, saved.events[1]] },
  ])
    expect(confirmedProgress(value, captured)).toBeNull();
  prior.events[0]!.note = 'Changed after capture';
  expect(captured.events[0]!.note).not.toBe(prior.events[0]!.note);
});
it('recognizes a complete no-write rejection envelope without trusting arbitrary backend text', () => {
  expect(
    definitiveProgressRejection({
      error: { code: 'CONFLICT:INVALID_STATE', message: 'Private', correlationId: operationId },
    })
  ).toBe(true);
  expect(definitiveProgressRejection({ error: { code: 'CONFLICT:INVALID_STATE' } })).toBe(false);
  expect(definitiveProgressRejection(null)).toBe(false);
});
