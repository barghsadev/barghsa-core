import { expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { assertServiceSettingsFields } from './service-settings-fields.js';
import { InputFieldException } from '../common/input-field.exception.js';

it('only exposes owned hour field identifiers for both setting families', () => {
  for (const [kind, body, fields] of [
    [
      'targets',
      { ticket: 'PRIVATE VALUE', verification_case: 8761 },
      ['ticketHours', 'verificationCaseHours'],
    ],
    [
      'escalation',
      { ticket: { level2: { delayHours: 'PRIVATE VALUE' }, level3: { delayHours: 0 } } },
      ['ticketLevel2Hours', 'ticketLevel3Hours'],
    ],
  ] as const) {
    let error: unknown;
    try {
      assertServiceSettingsFields(body, kind);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InputFieldException);
    expect((error as InputFieldException).fields).toEqual(fields);
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('PRIVATE');
  }
});
it('preserves optional and disabled writes and rejects unknown types without reflecting names', () => {
  for (const kind of ['targets', 'escalation'] as const) {
    expect(() => assertServiceSettingsFields({}, kind)).not.toThrow();
    expect(() => assertServiceSettingsFields({ ticket: null }, kind)).not.toThrow();
    let error: unknown;
    try {
      assertServiceSettingsFields({ 'PRIVATE KEY': 42 }, kind);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('PRIVATE');
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
});
it('enforces permission before validating either settings body', async () => {
  const controller = new AdminController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  const request = { session: { isAdmin: false, permissions: [] } } as never;
  for (const call of [
    () => controller.setServiceResponseTargets({ 'PRIVATE KEY': 0 }, request),
    () => controller.setEscalationPolicy({ 'PRIVATE KEY': 0 }, request),
  ])
    await expect(call()).rejects.toMatchObject({ status: 403 });
});

it('keeps mixed or malformed policy errors general instead of pointing only to an hour field', () => {
  for (const value of [
    { ticket: { level2: { delayHours: 0, channels: ['email'] }, level3: { delayHours: null } } },
    { ticket: { level2: { delayHours: 0 }, level3: 42 } },
  ]) {
    let error: unknown;
    try {
      assertServiceSettingsFields(value, 'escalation');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
});
