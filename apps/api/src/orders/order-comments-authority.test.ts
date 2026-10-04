import { HttpException } from '@nestjs/common';
import { beforeEach, expect, it, vi } from 'vitest';
import { ElectricityCommentsService } from '../electricity/electricity-comments.service.js';
import { SavingCommentsService } from '../saving/saving-comments.service.js';

const h = vi.hoisted(() => ({
  events: [] as string[],
  connect: vi.fn<() => Promise<unknown>>(),
  permission: vi.fn<(...args: unknown[]) => Promise<void>>(),
  stepUp: vi.fn<(...args: unknown[]) => Promise<void>>(),
  currentSession: vi.fn<(...args: unknown[]) => Promise<void>>(),
  mutation: vi.fn(),
}));
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ connect: h.connect }) }));
vi.mock('../admin/staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: h.permission,
}));
vi.mock('../session/session-step-up.js', () => ({
  requireCurrentSession: h.currentSession,
  requireSessionStepUp: h.stepUp,
}));
vi.mock('../database/idempotency.js', () => ({ idempotentMutation: h.mutation }));
vi.mock('../orders/orders.service.js', () => ({ OrdersService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));

const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: 'customer', sessionId: id, csrfToken: 'csrf' };
const contexts = [
  { kind: 'electricity', Service: ElectricityCommentsService },
  { kind: 'saving', Service: SavingCommentsService },
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  h.events = [];
  h.permission.mockImplementation(async (_client, _user, permission) => {
    h.events.push(`permission:${String(permission)}`);
  });
  h.stepUp.mockImplementation(async () => {
    h.events.push('stepUp');
  });
  h.currentSession.mockImplementation(async () => {
    h.events.push('currentSession');
  });
});
function fixture(context: (typeof contexts)[number]) {
  let found = true;
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      const orderQuery = sql.includes(`FROM ${context.kind}_orders`);
      h.events.push(orderQuery ? 'order' : sql);
      if (orderQuery) {
        expect(values).toEqual([id]);
        if (context.kind === 'electricity') {
          expect(sql).toContain('e.submitted_at IS NOT NULL');
          expect(sql).toContain('FOR SHARE OF e,p');
        }
        return { rows: found ? [{ id, profile_id: profileId, customer_id: 'owner' }] : [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  h.connect.mockResolvedValue(client);
  const orders = {
    lockOrderActor: vi.fn(async () => {
      h.events.push('lockActor');
    }),
    mayManageOrders: vi.fn(async () => {
      h.events.push('mayManageOrders');
      return true;
    }),
  };
  const service = new context.Service(orders as never);
  return {
    client,
    orders,
    service,
    missing: () => {
      found = false;
    },
  };
}
const noEffects = (client: ReturnType<typeof fixture>['client']) => {
  expect(h.mutation).not.toHaveBeenCalled();
  for (const [sql] of client.query.mock.calls)
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|audit_log|notifications|idempotency/i);
  expect(client.release).toHaveBeenCalledOnce();
};

it.each(contexts)(
  'reuses current customer actor, owner/legal-manager and final-session checks without effects for $kind',
  async (context) => {
    const f = fixture(context);
    await f.service.assertCanAdd(id, actor, false);
    expect(f.orders.lockOrderActor).toHaveBeenCalledWith(f.client, actor);
    expect(f.orders.mayManageOrders).toHaveBeenCalledWith(f.client, actor.userId, profileId);
    expect(h.events).toEqual([
      'BEGIN',
      'lockActor',
      'order',
      'mayManageOrders',
      'currentSession',
      'COMMIT',
    ]);
    expect(h.permission).not.toHaveBeenCalled();
    noEffects(f.client);
  }
);

it.each(contexts)(
  'reuses contracts:write and step-up before the resource, then final current-session check for $kind staff',
  async (context) => {
    const f = fixture(context);
    await f.service.assertCanAdd(id, actor, true);
    expect(h.permission).toHaveBeenCalledWith(f.client, actor.userId, 'contracts:write');
    expect(h.stepUp).toHaveBeenCalledWith(f.client, actor);
    expect(h.events).toEqual([
      'BEGIN',
      'permission:contracts:write',
      'stepUp',
      'order',
      'currentSession',
      'COMMIT',
    ]);
    expect(f.orders.mayManageOrders).not.toHaveBeenCalled();
    noEffects(f.client);
  }
);

it.each(contexts)(
  'denies missing and unmanageable order resources before feedback for $kind',
  async (context) => {
    const missing = fixture(context);
    missing.missing();
    await expect(missing.service.assertCanAdd(id, actor, false)).rejects.toMatchObject({
      status: 404,
    });
    expect(h.events.at(-1)).toBe('ROLLBACK');
    expect(h.currentSession).not.toHaveBeenCalled();
    noEffects(missing.client);
    h.events = [];
    const foreign = fixture(context);
    foreign.orders.mayManageOrders.mockResolvedValueOnce(false);
    await expect(foreign.service.assertCanAdd(id, actor, false)).rejects.toMatchObject({
      status: 404,
    });
    expect(h.events.at(-1)).toBe('ROLLBACK');
    noEffects(foreign.client);
  }
);

it.each(contexts)(
  'preserves permission, step-up and final live-session denial and rolls back for $kind',
  async (context) => {
    for (const gate of ['permission', 'stepUp', 'currentSession'] as const) {
      const f = fixture(context);
      const denied = new HttpException(
        'Live authority expired',
        gate === 'currentSession' ? 401 : 403
      );
      h[gate].mockRejectedValueOnce(denied);
      await expect(f.service.assertCanAdd(id, actor, true)).rejects.toBe(denied);
      expect(h.events.at(-1)).toBe('ROLLBACK');
      expect(h.events).not.toContain('COMMIT');
      noEffects(f.client);
      h.events = [];
    }
  }
);
