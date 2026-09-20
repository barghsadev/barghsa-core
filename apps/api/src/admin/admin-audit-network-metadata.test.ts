import { expect, it, vi } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const operations = [
  [
    'setDeliveryWindowConfig',
    (c: AdminController, r: AuthenticatedRequest) => c.setDeliveryWindow({}, r),
  ],
  [
    'setDualApprovalThresholdConfig',
    (c: AdminController, r: AuthenticatedRequest) => c.setDualApprovalThreshold({}, r),
  ],
  [
    'setWalletTopUpLimitConfig',
    (c: AdminController, r: AuthenticatedRequest) => c.setWalletTopUpLimit({}, r),
  ],
  [
    'setGreenElectricityConfig',
    (c: AdminController, r: AuthenticatedRequest) => c.setGreenElectricityRules({}, r),
  ],
  [
    'setServiceResponseTargets',
    (c: AdminController, r: AuthenticatedRequest) => c.setServiceResponseTargets({}, r),
  ],
  [
    'setEscalationPolicy',
    (c: AdminController, r: AuthenticatedRequest) => c.setEscalationPolicy({}, r),
  ],
  ['createStaffTeam', (c: AdminController, r: AuthenticatedRequest) => c.createStaffTeam({}, r)],
  [
    'updateStaffTeam',
    (c: AdminController, r: AuthenticatedRequest) => c.updateStaffTeam('team', {}, r),
  ],
  [
    'deleteStaffTeam',
    (c: AdminController, r: AuthenticatedRequest) => c.deleteStaffTeam('team', r),
  ],
  [
    'setStaffAssignmentRules',
    (c: AdminController, r: AuthenticatedRequest) => c.setStaffAssignmentRules({}, r),
  ],
] as const;
for (const [method, invoke] of operations) {
  it.each([
    { ip: '192.0.2.1', socket: { remoteAddress: '192.0.2.2' }, expected: '192.0.2.1' },
    { socket: { remoteAddress: '192.0.2.2' }, expected: '192.0.2.2' },
    { socket: {}, expected: 'unknown' },
    { expected: 'unknown' },
  ])(
    `${method} retains current authority and ignores untrusted forwarded headers: %j`,
    async (sample) => {
      const call = vi.fn().mockResolvedValue({});
      const controller = new AdminController(
        { [method]: call } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );
      const session = {
        userId: 'admin',
        sessionId: 'current',
        csrfToken: 'current-csrf',
        isAdmin: true,
        permissions: [],
      };
      const req = {
        ...sample,
        session,
        headers: { 'x-forwarded-for': 'attacker-controlled' },
      } as unknown as AuthenticatedRequest;
      await invoke(controller, req);
      expect(call).toHaveBeenCalledTimes(1);
      const args = call.mock.calls[0]! as unknown[];
      expect(args).toContain(session);
      expect(args.at(-1)).toBe(sample.expected);
      expect(args).not.toContain('attacker-controlled');
    }
  );
}
