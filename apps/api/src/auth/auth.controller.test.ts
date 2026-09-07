import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const challengeId = '11111111-2222-4333-8444-555555555555';
const sessionResult = {
  userId: 'actor',
  sessionId: 'session',
  refreshToken: 'refresh',
  csrfToken: 'csrf',
  expiresAt: '2030-01-01T00:00:00.000Z',
  requiresOtp: false,
};
function request(extra: Record<string, unknown> = {}): AuthenticatedRequest {
  return {
    headers: {},
    session: { userId: 'actor', sessionId: 'session' },
    ...extra,
  } as AuthenticatedRequest;
}
function fixture() {
  const auth = {
    login: vi.fn().mockResolvedValue(sessionResult),
    completeLogin: vi.fn().mockResolvedValue(sessionResult),
    completeRegistration: vi.fn().mockResolvedValue(sessionResult),
    register: vi.fn(),
    forceChangePassword: vi.fn(),
    resetPassword: vi.fn(),
    activateStaff: vi.fn(),
    forgotPassword: vi.fn(),
    sendChangeUsernameOtp: vi.fn(),
    completeChangeUsername: vi.fn(),
    sendAddContactOtp: vi.fn(),
    completeAddContact: vi.fn(),
  };
  const otp = { resendChallenge: vi.fn().mockResolvedValue({ challengeId }) };
  const sessions = {
    revokeSession: vi.fn(),
    redeemRefreshToken: vi
      .fn()
      .mockResolvedValue({ sessionId: 'new-session', refreshToken: 'new-refresh' }),
    getSessionById: vi
      .fn()
      .mockResolvedValue({
        expires_at: sessionResult.expiresAt,
        csrf_token: 'new-csrf',
        user_id: 'actor',
      }),
    verifyUserPassword: vi.fn().mockResolvedValue(true),
    setStepUpVerifiedTimestamp: vi.fn(),
  };
  const cookies = { cookie: vi.fn(), clearCookie: vi.fn() };
  return {
    auth,
    otp,
    sessions,
    cookies,
    res: cookies as unknown as Response,
    controller: new AuthController(auth as never, otp as never, sessions as never),
  };
}
afterEach(() => vi.unstubAllEnvs());

describe('authentication cookies and device possession', () => {
  it.each(['production', 'test'])('sets scoped session cookies in %s', async (env) => {
    vi.stubEnv('NODE_ENV', env);
    const { controller, auth, cookies, res } = fixture();
    const deviceName = env === 'production' ? '__Host-barghsa_device' : 'barghsa_device';
    const device = 'a'.repeat(64);
    const req = request({
      cookies: { [deviceName]: device },
      ip: '192.0.2.1',
      headers: { 'user-agent': 'actual agent' },
    });
    await controller.login(
      {
        username: ' USER@EXAMPLE.COM ',
        password: 'secret',
        deviceInfo: { fingerprint: 'forged', userAgent: 'forged' },
      },
      req,
      res
    );
    expect(auth.login).toHaveBeenCalledWith(
      {
        username: 'user@example.com',
        password: 'secret',
        deviceInfo: { fingerprint: device, userAgent: 'actual agent' },
      },
      '192.0.2.1'
    );
    expect(cookies.cookie).toHaveBeenCalledTimes(3);
    expect(cookies.cookie).toHaveBeenCalledWith(
      'barghsa_session',
      'session',
      expect.objectContaining({
        httpOnly: true,
        secure: env === 'production',
        sameSite: 'lax',
        path: '/',
      })
    );
    expect(cookies.cookie).toHaveBeenCalledWith(
      'barghsa_refresh',
      'refresh',
      expect.objectContaining({
        httpOnly: true,
        secure: env === 'production',
        path: '/api/auth/refresh',
      })
    );
    expect(cookies.cookie).toHaveBeenCalledWith(
      'barghsa_csrf',
      'csrf',
      expect.objectContaining({ httpOnly: false, secure: env === 'production', sameSite: 'strict' })
    );
  });
  it.each([
    { requiresOtp: true, challengeId },
    { requiresOtp: false, mustChangePassword: true, passwordChangeToken: 'change-token' },
  ])('never establishes a session before completing required challenge %j', async (result) => {
    const { controller, auth, cookies, res } = fixture();
    auth.login.mockResolvedValue(result as never);
    expect(
      await controller.login({ username: '09123456789', password: 'secret' }, request(), res)
    ).toEqual(result);
    expect(auth.login).toHaveBeenCalledWith(
      expect.objectContaining({ username: '+989123456789' }),
      'unknown'
    );
    expect(cookies.cookie).toHaveBeenCalledTimes(1);
    expect(cookies.cookie.mock.calls[0]![0]).toBe('barghsa_device');
  });
  it.each([false, true])(
    'binds trusted login to device possession only when opted in: %s',
    async (trustDevice) => {
      const { controller, auth, res, cookies } = fixture();
      const token = 'b'.repeat(64);
      await controller.verifyLoginOtp(
        { challengeId, otp: '123456', trustDevice },
        request({ cookies: { barghsa_device: token }, socket: { remoteAddress: '192.0.2.2' } }),
        res
      );
      expect(auth.completeLogin).toHaveBeenCalledWith(
        challengeId,
        '123456',
        '192.0.2.2',
        trustDevice,
        trustDevice ? createHash('sha256').update(token).digest('hex') : undefined,
        ''
      );
      expect(cookies.cookie).toHaveBeenCalledTimes(3);
    }
  );
  it('does not set session cookies when credential verification fails', async () => {
    const { controller, auth, cookies, res } = fixture();
    const failure = new Error('credential rejection');
    auth.login.mockRejectedValue(failure);
    await expect(
      controller.login({ username: 'user@example.com', password: 'secret' }, request(), res)
    ).rejects.toBe(failure);
    expect(cookies.cookie.mock.calls.map(([name]) => name)).toEqual(['barghsa_device']);
  });
});

describe('refresh and logout boundaries', () => {
  it.each([undefined, null, '', 123, ['token'], {}])(
    'rejects non-token refresh cookie %j before redemption',
    async (token) => {
      const { controller, sessions, cookies, res } = fixture();
      await expect(
        controller.refresh(request({ cookies: { barghsa_refresh: token } }), res)
      ).rejects.toMatchObject({ status: 401 });
      expect(sessions.redeemRefreshToken).not.toHaveBeenCalled();
      expect(cookies.cookie).not.toHaveBeenCalled();
    }
  );
  it('does not establish cookies when the rotated session no longer exists', async () => {
    const { controller, sessions, cookies, res } = fixture();
    sessions.getSessionById.mockResolvedValue(null as never);
    await expect(
      controller.refresh(request({ cookies: { barghsa_refresh: 'old' } }), res)
    ).rejects.toMatchObject({ status: 401 });
    expect(cookies.cookie).not.toHaveBeenCalled();
  });
  it('propagates replay rejection without writing replacement cookies', async () => {
    const { controller, sessions, cookies, res } = fixture();
    const failure = new Error('refresh replay');
    sessions.redeemRefreshToken.mockRejectedValue(failure);
    await expect(
      controller.refresh(request({ cookies: { barghsa_refresh: 'replayed' } }), res)
    ).rejects.toBe(failure);
    expect(sessions.getSessionById).not.toHaveBeenCalled();
    expect(cookies.cookie).not.toHaveBeenCalled();
  });
  it('returns the rotated CSRF token and replaces both credentials', async () => {
    const { controller, sessions, cookies, res } = fixture();
    expect(await controller.refresh(request({ cookies: { barghsa_refresh: 'old' } }), res)).toEqual(
      { sessionId: 'new-session', csrfToken: 'new-csrf', expiresAt: sessionResult.expiresAt }
    );
    expect(sessions.redeemRefreshToken).toHaveBeenCalledWith('old');
    expect(sessions.getSessionById).toHaveBeenCalledWith('new-session');
    expect(cookies.cookie.mock.calls.map(([name, value]) => [name, value])).toEqual([
      ['barghsa_session', 'new-session'],
      ['barghsa_refresh', 'new-refresh'],
      ['barghsa_csrf', 'new-csrf'],
    ]);
  });
  it.each([undefined, '', 123, 'valid-session'])(
    'clears cookies at matching scopes on logout: %j',
    async (session) => {
      const { controller, sessions, cookies, res } = fixture();
      vi.stubEnv('NODE_ENV', 'production');
      await controller.logout(request({ cookies: { barghsa_session: session } }), res);
      expect(sessions.revokeSession.mock.calls).toEqual(
        session === 'valid-session' ? [['valid-session']] : []
      );
      expect(cookies.clearCookie).toHaveBeenCalledTimes(3);
      expect(cookies.clearCookie).toHaveBeenCalledWith(
        'barghsa_refresh',
        expect.objectContaining({ path: '/api/auth/refresh', httpOnly: true, secure: true })
      );
      expect(cookies.clearCookie).toHaveBeenCalledWith(
        'barghsa_session',
        expect.objectContaining({ path: '/', httpOnly: true, secure: true })
      );
      expect(cookies.clearCookie).toHaveBeenCalledWith(
        'barghsa_csrf',
        expect.objectContaining({ path: '/', httpOnly: false, secure: true })
      );
    }
  );
});

describe('authentication input and step-up failures', () => {
  const invalidOperations = [
    'register',
    'verifyLoginOtp',
    'resendLoginOtp',
    'forceChangePassword',
    'activateStaff',
    'resetPassword',
    'verifyOtp',
    'resendOtp',
    'stepUp',
    'sendChangeUsernameOtp',
    'changeUsername',
    'sendAddContactOtp',
    'addContact',
  ] as const;
  it.each(invalidOperations)('%s rejects invalid input before any mutation', async (method) => {
    const { controller, auth, otp, sessions, cookies, res } = fixture();
    await expect(controller[method](null, request(), res)).rejects.toMatchObject({ status: 400 });
    for (const call of [...Object.values(auth), ...Object.values(otp), ...Object.values(sessions)])
      expect(call).not.toHaveBeenCalled();
    expect(cookies.cookie).not.toHaveBeenCalled();
  });
  it('keeps malformed login errors generic and does not create a device', async () => {
    const { controller, cookies, res, auth } = fixture();
    await expect(
      controller.login({ username: 'bad', password: '' }, request(), res)
    ).rejects.toMatchObject({ status: 401 });
    expect(auth.login).not.toHaveBeenCalled();
    expect(cookies.cookie).not.toHaveBeenCalled();
  });
  it('keeps malformed forgot-password responses generic without sending a challenge', async () => {
    const { controller, auth } = fixture();
    const a = await controller.forgotPassword(null, request());
    const b = await controller.forgotPassword({ username: 'invalid' }, request());
    expect(a.sent).toBe(true);
    expect(b.message).toBe(a.message);
    expect(a.challengeId).not.toBe(b.challengeId);
    expect(auth.forgotPassword).not.toHaveBeenCalled();
  });
  it.each([false, true])('only records step-up after a valid password: %s', async (valid) => {
    const { controller, sessions } = fixture();
    sessions.verifyUserPassword.mockResolvedValue(valid);
    const result = controller.stepUp({ password: 'secret' }, request());
    if (valid) {
      await expect(result).resolves.toHaveProperty('stepUpVerifiedAt');
      expect(sessions.setStepUpVerifiedTimestamp).toHaveBeenCalledWith('session');
    } else {
      await expect(result).rejects.toMatchObject({ status: 422 });
      expect(sessions.setStepUpVerifiedTimestamp).not.toHaveBeenCalled();
    }
    expect(sessions.verifyUserPassword).toHaveBeenCalledWith('actor', 'secret');
  });
  it.each([
    { operation: 'resendOtp' as const, purpose: 'registration' },
    { operation: 'resendLoginOtp' as const, purpose: 'login' },
  ])('binds resend to $purpose rather than a caller purpose', async ({ operation, purpose }) => {
    const { controller, otp } = fixture();
    await controller[operation]({ challengeId, purpose: 'password_reset' }, request());
    expect(otp.resendChallenge).toHaveBeenCalledWith(challengeId, 'unknown', purpose);
  });
});
