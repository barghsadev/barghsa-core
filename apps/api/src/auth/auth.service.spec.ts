import { describe, it, expect } from 'vitest';
import { RegisterSchema } from './dto/register.dto.js';
import { LoginSchema, LoginVerifySchema, LoginResendSchema } from './dto/login.dto.js';

describe('RegisterSchema', () => {
  describe('username validation', () => {
    it('accepts a valid email', () => {
      const result = RegisterSchema.safeParse({
        username: 'user@example.com',
        password: 'StrongPass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.username).toBe('user@example.com');
      }
    });

    it('normalizes Iranian mobile to E.164', () => {
      const result = RegisterSchema.safeParse({
        username: '09121234567',
        password: 'StrongPass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.username).toBe('+989121234567');
      }
    });

    it('accepts international E.164 number', () => {
      const result = RegisterSchema.safeParse({
        username: '+447911123456',
        password: 'StrongPass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.username).toBe('+447911123456');
      }
    });

    it('rejects bare digits without +', () => {
      const result = RegisterSchema.safeParse({
        username: '9121234567',
        password: 'StrongPass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty username', () => {
      const result = RegisterSchema.safeParse({
        username: '',
        password: 'StrongPass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(false);
    });

    it('rejects malformed email', () => {
      const result = RegisterSchema.safeParse({
        username: 'not-an-email',
        password: 'StrongPass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('password validation', () => {
    it('accepts a strong password meeting all requirements', () => {
      const result = RegisterSchema.safeParse({
        username: 'user@example.com',
        password: 'StrongPass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(true);
    });

    it('rejects password shorter than 8 chars', () => {
      const result = RegisterSchema.safeParse({
        username: 'user@example.com',
        password: 'Sh1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(false);
    });

    it('rejects password missing uppercase', () => {
      const result = RegisterSchema.safeParse({
        username: 'user@example.com',
        password: 'weakpass1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(false);
    });

    it('rejects password missing lowercase', () => {
      const result = RegisterSchema.safeParse({
        username: 'user@example.com',
        password: 'WEAKPASS1',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(false);
    });

    it('rejects password missing digit', () => {
      const result = RegisterSchema.safeParse({
        username: 'user@example.com',
        password: 'WeakPass',
        tosVersionId: 'current',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('tosVersionId validation', () => {
    it('rejects empty tosVersionId', () => {
      const result = RegisterSchema.safeParse({
        username: 'user@example.com',
        password: 'StrongPass1',
        tosVersionId: '',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('LoginSchema', () => {
  describe('username validation', () => {
    it('accepts a valid email', () => {
      const result = LoginSchema.safeParse({
        username: 'user@example.com',
        password: 'anypassword',
      });
      expect(result.success).toBe(true);
    });

    it('normalizes Iranian mobile to E.164', () => {
      const result = LoginSchema.safeParse({
        username: '09121234567',
        password: 'anypassword',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.username).toBe('+989121234567');
      }
    });

    it('accepts international E.164 number', () => {
      const result = LoginSchema.safeParse({
        username: '+447911123456',
        password: 'anypassword',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty username', () => {
      const result = LoginSchema.safeParse({
        username: '',
        password: 'anypassword',
      });
      expect(result.success).toBe(false);
    });

    it('rejects malformed input', () => {
      const result = LoginSchema.safeParse({
        username: 'not-email-or-phone',
        password: 'anypassword',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('password validation', () => {
    it('accepts any non-empty password (strength checked at registration)', () => {
      const result = LoginSchema.safeParse({
        username: 'user@example.com',
        password: 'any',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty password', () => {
      const result = LoginSchema.safeParse({
        username: 'user@example.com',
        password: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('deviceInfo (optional)', () => {
    it('accepts login without deviceInfo', () => {
      const result = LoginSchema.safeParse({
        username: 'user@example.com',
        password: 'anypassword',
      });
      expect(result.success).toBe(true);
    });

    it('accepts login with deviceInfo', () => {
      const result = LoginSchema.safeParse({
        username: 'user@example.com',
        password: 'anypassword',
        deviceInfo: { userAgent: 'Mozilla/5.0', fingerprint: 'abc123' },
      });
      expect(result.success).toBe(true);
    });
  });
});

// ── Login Verify Schema ──────────────────────────────────────────────────

describe('LoginVerifySchema', () => {
  it('accepts valid login verify input', () => {
    const result = LoginVerifySchema.safeParse({
      challengeId: '00000000-0000-0000-0000-000000000000',
      otp: '123456',
      trustDevice: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts login verify without trustDevice (default false)', () => {
    const result = LoginVerifySchema.safeParse({
      challengeId: '00000000-0000-0000-0000-000000000000',
      otp: '123456',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trustDevice).toBe(false);
    }
  });

  it('rejects non-numeric OTP', () => {
    const result = LoginVerifySchema.safeParse({
      challengeId: '00000000-0000-0000-0000-000000000000',
      otp: 'abcdef',
    });
    expect(result.success).toBe(false);
  });

  it('rejects OTP not of length 6', () => {
    const result = LoginVerifySchema.safeParse({
      challengeId: '00000000-0000-0000-0000-000000000000',
      otp: '12345',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID challengeId', () => {
    const result = LoginVerifySchema.safeParse({
      challengeId: 'not-a-uuid',
      otp: '123456',
    });
    expect(result.success).toBe(false);
  });
});

// ── Login Resend Schema ──────────────────────────────────────────────────

describe('LoginResendSchema', () => {
  it('accepts valid resend input', () => {
    const result = LoginResendSchema.safeParse({
      challengeId: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID challengeId', () => {
    const result = LoginResendSchema.safeParse({
      challengeId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});
