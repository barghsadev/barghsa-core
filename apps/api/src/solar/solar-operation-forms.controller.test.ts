import { expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { StaffSolarPostalController } from './solar-postal.controller.js';
import { SolarProgressController } from './solar-progress.controller.js';

const requestId = '11000000-0000-4000-8000-000000000001';
const operationId = 'AB000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const actor = {
  session: { userId: 'reviewer', operatingContext: 'staff', permissions: ['orders:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const tracking = {
  estimatedArrivalDate: '2026-02-28',
  trackingUrl: 'https://Courier.Example:443/parcel#shipment',
  note: '  Public parcel estimate  ',
  expectedRevision: 0,
  idempotencyKey: operationId,
};
const milestone = {
  stage: 'in_progress',
  note: '  Work started  ',
  operationId,
  expectedRevision: 0,
};

function fixture() {
  const trackingService = { review: vi.fn(), record: vi.fn() };
  const progressService = { review: vi.fn(), record: vi.fn() };
  return {
    trackingService,
    progressService,
    tracking: new StaffSolarPostalController({} as never, trackingService as never),
    progress: new SolarProgressController(progressService as never),
  };
}
function failure(call: () => unknown): HttpException {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('PRIVATE');
    return error as HttpException;
  }
  throw new Error('Expected rejected command');
}
function noWrites(value: ReturnType<typeof fixture>) {
  for (const method of [
    ...Object.values(value.trackingService),
    ...Object.values(value.progressService),
  ])
    expect(method).not.toHaveBeenCalled();
}

for (const confirm of [false, true]) {
  const phase = confirm ? 'record' : 'review';
  const trackingBody = (body: Record<string, unknown>) =>
    confirm ? { ...body, expectedReviewHash: hash } : body;
  const progressBody = (body: Record<string, unknown>) =>
    confirm ? { ...body, expectedReviewHash: hash } : body;
  const callTracking = (
    value: ReturnType<typeof fixture>,
    body: unknown,
    request: AuthenticatedRequest = actor
  ) =>
    confirm
      ? value.tracking.trackingRecord(requestId, request, body)
      : value.tracking.trackingReview(requestId, request, body);
  const callProgress = (
    value: ReturnType<typeof fixture>,
    body: unknown,
    request: AuthenticatedRequest = actor
  ) =>
    confirm
      ? value.progress.record(requestId, request, body)
      : value.progress.review(requestId, request, body);

  it.each([
    [{ ...tracking, estimatedArrivalDate: '2026-02-30' }, ['estimatedArrivalDate']],
    [{ ...tracking, trackingUrl: 'PRIVATE' }, ['trackingUrl']],
    [{ ...tracking, trackingUrl: 12 }, ['trackingUrl']],
    [{ ...tracking, note: ' ' }, ['note']],
    [{ ...tracking, note: 'PRIVATE'.repeat(143) }, ['note']],
    [
      { ...tracking, estimatedArrivalDate: 'PRIVATE', note: null },
      ['estimatedArrivalDate', 'note'],
    ],
  ] as const)(`owns only editable tracking fields during ${phase} (%#)`, (body, fields) => {
    const value = fixture();
    const error = failure(() => callTracking(value, trackingBody(body)));
    expect(error).toBeInstanceOf(InputFieldException);
    expect((error as InputFieldException).fields).toEqual([...fields]);
    noWrites(value);
  });

  it.each([
    { ...tracking, idempotencyKey: 'PRIVATE' },
    { ...tracking, expectedRevision: -1 },
    { ...tracking, note: ' ', expectedRevision: 'PRIVATE' },
    { ...tracking, extra: 'PRIVATE' },
  ])(`keeps protected or mixed tracking failures generic during ${phase} (%#)`, (body) => {
    const value = fixture();
    const error = failure(() => callTracking(value, trackingBody(body)));
    expect(error.getStatus()).toBe(400);
    expect(error).not.toBeInstanceOf(InputFieldException);
    noWrites(value);
  });

  it.each([
    { ...milestone, note: ' ' },
    { ...milestone, note: null },
    { ...milestone, note: 'PRIVATE'.repeat(143) },
  ])(`owns the construction note during ${phase} (%#)`, (body) => {
    const value = fixture();
    const error = failure(() => callProgress(value, progressBody(body)));
    expect(error).toBeInstanceOf(InputFieldException);
    expect((error as InputFieldException).fields).toEqual(['note']);
    noWrites(value);
  });

  it.each([
    { ...milestone, stage: 'PRIVATE' },
    { ...milestone, operationId: 'PRIVATE' },
    { ...milestone, expectedRevision: -1, note: ' ' },
    { ...milestone, extra: 'PRIVATE' },
  ])(`keeps protected or mixed construction failures generic during ${phase} (%#)`, (body) => {
    const value = fixture();
    const error = failure(() => callProgress(value, progressBody(body)));
    expect(error.getStatus()).toBe(400);
    expect(error).not.toBeInstanceOf(InputFieldException);
    noWrites(value);
  });

  it(`checks current write authority before field projection during ${phase}`, () => {
    for (const session of [
      { ...actor.session, permissions: ['orders:read'] },
      { ...actor.session, operatingContext: 'customer' },
    ]) {
      const value = fixture();
      const denied = { ...actor, session } as AuthenticatedRequest;
      for (const call of [
        () =>
          callTracking(value, trackingBody({ ...tracking, note: 'PRIVATE'.repeat(143) }), denied),
        () => callProgress(value, progressBody({ ...milestone, note: ' ' }), denied),
      ]) {
        const error = failure(call);
        expect(error.getStatus()).toBe(403);
        expect(error).not.toBeInstanceOf(InputFieldException);
      }
      noWrites(value);
    }
  });

  it(`retains normalized commands, exact review hashes and service authority during ${phase}`, () => {
    const value = fixture();
    callTracking(value, trackingBody({ ...tracking, note: `  ${'x'.repeat(1000)}  ` }));
    const normalizedTracking = {
      ...tracking,
      trackingUrl: 'https://courier.example/parcel#shipment',
      note: 'x'.repeat(1000),
      idempotencyKey: operationId.toLowerCase(),
    };
    expect(value.trackingService[phase]).toHaveBeenCalledWith(
      actor.session,
      requestId,
      confirm ? { ...normalizedTracking, expectedReviewHash: hash } : normalizedTracking,
      ...(confirm ? [actor.ip] : [])
    );
    callProgress(value, progressBody({ ...milestone, note: `  ${'x'.repeat(1000)}  ` }));
    const normalizedMilestone = {
      ...milestone,
      note: 'x'.repeat(1000),
      operationId: operationId.toLowerCase(),
    };
    expect(value.progressService[phase]).toHaveBeenCalledWith(
      actor.session,
      requestId,
      normalizedMilestone,
      ...(confirm ? [hash, actor.ip] : [])
    );
  });
}

it('never projects protected or missing review hashes onto either form', () => {
  for (const expectedReviewHash of [undefined, 'PRIVATE']) {
    const value = fixture();
    for (const call of [
      () => value.tracking.trackingRecord(requestId, actor, { ...tracking, expectedReviewHash }),
      () => value.progress.record(requestId, actor, { ...milestone, expectedReviewHash }),
    ]) {
      const error = failure(call);
      expect(error.getStatus()).toBe(400);
      expect(error).not.toBeInstanceOf(InputFieldException);
    }
    noWrites(value);
  }
});
