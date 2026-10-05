import { expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const request = (isAdmin: boolean) =>
  ({
    session: { isAdmin, userId: 'actor', sessionId: 'session', csrfToken: 'csrf' },
    ip: '127.0.0.1',
  }) as unknown as AuthenticatedRequest;
function fixture() {
  const service = { createStaffUser: vi.fn(), updateStaffRoles: vi.fn() };
  return {
    service,
    controller: new AdminController(
      service as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    ),
  };
}
it('creation reports only public field names and never submitted values', async () => {
  const { controller, service } = fixture();
  const error = await controller
    .createStaffUser(
      {
        username: 'staff@example.test',
        firstName: '',
        lastName: 'secret'.repeat(30),
        roleIds: [null],
        activationMethod: 'private-input',
      },
      request(true)
    )
    .catch((error: unknown) => error);
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual([
    'firstName',
    'lastName',
    'roleIds',
    'activationMethod',
  ]);
  expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('secret');
  expect(service.createStaffUser).not.toHaveBeenCalled();
});
it('role edits report their public controls without executing a command', async () => {
  const { controller, service } = fixture();
  const error = await controller
    .updateStaffRoles('target', { roleIds: [null], reason: 's'.repeat(501) }, request(true))
    .catch((error: unknown) => error);
  expect((error as InputFieldException).fields).toEqual(['roleIds', 'reason']);
  expect(service.updateStaffRoles).not.toHaveBeenCalled();
});
it('authorization precedes field feedback for both staff mutations', async () => {
  const { controller, service } = fixture();
  for (const command of [
    () => controller.createStaffUser({}, request(false)),
    () => controller.updateStaffRoles('target', {}, request(false)),
  ]) {
    const error = await command().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(HttpException);
    expect(error).not.toBeInstanceOf(InputFieldException);
    expect((error as HttpException).getStatus()).toBe(403);
  }
  expect(service.createStaffUser).not.toHaveBeenCalled();
  expect(service.updateStaffRoles).not.toHaveBeenCalled();
});
it('the existing invalid-username error remains compatible', async () => {
  const { controller } = fixture();
  const error = await controller
    .createStaffUser(
      { username: 'bad', firstName: 'Name', lastName: 'Staff', activationMethod: 'tempPassword' },
      request(true)
    )
    .catch((error: unknown) => error);
  expect((error as HttpException).getResponse()).toEqual({
    statusCode: 400,
    error: 'AUTH:REGISTER:INVALID_USERNAME',
  });
});
