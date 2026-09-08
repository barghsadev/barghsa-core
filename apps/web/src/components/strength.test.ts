import { describe, it, expect } from 'vitest';
import { evaluateStrength } from '../lib/password-strength.js';

describe('production password strength estimator', () => {
  it('starts empty at zero', () => {
    expect(evaluateStrength('')).toEqual({ score: 0, level: 'weak' });
  });

  it.each([
    'Password123!',
    'Qwerty123!',
    'P@ssw0rd',
    'Abc123Abc123',
    'A'.repeat(100),
    '1234567890',
  ])('recognizes predictable patterns in %s', (password) => {
    expect(evaluateStrength(password).level).toBe('weak');
  });

  it('recognizes a long unpredictable password', () => {
    expect(evaluateStrength('kV9!zmQ2#xrD7@pL4')).toEqual({ score: 100, level: 'strong' });
  });

  it('scores a long passphrase without requiring symbol substitution', () => {
    expect(evaluateStrength('orbit meadow canvas lantern').level).toBe('strong');
  });

  it('bounds long-input work without treating repetition as strength', () => {
    expect(evaluateStrength('A'.repeat(10000)).level).toBe('weak');
  });
});
