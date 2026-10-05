import { expect, it } from 'vitest';
import {
  securitySessions,
  securityTrustedDevices,
  securityReceipt,
  securityStepUpReceipt,
  securityOperationAvailable,
  securityOperationConfirmed,
} from './security-settings-form.js';
const session = {
  sessionId: 'opaque/session',
  deviceInfo: { ip: '192.0.2.1', userAgent: 'Windows', fingerprint: 'private' },
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  idleDeadline: '2030-01-01T00:00:00Z',
  isCurrentSession: true,
  location: { countryCode: '<invalid>' },
  private: true,
};
const device = {
  id: 'trust',
  userAgent: null,
  ip: null,
  trustedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  isCurrentDevice: true,
};
it('projects actual session rows, tolerates display-only locations and rejects ambiguous authority', () => {
  const rows = securitySessions([session])!;
  expect(rows[0]!.location).toBeNull();
  expect(rows[0]).not.toHaveProperty('private');
  expect(rows[0]!.deviceInfo).not.toHaveProperty('fingerprint');
  expect(securitySessions([session, session])).toBeNull();
  expect(securitySessions([session, { ...session, sessionId: 'second' }])).toBeNull();
  expect(securitySessions([{ ...session, idleDeadline: 'invalid' }])).toBeNull();
});
it('validates complete trust rows without rejecting current-device removal', () => {
  expect(securityTrustedDevices([device])).toEqual([device]);
  expect(securityTrustedDevices([device, device])).toBeNull();
  expect(securityTrustedDevices([{ ...device, expiresAt: device.trustedAt }])).toBeNull();
  expect(
    securityOperationAvailable({ kind: 'trust', target: device }, securitySessions([session])!, [
      device,
    ])
  ).toBe(true);
});
it('accepts only actual controller receipts and bounded revoke-all counts', () => {
  expect(securityReceipt('session', { message: 'Session revoked.' })).toBe(true);
  expect(securityReceipt('session', { message: 'private error' })).toBe(false);
  expect(securityReceipt('trust', { revoked: false })).toBe(false);
  expect(securityReceipt('trust', { revoked: true })).toBe(true);
  expect(
    securityReceipt('others', { message: 'All 2 other session(s) revoked.', revokedCount: 2 })
  ).toBe(true);
  expect(
    securityReceipt('others', { message: 'No other sessions to revoke.', revokedCount: 0 })
  ).toBe(true);
  expect(
    securityReceipt('others', { message: 'All 2 other session(s) revoked.', revokedCount: -2 })
  ).toBe(false);
  expect(
    securityStepUpReceipt({
      message: 'Step-up authentication successful.',
      stepUpVerifiedAt: 'invalid',
    })
  ).toBe(false);
});
it('requires exactly one authenticated current session before proving removal', () => {
  const rows = securitySessions([session])!;
  expect(securityOperationConfirmed({ kind: 'others' }, rows, [])).toBe(true);
  expect(securityOperationConfirmed({ kind: 'others' }, [], [])).toBe(false);
  expect(securityOperationAvailable({ kind: 'session', target: rows[0]! }, rows, [])).toBe(false);
});
