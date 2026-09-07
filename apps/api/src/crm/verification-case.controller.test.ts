import { describe, expect, it, vi } from 'vitest';
import { VerificationCaseController } from './verification-case.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const profileId = '11111111-2222-4333-8444-555555555555';
const caseId = '22222222-2222-4333-8444-555555555555';
const draft = {
  fieldName: 'first_name',
  currentValue: null,
  requestedValue: ' Corrected ',
  reason: ' Checked evidence ',
  evidenceUrls: ['uploads/document/evidence.pdf'],
};
function request(permissions: string[] = [], isAdmin = false): AuthenticatedRequest {
  return { session: { userId: 'reviewer', permissions, isAdmin } } as AuthenticatedRequest;
}
function fixture() {
  const service = {
    createCase: vi.fn().mockResolvedValue({ id: caseId }),
    listCases: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getCase: vi.fn().mockResolvedValue({ id: caseId }),
    reviewCase: vi.fn().mockResolvedValue({ id: caseId, status: 'Approved' }),
  };
  return { service, controller: new VerificationCaseController(service as never) };
}
type Operation = {
  name: string;
  permission: string;
  run: (c: VerificationCaseController, r: AuthenticatedRequest) => Promise<unknown>;
};
const operations: Operation[] = [
  {
    name: 'create',
    permission: 'crm:edit-identity',
    run: (c, r) => c.createCase(profileId, draft, r),
  },
  { name: 'queue', permission: 'verification:read', run: (c, r) => c.listCases(r) },
  {
    name: 'profile queue',
    permission: 'verification:read',
    run: (c, r) => c.listProfileCases(profileId, r),
  },
  { name: 'detail', permission: 'verification:read', run: (c, r) => c.getCase(caseId, r) },
  {
    name: 'review',
    permission: 'crm:verify',
    run: (c, r) => c.reviewCase(caseId, { decision: 'Approved' }, r),
  },
];

describe.each(operations)('verification $name boundary', ({ permission, run }) => {
  it.each([{ permissions: [] }, { permissions: ['admin:staff:view'] }])(
    'denies unrelated permissions %j before service access',
    async ({ permissions }) => {
      const { controller, service } = fixture();
      await expect(run(controller, request(permissions))).rejects.toMatchObject({ status: 403 });
      for (const call of Object.values(service)) expect(call).not.toHaveBeenCalled();
    }
  );
  it.each(['explicit', 'wildcard', 'admin'])(
    'accepts %s authority and immediately respects revocation',
    async (mode) => {
      const { controller, service } = fixture();
      const req = request(
        mode === 'explicit' ? [permission] : mode === 'wildcard' ? ['*'] : [],
        mode === 'admin'
      );
      await expect(run(controller, req)).resolves.toBeDefined();
      expect(Object.values(service).reduce((n, call) => n + call.mock.calls.length, 0)).toBe(1);
      for (const call of Object.values(service)) call.mockClear();
      req.session.permissions = [];
      req.session.isAdmin = false;
      await expect(run(controller, req)).rejects.toMatchObject({ status: 403 });
      for (const call of Object.values(service)) expect(call).not.toHaveBeenCalled();
    }
  );
});

describe('verification correction validation and results', () => {
  it.each([
    { fieldName: 'email' },
    { requestedValue: ' ' },
    { requestedValue: 'x'.repeat(513) },
    { reason: '' },
    { reason: 'x'.repeat(1001) },
    { evidenceUrls: [] },
    { evidenceUrls: Array(6).fill('uploads/evidence.pdf') },
    { evidenceUrls: [123] },
    { untrustedExtra: true },
  ])('rejects malformed correction %j without service mutation', async (extra) => {
    const { controller, service } = fixture();
    await expect(
      controller.createCase(
        profileId,
        { ...draft, ...extra } as never,
        request(['crm:edit-identity'])
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(service.createCase).not.toHaveBeenCalled();
  });
  it('normalizes input and takes audit identity from the session', async () => {
    const { controller, service } = fixture();
    const { currentValue: _currentValue, ...withoutCurrent } = draft;
    await controller.createCase(profileId, withoutCurrent as never, request(['crm:edit-identity']));
    expect(service.createCase).toHaveBeenCalledWith(
      profileId,
      {
        ...draft,
        requestedValue: 'Corrected',
        reason: 'Checked evidence',
        currentValue: null,
      },
      'reviewer',
      'unknown'
    );
  });
  it.each([
    { decision: 'Deleted' },
    { decision: 'Approved', reviewerNotes: 12 },
    { decision: 'Approved', reviewerNotes: 'x'.repeat(1001) },
    { decision: 'Approved', userId: 'forged' },
  ])('rejects malformed decision %j', async (body) => {
    const { controller, service } = fixture();
    await expect(
      controller.reviewCase(caseId, body as never, request(['crm:verify']))
    ).rejects.toMatchObject({ status: 400 });
    expect(service.reviewCase).not.toHaveBeenCalled();
  });
  it('passes normalized rejection notes and trusted audit IP', async () => {
    const { controller, service } = fixture();
    const req = Object.assign(request(['crm:verify']), { ip: '192.0.2.1' });
    await controller.reviewCase(
      caseId,
      { decision: 'Rejected', reviewerNotes: ' Missing proof ' },
      req
    );
    expect(service.reviewCase).toHaveBeenCalledWith(
      caseId,
      { decision: 'Rejected', reviewerNotes: 'Missing proof' },
      'reviewer',
      '192.0.2.1'
    );
  });
  it.each(['createCase', 'getCase', 'reviewCase'] as const)(
    'maps missing resource for %s to 404',
    async (method) => {
      const { controller, service } = fixture();
      service[method].mockResolvedValue(null as never);
      const operation = operations.find(
        (o) => o.name === { createCase: 'create', getCase: 'detail', reviewCase: 'review' }[method]
      )!;
      await expect(operation.run(controller, request(['*']))).rejects.toMatchObject({
        status: 404,
      });
    }
  );
  it.each(['createCase', 'getCase', 'reviewCase'] as const)(
    'preserves domain validation failures for %s',
    async (method) => {
      const { controller, service } = fixture();
      service[method].mockResolvedValue({ error: 'Evidence is required' } as never);
      const operation = operations.find(
        (o) => o.name === { createCase: 'create', getCase: 'detail', reviewCase: 'review' }[method]
      )!;
      await expect(operation.run(controller, request(['*']))).rejects.toMatchObject({
        status: 400,
      });
    }
  );
  it('reports terminal transition conflicts without returning success', async () => {
    const { controller, service } = fixture();
    service.reviewCase.mockResolvedValue({ error: 'Invalid transition from Approved' } as never);
    await expect(
      controller.reviewCase(caseId, { decision: 'Rejected' }, request(['crm:verify']))
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([false, true])(
    'returns viewer capabilities independently of read permission, profile=%s',
    async (profile) => {
      const { controller, service } = fixture();
      const req = request(['verification:read']);
      const result = profile
        ? await controller.listProfileCases(profileId, req)
        : await controller.listCases(req);
      expect(result.viewer).toEqual({ userId: 'reviewer', canCreate: false, canReview: false });
      expect(service.listCases).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 0 })
      );
      req.session.permissions = ['verification:read', 'crm:edit-identity', 'crm:verify'];
      const elevated = profile
        ? await controller.listProfileCases(profileId, req, 'Open', '200', '-1')
        : await controller.listCases(req, 'Open', profileId, 'creator', '200', '-1');
      expect(elevated.viewer).toEqual({ userId: 'reviewer', canCreate: true, canReview: true });
      expect(service.listCases).toHaveBeenLastCalledWith(
        expect.objectContaining({ profileId, status: 'Open', limit: 100, offset: 0 })
      );
    }
  );
});
