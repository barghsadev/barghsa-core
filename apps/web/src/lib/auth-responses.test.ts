import { describe, expect, it } from 'vitest';
import {
  hasSessionAcknowledgement,
  hasPasswordChangeAcknowledgement,
  hasResendAcknowledgement,
  parseLoginAcknowledgement,
} from './auth-responses.js';

const session = {
  requiresOtp: false,
  userId: 'user',
  sessionId: 'session',
  csrfToken: 'csrf',
  expiresAt: '2030-01-01T00:00:00.000Z',
};
describe('authentication acknowledgement contract', () => {
  it('requires password-change confirmation and an exact resend challenge', () => {
    expect(hasPasswordChangeAcknowledgement({ message: 'Password changed' })).toBe(true);
    expect(hasResendAcknowledgement({ challengeId: 'challenge' }, 'challenge')).toBe(true);
    for (const value of [null, undefined, {}, [], 200, { message: '' }, { message: 1 }]) {
      expect(hasPasswordChangeAcknowledgement(value)).toBe(false);
      expect(hasResendAcknowledgement(value, 'challenge')).toBe(false);
    }
    expect(hasResendAcknowledgement({ challengeId: 'other' }, 'challenge')).toBe(false);
    expect(hasResendAcknowledgement({ challengeId: '' }, '')).toBe(false);
  });
  it.each([null, undefined, false, 1, 'ok', [], {}, { requiresOtp: false }])(
    'rejects incomplete response %j',
    (body) => {
      expect(parseLoginAcknowledgement(body)).toBeNull();
      expect(hasSessionAcknowledgement(body)).toBe(false);
    }
  );
  it.each(['userId', 'sessionId', 'csrfToken', 'expiresAt'])(
    'requires a nonempty %s before session success',
    (key) => {
      for (const value of [undefined, null, 1, {}, '', ' ']) {
        expect(hasSessionAcknowledgement({ ...session, [key]: value })).toBe(false);
        expect(parseLoginAcknowledgement({ ...session, [key]: value })).toBeNull();
      }
    }
  );
  it('requires a valid expiry and an explicit direct-login discriminator', () => {
    expect(parseLoginAcknowledgement({ ...session, expiresAt: 'not-a-date' })).toBeNull();
    expect(parseLoginAcknowledgement({ ...session, requiresOtp: 'false' })).toBeNull();
    expect(parseLoginAcknowledgement({ ...session, mustChangePassword: 'false' })).toBeNull();
    expect(parseLoginAcknowledgement(session)).toEqual({ kind: 'session' });
    expect(hasSessionAcknowledgement(session)).toBe(true);
  });
  it('only enters a challenge with a typed identifier and consistent flags', () => {
    expect(parseLoginAcknowledgement({ requiresOtp: true, challengeId: 'challenge' })).toEqual({
      kind: 'otp',
      challengeId: 'challenge',
    });
    expect(
      parseLoginAcknowledgement({
        requiresOtp: false,
        mustChangePassword: true,
        passwordChangeToken: 'token',
      })
    ).toEqual({ kind: 'password-change', token: 'token' });
    for (const value of [null, undefined, 1, {}, '', ' ']) {
      expect(parseLoginAcknowledgement({ requiresOtp: true, challengeId: value })).toBeNull();
      expect(
        parseLoginAcknowledgement({
          requiresOtp: false,
          mustChangePassword: true,
          passwordChangeToken: value,
        })
      ).toBeNull();
    }
    expect(
      parseLoginAcknowledgement({
        requiresOtp: true,
        mustChangePassword: true,
        passwordChangeToken: 'token',
        challengeId: 'challenge',
      })
    ).toBeNull();
  });
});
