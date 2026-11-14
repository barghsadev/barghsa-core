import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ElectricityOrderController } from './electricity-order.controller.js';

const profileId = randomUUID();
const orderId = randomUUID();
const session = { userId: 'electricity-buyer', sessionId: randomUUID(), csrfToken: randomUUID() };
const request = { session } as AuthenticatedRequest;
const simple = { profileId, period: 'next_week', totalKwh: '10' };
const advanced = {
  profileId,
  startAt: '2026-12-01T00:00:00+03:30',
  endAt: '2026-12-02T00:00:00+03:30',
  quantities: { thermal: '10', green: '1' },
};
const address = {
  provinceId: randomUUID(),
  cityId: randomUUID(),
  fullAddress: ' Delivery address ',
  postalCode: '1234567890',
};
const versionId = randomUUID();
const idempotencyKey = randomUUID();
const digest = 'a'.repeat(64);
const confirmation = { address, idempotencyKey, expectedQuoteDigest: digest };
const revision = {
  ...confirmation,
  expectedVersionId: versionId,
  responseNote: ' Review corrected terms ',
};
const malformed = { status: 400, response: { error: 'VALIDATION:INPUT_INVALID' } };
function fixture() {
  const service = {
    preview: vi.fn().mockResolvedValue({ totalIrR: '12000' }),
    submit: vi.fn().mockResolvedValue({ orderId }),
    cancellationReview: vi.fn().mockResolvedValue({ expectedVersionId: versionId }),
    cancel: vi.fn().mockResolvedValue({ orderId, status: 'cancelled' }),
    previewRevision: vi.fn(),
    resubmitRevision: vi.fn(),
    resubmitAddressCorrection: vi.fn(),
  };
  const bill = { get: vi.fn() };
  const drafts = { save: vi.fn() };
  return {
    service,
    bill,
    drafts,
    controller: new ElectricityOrderController(service as never, bill as never, drafts as never),
  };
}

it('rejects malformed quotes, submitted orders and draft steps before invoking business services', async () => {
  const { controller, service, bill, drafts } = fixture();
  await expect(controller.getBillData(profileId, 'unsupported', request)).rejects.toMatchObject(
    malformed
  );
  await expect(controller.preview({ ...simple, totalKwh: '-1' }, request)).rejects.toMatchObject(
    malformed
  );
  expect(() =>
    controller.previewAdvanced({ ...advanced, quantities: { thermal: '-1' } }, request)
  ).toThrow(expect.objectContaining(malformed));
  await expect(
    controller.submit({ ...simple, ...confirmation, expectedQuoteDigest: 'old' }, request)
  ).rejects.toMatchObject(malformed);
  expect(() =>
    controller.submitAdvanced({ ...advanced, ...confirmation, idempotencyKey: 'wrong' }, request)
  ).toThrow(expect.objectContaining(malformed));
  expect(() =>
    controller.saveAdvancedDraft({ profileId, currentStep: 6, data: { quantities: {} } }, request)
  ).toThrow(expect.objectContaining(malformed));
  for (const method of [service.preview, service.submit, bill.get, drafts.save])
    expect(method).not.toHaveBeenCalled();
});

it('passes the captured quote digest and idempotency key into both valid submission modes', async () => {
  const { controller, service } = fixture();
  await expect(controller.submit({ ...simple, ...confirmation }, request)).resolves.toEqual({
    orderId,
  });
  await expect(
    controller.submitAdvanced({ ...advanced, ...confirmation }, request)
  ).resolves.toEqual({ orderId });
  expect(service.submit.mock.calls).toEqual([
    [
      session,
      { ...simple, ...confirmation, address: { ...address, fullAddress: 'Delivery address' } },
      'unknown',
    ],
    [
      session,
      { ...advanced, ...confirmation, address: { ...address, fullAddress: 'Delivery address' } },
      'unknown',
    ],
  ]);
});

it('only projects input fields for an unambiguous correction form', () => {
  const { controller, service } = fixture();
  for (const body of [
    null,
    [],
    { ...simple, ...advanced, expectedVersionId: versionId },
    { profileId, expectedVersionId: versionId },
  ]) {
    expect(() => controller.revisionPreview(orderId, body, request)).toThrow(
      expect.objectContaining(malformed)
    );
  }
  expect(() =>
    controller.resubmitRevision(
      orderId,
      {
        ...advanced,
        ...revision,
        quantities: { thermal: 'bad' },
      },
      request
    )
  ).toThrow(expect.objectContaining({ fields: ['thermal'] }));
  expect(() =>
    controller.resubmitAddress(
      orderId,
      {
        expectedVersionId: versionId,
        idempotencyKey,
        responseNote: 'Corrected',
        fullAddress: 'Delivery address',
        postalCode: '0',
      },
      request
    )
  ).toThrow(expect.objectContaining({ fields: ['postalCode'] }));
  expect(service.previewRevision).not.toHaveBeenCalled();
  expect(service.resubmitRevision).not.toHaveBeenCalled();
  expect(service.resubmitAddressCorrection).not.toHaveBeenCalled();
});

it('passes one normalized version and audit context to the correction service', () => {
  const { controller, service } = fixture();
  controller.resubmitRevision(orderId, { ...simple, ...revision }, request);
  expect(service.resubmitRevision).toHaveBeenCalledExactlyOnceWith(
    session,
    orderId,
    {
      ...simple,
      ...revision,
      responseNote: 'Review corrected terms',
      address: { ...address, fullAddress: 'Delivery address' },
    },
    'unknown'
  );
  const correction = {
    idempotencyKey,
    expectedVersionId: versionId,
    fullAddress: 'Delivery address',
    postalCode: '1234567890',
    responseNote: 'Corrected',
  };
  controller.resubmitAddress(orderId, correction, request);
  expect(service.resubmitAddressCorrection).toHaveBeenCalledExactlyOnceWith(
    session,
    orderId,
    correction,
    'unknown'
  );
});

it('rejects an incomplete cancellation review and submits only the reviewed version and key', async () => {
  const { controller, service } = fixture();
  expect(() => controller.cancelReview(orderId, { reason: ' ' }, request)).toThrow(
    expect.objectContaining(malformed)
  );
  expect(service.cancellationReview).not.toHaveBeenCalled();
  const approved = {
    idempotencyKey,
    expectedVersionId: versionId,
    expectedReviewHash: digest,
    reason: ' Stop supply ',
  };
  await expect(controller.cancel(orderId, approved, request)).resolves.toMatchObject({
    orderId,
    status: 'cancelled',
  });
  expect(service.cancel).toHaveBeenCalledExactlyOnceWith(
    session,
    orderId,
    { ...approved, reason: 'Stop supply' },
    'unknown'
  );
});
