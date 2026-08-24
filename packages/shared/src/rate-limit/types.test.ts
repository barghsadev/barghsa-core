import { describe, it, expect } from 'vitest';
import { RateLimitNamespace, rateLimitKey } from './types.js';

describe('rate-limit types and helpers', () => {
  describe('rateLimitKey', () => {
    it('joins namespace and identifiers with colons', () => {
      expect(rateLimitKey('api', '192.168.1.1')).toBe('api:192.168.1.1');
    });

    it('accepts multiple identifiers', () => {
      expect(rateLimitKey('otp', '+989123456789', 'login')).toBe(
        'otp:+989123456789:login',
      );
    });

    it('accepts numeric identifiers', () => {
      expect(rateLimitKey('user_action', 'usr_abc', 42)).toBe(
        'user_action:usr_abc:42',
      );
    });
  });

  describe('RateLimitNamespace', () => {
    it('defines all expected namespaces', () => {
      expect(RateLimitNamespace.API).toBe('api');
      expect(RateLimitNamespace.ENDPOINT).toBe('endpoint');
      expect(RateLimitNamespace.LOGIN).toBe('login');
      expect(RateLimitNamespace.OTP).toBe('otp');
      expect(RateLimitNamespace.PASSWORD_RESET).toBe('password_reset');
      expect(RateLimitNamespace.USER_ACTION).toBe('user_action');
    });
  });
});