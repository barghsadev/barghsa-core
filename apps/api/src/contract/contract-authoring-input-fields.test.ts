import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { ContractController } from './contract.controller.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const versionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const req = {
  session: { userId: 'opaque-staff', permissions: ['contracts:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const routes = ['create', 'update', 'amendment'] as const;
type Route = (typeof routes)[number];
function fixture(route: Route) {
  const authorize = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const saved = { original: 'durable authoring engine result' };
  const work = vi.fn().mockResolvedValue(saved);
  const service = {
    assertCanAuthorDraft: authorize,
    create: work,
    updateContract: work,
    createAmendment: work,
  };
  const controller = new ContractController(service as never, {} as never);
  const body: Record<string, unknown> = {
    content: { title: null, text: ['opaque imported terms'], price: '9007199254740993' },
    changeDescription: '  Captured revision  ',
    idempotencyKey: id.toUpperCase(),
    ...(route === 'create'
      ? { profileId: profileId.toUpperCase(), serviceType: 'savings' }
      : { expectedVersionId: versionId.toUpperCase() }),
  };
  const invoke = (value: unknown, actor = req, resource = id): Promise<unknown> =>
    route === 'create'
      ? controller.create(actor, value)
      : route === 'update'
        ? controller.update(actor, resource, value)
        : controller.createAmendment(actor, resource, value);
  return { body, authorize, work, saved, invoke };
}
async function failure(work: Promise<unknown>): Promise<HttpException> {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected rejection');
}
it.each(routes)(
  '%s valid opaque content retains normalization and bypasses feedback preflight',
  async (route) => {
    const f = fixture(route);
    expect(await f.invoke(f.body, req, id.toUpperCase())).toBe(f.saved);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).toHaveBeenCalledWith(
      ...(route === 'create' ? [] : [id]),
      {
        ...f.body,
        changeDescription: 'Captured revision',
        idempotencyKey: id,
        ...(route === 'create' ? { profileId } : { expectedVersionId: versionId }),
      },
      req.session,
      req.ip
    );
  }
);
it.each(routes)(
  '%s projects only an invalid description after current authority',
  async (route) => {
    const f = fixture(route);
    for (const changeDescription of [undefined, null, ' ', 'PRIVATE'.repeat(200)]) {
      const raw = { ...f.body, changeDescription };
      const error = await failure(f.invoke(raw));
      expect(error).toBeInstanceOf(InputFieldException);
      expect(error).toMatchObject({ fields: ['changeDescription'] });
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT:INVALID' });
      expect(JSON.stringify(error.getResponse())).not.toMatch(/PRIVATE|Captured/);
      expect(f.authorize).toHaveBeenLastCalledWith(
        route,
        route === 'create' ? null : id,
        raw,
        req.session
      );
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(
  routes.flatMap((route) =>
    ['initialInvoiceId', 'serviceStartsAt', 'serviceEndsAt'].map((field) => ({ route, field }))
  )
)('$route projects only the exact activation context leaf $field', async ({ route, field }) => {
  const f = fixture(route);
  const body = {
    ...f.body,
    activationContext: { initialInvoiceId: null, serviceStartsAt: null, [field]: 'PRIVATE' },
  };
  const error = await failure(f.invoke(body));
  expect(error).toBeInstanceOf(InputFieldException);
  expect(error).toMatchObject({ fields: [field] });
  expect(f.authorize).toHaveBeenCalledOnce();
  expect(f.work).not.toHaveBeenCalled();
  expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
});
it.each(
  routes.flatMap((route) => [
    {
      route,
      commercialValue: { kind: 'fixed', amountIrr: '1.5' },
      field: 'commercialValueAmountIrr',
    },
    {
      route,
      commercialValue: { kind: 'variable', description: ' ' },
      field: 'commercialValueDescription',
    },
  ])
)(
  '$route attributes strict supported commercial $field without exposing imported content',
  async ({ route, commercialValue, field }) => {
    const f = fixture(route);
    const error = await failure(
      f.invoke({ ...f.body, content: { imported: 'PRIVATE', commercialValue } })
    );
    expect(error).toBeInstanceOf(InputFieldException);
    expect(error).toMatchObject({ fields: [field] });
    expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    expect(f.authorize).toHaveBeenCalledOnce();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(routes)(
  '%s keeps root, protected, mixed, oversized and ambiguous branch errors generic',
  async (route) => {
    const f = fixture(route);
    for (const body of [
      null,
      [],
      'PRIVATE',
      { ...f.body, changeDescription: '', idempotencyKey: 'PRIVATE' },
      { ...f.body, changeDescription: '', privateExtra: 'PRIVATE' },
      { ...f.body, content: {} },
      {
        ...f.body,
        content: {
          terms: 'ا'.repeat(33_000),
          commercialValue: { kind: 'fixed', amountIrr: '1.5' },
        },
      },
      {
        ...f.body,
        content: {
          commercialValue: { kind: 'PRIVATE', amountIrr: '1.5', privateExtra: 'PRIVATE' },
        },
      },
      {
        ...f.body,
        content: { commercialValue: { kind: 'fixed', amountIrr: '1.5', description: 'PRIVATE' } },
      },
      {
        ...f.body,
        content: { commercialValue: { kind: 'variable', description: '', amountIrr: 'PRIVATE' } },
      },
      {
        ...f.body,
        content: { commercialValue: { kind: 'fixed', amountIrr: '1.5', privateExtra: 'PRIVATE' } },
      },
      { ...f.body, activationContext: null },
      {
        ...f.body,
        activationContext: {
          initialInvoiceId: null,
          serviceStartsAt: 'PRIVATE',
          privateExtra: 'PRIVATE',
        },
      },
      {
        ...f.body,
        activationContext: {
          initialInvoiceId: null,
          serviceStartsAt: '2026-10-02T00:00:00Z',
          serviceEndsAt: '2026-10-01T00:00:00Z',
        },
      },
      ...(route === 'create'
        ? [
            { ...f.body, changeDescription: '', profileId: 'PRIVATE' },
            { ...f.body, changeDescription: '', orderId: 'PRIVATE' },
            { ...f.body, changeDescription: '', serviceType: 'PRIVATE' },
          ]
        : [{ ...f.body, changeDescription: '', expectedVersionId: 'PRIVATE' }]),
    ]) {
      const error = await failure(f.invoke(body));
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:PARSE:ZOD_ERROR' });
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(routes)(
  '%s current denial overrides otherwise owned fields without effects',
  async (route) => {
    const f = fixture(route);
    for (const status of [401, 403, 404, 409]) {
      const denied = new HttpException('Current source denial', status);
      f.authorize.mockRejectedValueOnce(denied);
      expect(await failure(f.invoke({ ...f.body, changeDescription: '' }))).toBe(denied);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(routes)('%s cached contracts grant precedes valid and invalid input', async (route) => {
  const f = fixture(route);
  const denied = {
    session: { ...req.session, permissions: [] },
    ip: req.ip,
  } as unknown as AuthenticatedRequest;
  for (const value of [f.body, { ...f.body, changeDescription: '' }, null])
    expect((await failure(f.invoke(value, denied))).getStatus()).toBe(403);
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.work).not.toHaveBeenCalled();
});
it.each(['update', 'amendment'] as const)(
  '%s rejects malformed protected route before field feedback or SQL',
  async (route) => {
    const f = fixture(route);
    const error = await failure(f.invoke({ ...f.body, changeDescription: '' }, req, 'PRIVATE'));
    expect(error.getResponse()).toEqual({ error: 'VALIDATION:PARSE:ZOD_ERROR' });
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
