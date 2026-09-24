import { describe, expect, it, vi } from 'vitest';
import { InvoiceLedgerController } from './invoice-ledger.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const ID = '11111111-1111-7111-8111-111111111111';
const session = { userId: 'staff', sessionId: 'session', csrfToken: 'csrf' };
const allowed = {
  session: { ...session, permissions: ['invoices:read'] },
} as unknown as AuthenticatedRequest;
const denied = { session: { ...session, permissions: [] } } as unknown as AuthenticatedRequest;

function setup() {
  const service = {
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    get: vi.fn().mockResolvedValue({ invoiceId: ID }),
  };
  return { service, controller: new InvoiceLedgerController(service as never) };
}

describe('staff invoice ledger access and filters', () => {
  it('requires invoice read permission for list and detail', async () => {
    const { controller, service } = setup();
    await expect(controller.list(denied, {})).rejects.toMatchObject({ status: 403 });
    await expect(controller.get(denied, ID)).rejects.toMatchObject({ status: 403 });
    expect(service.list).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });

  it('validates status, lookup ID and complete cursor before querying', async () => {
    const { controller, service } = setup();
    await expect(controller.list(allowed, { state: 'PartiallyPaid' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      controller.list(allowed, { beforeAt: '2026-09-24T00:00:00Z' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(controller.list(allowed, { invoiceId: 'bad' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(controller.list(allowed, { profileId: 'bad' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(controller.list(allowed, { orderId: 'bad' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(controller.get(allowed, 'bad')).rejects.toMatchObject({ status: 400 });
    expect(service.list).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });

  it('passes permitted filters and detail lookup to the service', async () => {
    const { controller, service } = setup();
    const filter = { state: 'Unpaid', invoiceId: ID, profileId: ID, orderId: ID };
    await controller.list(allowed, filter);
    await controller.get(allowed, ID);
    expect(service.list).toHaveBeenCalledWith(allowed.session, filter);
    expect(service.get).toHaveBeenCalledWith(allowed.session, ID);
  });
});
