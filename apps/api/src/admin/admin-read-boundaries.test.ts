import { describe, expect, it, vi } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

function request(permissions: string[]): AuthenticatedRequest {
  return { session: { userId: 'reader', permissions, isAdmin: false } } as AuthenticatedRequest;
}
function fixture() {
  const logs = vi.fn().mockResolvedValue({ logs: [], total: 0 });
  const templates = vi.fn().mockResolvedValue([]);
  const staff = vi.fn().mockResolvedValue({ staff: [], total: 0 });
  return {
    logs,
    templates,
    staff,
    controller: new AdminController(
      { listStaff: staff } as never,
      {} as never,
      {} as never,
      { list: templates } as never,
      { findDeliveryLogs: logs } as never
    ),
  };
}
describe('privileged delivery log reads', () => {
  it.each(
    [[], ['admin:notifications:edit'], ['admin:notification-providers:edit']].map(
      (permissions) => ({ permissions })
    )
  )('denies unrelated capabilities $permissions', async ({ permissions }) => {
    const { controller, logs } = fixture();
    await expect(controller.listDeliveryLogs(request(permissions))).rejects.toMatchObject({
      status: 403,
    });
    expect(logs).not.toHaveBeenCalled();
  });
  it('requires the current jobs-read capability and honors revocation', async () => {
    const { controller, logs } = fixture();
    const req = request(['admin:jobs:view']);
    await expect(controller.listDeliveryLogs(req)).resolves.toEqual({ logs: [], total: 0 });
    expect(logs).toHaveBeenCalledWith({});
    req.session.permissions = [];
    await expect(controller.listDeliveryLogs(req)).rejects.toMatchObject({ status: 403 });
    expect(logs).toHaveBeenCalledOnce();
  });
  it('passes bounded page inputs and channel/status selection', async () => {
    const { controller, logs } = fixture();
    await controller.listDeliveryLogs(
      request(['admin:jobs:view']),
      'notification-1',
      'email',
      'failed',
      '20',
      '40'
    );
    expect(logs).toHaveBeenCalledWith({
      notificationId: 'notification-1',
      channel: 'email',
      status: 'failed',
      limit: 20,
      offset: 40,
    });
  });
  it('does not pass nonnumeric pagination into database queries', async () => {
    const { controller, logs } = fixture();
    await controller.listDeliveryLogs(
      request(['admin:jobs:view']),
      undefined,
      undefined,
      undefined,
      'not-a-number',
      'NaN'
    );
    expect(logs).toHaveBeenCalledWith({});
  });
});
describe('staff and template list filters', () => {
  it('passes staff pagination without silently discarding it', async () => {
    const { controller, staff } = fixture();
    await controller.listStaff('10', '20', request(['admin:staff:view']));
    expect(staff).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });
  it('falls back to service defaults for invalid staff pagination', async () => {
    const { controller, staff } = fixture();
    await controller.listStaff('bad', 'bad', request(['admin:staff:view']));
    expect(staff).toHaveBeenCalledWith({});
  });
  it.each([
    { locale: 'en', channel: 'email', status: 'active' },
    { locale: 'fa', channel: 'sms', status: 'draft' },
    { locale: 'en', channel: 'in_app', status: 'active' },
  ])('preserves template filters $locale/$channel/$status', async (filters) => {
    const { controller, templates } = fixture();
    await controller.listNotificationTemplates(
      filters.locale,
      filters.channel,
      filters.status,
      request(['admin:notifications:edit'])
    );
    expect(templates).toHaveBeenCalledWith(filters);
  });
  it('does not forward unsupported template enums', async () => {
    const { controller, templates } = fixture();
    await controller.listNotificationTemplates(
      'unknown',
      'push',
      'deleted',
      request(['admin:notifications:edit'])
    );
    expect(templates).toHaveBeenCalledWith({});
  });
});
