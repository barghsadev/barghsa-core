import { expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { InputFieldException } from '../common/input-field.exception.js';
import { assertStaffTeamFields, assertStaffRoutingFields } from './staff-team-fields.js';
import { AdminController } from './admin.controller.js';

it('exposes only owned fields and never submitted values', () => {
  let caught: unknown;
  try {
    assertStaffTeamFields({
      name: '',
      skillTags: ['PRIVATE', 'PRIVATE'],
      memberUserIds: ['PRIVATE', 'PRIVATE'],
      leadUserId: 'OUTSIDE',
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InputFieldException);
  expect((caught as InputFieldException).fields).toEqual(['name', 'tags', 'members', 'leadUserId']);
  expect(JSON.stringify((caught as HttpException).getResponse())).not.toMatch(/PRIVATE|OUTSIDE/);
});
it('preserves optional create fields and partial updates, including a retained member as lead', () => {
  for (const body of [
    { name: 'Support' },
    { name: 'Support', description: null },
    { name: 'Support', memberUserIds: ['staff'], leadUserId: 'staff' },
  ])
    expect(() => assertStaffTeamFields(body)).not.toThrow();
  for (const body of [{}, { description: null }, { leadUserId: 'retained-member' }])
    expect(() => assertStaffTeamFields(body, true)).not.toThrow();
  expect(() =>
    assertStaffTeamFields({ memberUserIds: [], leadUserId: 'retained-member' }, true)
  ).toThrow(InputFieldException);
});
it.each([null, [], { 'PRIVATE KEY': 'PRIVATE VALUE' }])(
  'rejects unknown team shapes without reflecting input (%j)',
  (body) => {
    let caught: unknown;
    try {
      assertStaffTeamFields(body);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught).not.toBeInstanceOf(InputFieldException);
    expect(JSON.stringify((caught as HttpException).getResponse())).not.toContain('PRIVATE');
  }
);
it('keeps manual defaults and maps invalid priorities to their own rule group', () => {
  expect(() => assertStaffRoutingFields({})).not.toThrow();
  expect(() => assertStaffRoutingFields({ ticket: null })).not.toThrow();
  let caught: unknown;
  try {
    assertStaffRoutingFields({
      ticket: { strategy: 'PRIVATE' },
      verification_case: [],
      consultation: { strategy: 'PRIVATE' },
    });
  } catch (error) {
    caught = error;
  }
  expect((caught as InputFieldException).fields).toEqual([
    'ticketRule',
    'verificationCaseRule',
    'consultationRule',
  ]);
  expect(JSON.stringify((caught as HttpException).getResponse())).not.toContain('PRIVATE');
  expect(() => assertStaffRoutingFields({ PRIVATE: {} })).toThrow(HttpException);
});
it('checks mutation permission before inspecting every owned form body', async () => {
  const controller = new AdminController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  const request = { session: { isAdmin: false, permissions: [] } } as never;
  for (const call of [
    () => controller.createStaffTeam(null, request),
    () => controller.updateStaffTeam('id', [], request),
    () => controller.setStaffAssignmentRules({ PRIVATE: {} }, request),
  ])
    await expect(call()).rejects.toMatchObject({ status: 403 });
});
