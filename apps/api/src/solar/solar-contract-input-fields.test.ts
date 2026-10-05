import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { StaffSolarFinalController } from './solar-final.controller.js';
import { solarContractSchema } from './solar-contract.validation.js';

const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const req = {
  session: { userId: 'opaque-staff', permissions: ['contracts:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
function input() {
  return {
    profileId,
    idempotencyKey: id,
    title: '  Solar title  ',
    text: '  Contract terms  ',
    changeDescription: '  Initial issue  ',
    commercialValue: { kind: 'fixed', amountIrr: '0' },
    source: { kind: 'template', templateVersionId: id },
    invoiceLines: [
      {
        description: '  Deposit  ',
        quantity: 1,
        unitPrice: '00010',
        vatRate: 900,
        isTaxable: true,
      },
    ],
  };
}
function fixture(write: boolean) {
  const authorize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const saved = { original: 'unchanged engine result' };
  const work = vi.fn().mockResolvedValue(saved);
  const controller = new StaffSolarFinalController(
    {} as never,
    {
      assertCanEditSolarContract: authorize,
      reviewSolar: work,
      createSolar: work,
    } as never
  );
  const body = { ...input(), ...(write ? { expectedReviewHash: 'a'.repeat(64) } : {}) };
  const invoke = (value: unknown, request = req) =>
    write
      ? controller.createContract(id, value, request)
      : controller.reviewContract(id, value, request);
  return { authorize, work, saved, body, invoke };
}
async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected rejected input');
}
it.each([false, true])(
  'valid write=%s bypasses feedback preflight and preserves normalized command/result',
  async (write) => {
    const f = fixture(write);
    expect(await f.invoke(f.body)).toBe(f.saved);
    const normalized = {
      ...f.body,
      requestId: id,
      title: 'Solar title',
      text: 'Contract terms',
      changeDescription: 'Initial issue',
      invoiceLines: [{ ...f.body.invoiceLines[0], description: 'Deposit' }],
    };
    expect(f.work).toHaveBeenCalledWith(normalized, req.session, ...(write ? [req.ip] : []));
    expect(f.authorize).not.toHaveBeenCalled();
  }
);
it.each([false, true])(
  'projects only known nested and row fields after current authority write=%s',
  async (write) => {
    const f = fixture(write);
    for (const [patch, fields] of [
      [
        { title: '', text: null, changeDescription: 'PRIVATE'.repeat(200) },
        ['title', 'text', 'changeDescription'],
      ],
      [
        { commercialValue: { kind: 'fixed', amountIrr: '9223372036854775808' } },
        ['commercialValueAmountIrr'],
      ],
      [
        { commercialValue: { kind: 'variable', description: '  ' } },
        ['commercialValueDescription'],
      ],
      [{ commercialValue: { kind: 'PRIVATE' } }, ['commercialValueKind']],
      [{ source: { kind: 'template', templateVersionId: 'PRIVATE' } }, ['sourceTemplateVersionId']],
      [{ source: { kind: 'document', documentId: 'PRIVATE' } }, ['sourceDocumentId']],
      [{ source: { kind: 'PRIVATE' } }, ['sourceKind']],
      [{ invoiceLines: [] }, ['invoiceLines']],
      [
        {
          invoiceLines: [
            { description: '', quantity: 0, unitPrice: 'PRIVATE', vatRate: 10001, isTaxable: null },
          ],
        },
        [
          'invoiceLine0Description',
          'invoiceLine0Quantity',
          'invoiceLine0UnitPrice',
          'invoiceLine0VatRate',
          'invoiceLine0IsTaxable',
        ],
      ],
    ] as const) {
      const error = await failure(f.invoke({ ...f.body, ...patch }));
      expect(error).toBeInstanceOf(InputFieldException);
      expect(error).toMatchObject({ fields });
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
      expect(f.authorize).toHaveBeenLastCalledWith(id, profileId, req.session, write);
    }
    const lines = Array.from({ length: 100 }, () => ({ ...f.body.invoiceLines[0] }));
    lines[99]!.unitPrice = 'PRIVATE';
    expect(await failure(f.invoke({ ...f.body, invoiceLines: lines }))).toMatchObject({
      fields: ['invoiceLine99UnitPrice'],
    });
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each([false, true])(
  'keeps root, protected, extra and mixed input generic write=%s',
  async (write) => {
    const f = fixture(write);
    for (const body of [
      null,
      [],
      'PRIVATE',
      { ...f.body, profileId: 'PRIVATE', title: '' },
      { ...f.body, idempotencyKey: 'PRIVATE', text: '' },
      { ...f.body, secret: 'PRIVATE' },
      { ...f.body, commercialValue: { kind: 'PRIVATE', secret: 'PRIVATE' } },
      { ...f.body, commercialValue: { kind: 'PRIVATE', amountIrr: '0', description: 'PRIVATE' } },
      { ...f.body, source: { kind: 'PRIVATE', expectedReviewHash: 'PRIVATE' } },
      { ...f.body, source: { kind: 'PRIVATE', templateVersionId: id, documentId: id } },
      { ...f.body, title: '', secret: 'PRIVATE' },
      { ...f.body, source: { ...f.body.source, secret: 'PRIVATE' }, text: '' },
      { ...f.body, commercialValue: { ...f.body.commercialValue, secret: 'PRIVATE' }, title: '' },
      { ...f.body, invoiceLines: [{ ...f.body.invoiceLines[0], quantity: 0, secret: 'PRIVATE' }] },
      { ...f.body, text: 'ف'.repeat(40000) },
      ...(write
        ? [{ ...f.body, expectedReviewHash: 'PRIVATE', title: '' }]
        : [{ ...f.body, expectedReviewHash: 'a'.repeat(64), title: '' }]),
    ]) {
      const error = await failure(f.invoke(body));
      expect(error.getStatus()).toBe(400);
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(JSON.stringify(error.getResponse())).not.toMatch(/PRIVATE|fields/);
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each([false, true])(
  'preserves current permission/resource/session denial instead of fields write=%s',
  async (write) => {
    const f = fixture(write);
    for (const status of [401, 403, 404, 409]) {
      const denied = new HttpException('Current authority', status);
      f.authorize.mockRejectedValueOnce(denied);
      expect(await failure(f.invoke({ ...f.body, title: '' }))).toBe(denied);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each([false, true])(
  'checks cached contracts grant before any parser/write=%s',
  async (write) => {
    const f = fixture(write);
    const denied = {
      session: { ...req.session, permissions: [] },
      ip: req.ip,
    } as unknown as AuthenticatedRequest;
    for (const body of [f.body, { ...f.body, title: '' }, null])
      expect((await failure(f.invoke(body, denied))).getStatus()).toBe(403);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(['PRIVATE', '1.25', '۱۲۳', '-1', '', '1'.repeat(20), '9223372036854775808'])(
  'invalid row IRR %s safely returns validation failure without BigInt throwing',
  (unitPrice) => {
    const body = input();
    body.invoiceLines[0]!.unitPrice = unitPrice;
    expect(() => solarContractSchema.safeParse(body)).not.toThrow();
    const parsed = solarContractSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(
        parsed.error.issues.every((issue) => issue.path.join('.') === 'invoiceLines.0.unitPrice')
      ).toBe(true);
  }
);
it.each(['0', '000', '0001', '9223372036854775807'])(
  'accepted row IRR %s remains unchanged',
  (unitPrice) => {
    const body = input();
    body.invoiceLines[0]!.unitPrice = unitPrice;
    const parsed = solarContractSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.invoiceLines[0]!.unitPrice).toBe(unitPrice);
  }
);
