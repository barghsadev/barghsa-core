import { describe, expect, it, vi } from 'vitest';
import { AdminGeographyController } from './admin-geography.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const id = '11111111-2222-4333-8444-555555555555';
const names = { nameFa: 'تهران', nameEn: 'Tehran' };
function request(permissions: string[]): AuthenticatedRequest {
  return { session: { userId: 'staff', permissions, isAdmin: false } } as AuthenticatedRequest;
}
function fixture() {
  const call = vi.fn().mockResolvedValue({ id, ...names });
  const service = {
    listProvinces: call,
    getProvince: call,
    createProvince: call,
    updateProvince: call,
    deleteProvince: call,
    listCities: call,
    getCity: call,
    createCity: call,
    updateCity: call,
    deleteCity: call,
  };
  return { call, controller: new AdminGeographyController(service as never) };
}
type Operation = {
  name: string;
  missing?: boolean;
  run: (c: AdminGeographyController, r: AuthenticatedRequest) => Promise<unknown>;
};
const operations: Operation[] = [
  { name: 'province list', run: (c, r) => c.listProvinces(r) },
  { name: 'province detail', missing: true, run: (c, r) => c.getProvince(r, id) },
  { name: 'province creation', run: (c, r) => c.createProvince(r, names) },
  {
    name: 'province update',
    missing: true,
    run: (c, r) => c.updateProvince(r, id, { status: 'inactive' }),
  },
  { name: 'province deletion', missing: true, run: (c, r) => c.deleteProvince(r, id) },
  { name: 'city list', run: (c, r) => c.listCities(r, id) },
  { name: 'city detail', missing: true, run: (c, r) => c.getCity(r, id) },
  { name: 'city creation', run: (c, r) => c.createCity(r, id, names) },
  {
    name: 'city update',
    missing: true,
    run: (c, r) => c.updateCity(r, id, { status: 'inactive' }),
  },
  { name: 'city deletion', missing: true, run: (c, r) => c.deleteCity(r, id) },
];
describe.each(operations)('geography $name access', ({ run }) => {
  it('requires geography capability and respects its removal', async () => {
    const { controller, call } = fixture();
    const req = request(['admin:config:write', 'admin:geography:edit']);
    await run(controller, req);
    expect(call).toHaveBeenCalledTimes(1);
    call.mockClear();
    req.session.permissions = ['admin:config:write'];
    await expect(run(controller, req)).rejects.toMatchObject({ status: 403 });
    expect(call).not.toHaveBeenCalled();
  });
  it('allows a platform administrator without granting other staff that authority', async () => {
    const { controller, call } = fixture();
    const req = request([]);
    await expect(run(controller, req)).rejects.toMatchObject({ status: 403 });
    expect(call).not.toHaveBeenCalled();
    req.session.isAdmin = true;
    await run(controller, req);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
describe.each(operations.filter((o) => o.missing))('missing $name resource', ({ run }) => {
  it('returns 404 rather than success for a missing record', async () => {
    const { controller, call } = fixture();
    call.mockResolvedValue(null as never);
    await expect(run(controller, request(['admin:geography:edit']))).rejects.toMatchObject({
      status: 404,
    });
  });
});
it.each(['createProvince', 'updateProvince', 'createCity', 'updateCity'] as const)(
  'validates %s before mutation',
  async (method) => {
    const { controller, call } = fixture();
    const req = request(['admin:geography:edit']);
    const invalid = { nameFa: '', nameEn: '123', status: 'deleted' };
    const action =
      method === 'createProvince'
        ? controller.createProvince(req, invalid)
        : controller[method](req, id, invalid);
    await expect(action).rejects.toMatchObject({ status: 400 });
    expect(call).not.toHaveBeenCalled();
  }
);
it('preserves search/status and numeric pagination in both lists', async () => {
  const { controller, call } = fixture();
  const req = request(['admin:geography:edit']);
  await controller.listProvinces(req, 'Tehran', 'inactive', '2', '25');
  expect(call).toHaveBeenLastCalledWith({
    search: 'Tehran',
    status: 'inactive',
    page: 2,
    limit: 25,
  });
  await controller.listCities(req, id, 'تهران', 'active', '3', '10');
  expect(call).toHaveBeenLastCalledWith(id, {
    search: 'تهران',
    status: 'active',
    page: 3,
    limit: 10,
  });
});
