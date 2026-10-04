import { expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import {
  SolarDocumentsController,
  StaffSolarDocumentsController,
} from './solar-documents.controller.js';

const request = {
  session: {
    userId: 'reviewer',
    operatingContext: 'staff',
    permissions: ['orders:write', 'admin:catalogue:edit'],
  },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const requestId = '11000000-0000-4000-8000-000000000001';
const documentId = '12000000-0000-4000-8000-000000000001';
const reviewHash = 'a'.repeat(64);
const validGuidance = { fa: 'مدارک', en: 'Documents', suggestions: [] };

function fixture() {
  const service = {
    setGuidance: vi.fn((_actor, value) => value),
    decide: vi.fn(),
    requestAdditional: vi.fn(),
    reviewSetDecision: vi.fn(),
    advanceToPostal: vi.fn(),
    complete: vi.fn(),
  };
  return {
    service,
    staff: new StaffSolarDocumentsController(service as never),
    customer: new SolarDocumentsController(service as never),
  };
}
function failure(call: () => unknown) {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('Expected validation rejection');
}
function noCalls(service: ReturnType<typeof fixture>['service']) {
  for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
}

it.each([undefined, null, 42, '', ' ', 'PRIVATE'.repeat(167)])(
  'requires an editable rejection reason without calling the service (%s)',
  (reason) => {
    const { staff, service } = fixture();
    const error = failure(() =>
      staff.reject(requestId, documentId, { expectedRevision: 1, reason }, request)
    );
    expect(error).toBeInstanceOf(InputFieldException);
    expect((error as InputFieldException).fields).toEqual(['reason']);
    expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    noCalls(service);
  }
);

it.each([undefined, null, 42, '', ' ', 'PRIVATE'.repeat(334)])(
  'requires additional-file instructions at preview and commit without service calls (%s)',
  (description) => {
    const { staff, service } = fixture();
    for (const call of [
      () =>
        staff.reviewSetDecision(
          requestId,
          { decision: 'request_additional', description },
          request
        ),
      () =>
        staff.requestAdditional(
          requestId,
          { description, expectedReviewHash: reviewHash },
          request
        ),
    ]) {
      const error = failure(call);
      expect(error).toBeInstanceOf(InputFieldException);
      expect((error as InputFieldException).fields).toEqual(['description']);
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    }
    noCalls(service);
  }
);

it('accepts trimmed values at every exact text/list bound and preserves protected command fields', () => {
  const { staff, service } = fixture();
  const reason = 'ر'.repeat(1000);
  staff.reject(requestId, documentId, { expectedRevision: 7, reason: ` ${reason} ` }, request);
  expect(service.decide).toHaveBeenCalledWith(
    request.session,
    requestId,
    documentId,
    'reject',
    7,
    reason,
    request.ip
  );
  const description = 'د'.repeat(2000);
  staff.reviewSetDecision(
    requestId,
    { decision: 'request_additional', description: ` ${description} ` },
    request
  );
  expect(service.reviewSetDecision).toHaveBeenCalledWith(
    request.session,
    requestId,
    'request_additional',
    description
  );
  staff.requestAdditional(
    requestId,
    { description: ` ${description} `, expectedReviewHash: reviewHash },
    request
  );
  expect(service.requestAdditional).toHaveBeenCalledWith(
    request.session,
    requestId,
    description,
    reviewHash,
    request.ip
  );
  const value = {
    fa: 'ف'.repeat(4000),
    en: 'e'.repeat(4000),
    suggestions: Array.from({ length: 30 }, () => ({ fa: 'ف'.repeat(200), en: 'e'.repeat(200) })),
  };
  expect(staff.setGuidance(value, request)).toEqual(value);
  expect(service.setGuidance).toHaveBeenCalledWith(request.session, value, request.ip);
});

it.each([
  [{ ...validGuidance, fa: 'PRIVATE'.repeat(572) }, ['fa']],
  [{ ...validGuidance, en: 'PRIVATE'.repeat(572) }, ['en']],
  [
    { ...validGuidance, suggestions: [{ fa: 'PRIVATE'.repeat(29), en: 'Valid' }] },
    ['suggestionsFa'],
  ],
  [
    { ...validGuidance, suggestions: [{ fa: 'درست', en: 'PRIVATE'.repeat(29) }] },
    ['suggestionsEn'],
  ],
  [
    {
      ...validGuidance,
      suggestions: Array.from({ length: 31 }, () => ({ fa: 'درست', en: 'Valid' })),
    },
    ['suggestionsFa', 'suggestionsEn'],
  ],
  [
    { ...validGuidance, fa: ' ', en: ' ', suggestions: [{ fa: '', en: '' }] },
    ['fa', 'en', 'suggestionsFa', 'suggestionsEn'],
  ],
] as const)(
  'maps guidance validation to owning language controls without reflecting input',
  (body, fields) => {
    const { staff, service } = fixture();
    const error = failure(() => staff.setGuidance(body, request));
    expect(error).toBeInstanceOf(InputFieldException);
    expect((error as InputFieldException).fields).toEqual(fields);
    expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    noCalls(service);
  }
);

it('keeps malformed/unknown/protected and mixed errors general with no service calls', () => {
  const { staff, service } = fixture();
  for (const call of [
    () => staff.setGuidance(null, request),
    () => staff.setGuidance({ ...validGuidance, suggestions: 'PRIVATE' }, request),
    () => staff.setGuidance({ ...validGuidance, suggestions: [null] }, request),
    () =>
      staff.setGuidance(
        {
          ...validGuidance,
          suggestions: [{ fa: '', en: 'Valid', 'PRIVATE KEY': 'PRIVATE VALUE' }],
        },
        request
      ),
    () => staff.setGuidance({ ...validGuidance, 'PRIVATE KEY': 'PRIVATE VALUE' }, request),
    () => staff.reject(requestId, documentId, { expectedRevision: 0, reason: '' }, request),
    () =>
      staff.reject(
        requestId,
        documentId,
        { expectedRevision: 1, reason: '', 'PRIVATE KEY': 'PRIVATE VALUE' },
        request
      ),
    () => staff.reviewSetDecision(requestId, { decision: 'PRIVATE', description: '' }, request),
    () =>
      staff.requestAdditional(
        requestId,
        { expectedReviewHash: 'PRIVATE', description: '' },
        request
      ),
  ]) {
    const error = failure(call);
    expect(error).not.toBeInstanceOf(InputFieldException);
    expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
  }
  noCalls(service);
});

it('preserves customer parsing, optional approval reasons and description-free advancement', () => {
  const { staff, customer, service } = fixture();
  const error = failure(() =>
    customer.complete(requestId, { allDocumentsUploaded: false }, request)
  );
  expect(error).not.toBeInstanceOf(InputFieldException);
  expect(service.complete).not.toHaveBeenCalled();
  staff.approve(requestId, documentId, { expectedRevision: 1 }, request);
  expect(service.decide).toHaveBeenCalledWith(
    request.session,
    requestId,
    documentId,
    'approve',
    1,
    undefined,
    request.ip
  );
  staff.reviewSetDecision(requestId, { decision: 'advance' }, request);
  expect(service.reviewSetDecision).toHaveBeenCalledWith(
    request.session,
    requestId,
    'advance',
    undefined
  );
  staff.advance(requestId, { expectedReviewHash: reviewHash }, request);
  expect(service.advanceToPostal).toHaveBeenCalledWith(
    request.session,
    requestId,
    reviewHash,
    request.ip
  );
  expect(staff.setGuidance(validGuidance, request)).toEqual(validGuidance);
});

it('checks owning staff capability before publishing validation fields', () => {
  const { staff, service } = fixture();
  const denied = {
    session: { operatingContext: 'customer', permissions: ['*'] },
  } as unknown as AuthenticatedRequest;
  for (const call of [
    () => staff.setGuidance({ fa: '' }, denied),
    () => staff.reject(requestId, documentId, { reason: '' }, denied),
    () => staff.reviewSetDecision(requestId, { decision: 'request_additional' }, denied),
    () => staff.requestAdditional(requestId, { description: '' }, denied),
  ]) {
    const error = failure(call);
    expect(error.getStatus()).toBe(403);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
  noCalls(service);
});
