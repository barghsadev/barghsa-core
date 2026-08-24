import { describe, it, expect } from 'vitest';
import { RegisterSchema } from './dto/register.dto.js';

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