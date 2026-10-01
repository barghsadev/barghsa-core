import { expect, it } from 'vitest';
import { auditChanges, parseAuditCursor } from './config-audit.controller.js';
it('does not invent values for malformed or absent legacy fields', () => {
  expect(
    auditChanges('otp', null, { ttlSeconds: { secret: 'hidden' }, password: 'hidden' })
  ).toEqual({ changes: [], detailsAvailable: false });
  expect(
    auditChanges('service-response-targets', { ticket: 24 }, { ticket: null, verification_case: 6 })
  ).toEqual({
    detailsAvailable: true,
    changes: [
      {
        field: 'ticket',
        previous: { recorded: true, value: 24 },
        current: { recorded: true, value: null },
      },
      {
        field: 'verification_case',
        previous: { recorded: false, value: null },
        current: { recorded: true, value: 6 },
      },
    ],
  });
  expect(
    auditChanges('branding', { appTitle: 'Same' }, { appTitle: 'Same', token: 'secret' })
  ).toEqual({ changes: [], detailsAvailable: true });
});
it.each([
  null,
  [],
  {},
  'a'.repeat(513),
  Buffer.from(JSON.stringify({ scope: 'branding', at: 'invalid', id: 'invalid' })).toString(
    'base64url'
  ),
  Buffer.from(
    JSON.stringify({
      scope: 'otp',
      at: '2026-02-31T12:00:00.000001Z',
      id: '01900000-0000-7000-8000-000000000001',
    })
  ).toString('base64url'),
])('rejects malformed cursor %j', (raw) => {
  expect(() => parseAuditCursor(raw, 'otp')).toThrow();
});
