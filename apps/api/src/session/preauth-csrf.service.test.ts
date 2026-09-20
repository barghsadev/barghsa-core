import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { PreauthCsrfService } from './preauth-csrf.service.js';
import type { RateLimitService } from '../rate-limit/rate-limit.service.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ query }) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each(['production', 'test'])(
  'uses the correct cookie boundary and only stores its hash in %s',
  async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const cookie = vi.fn(),
      clearCookie = vi.fn();
    const response = { cookie, clearCookie } as unknown as Response;
    const service = new PreauthCsrfService({
      enforceSecurityRateLimit: vi.fn(),
    } as unknown as RateLimitService);
    const result = await service.issue({ cookies: {}, ip: '127.0.0.1' } as Request, response);
    const [name, id, options] = cookie.mock.calls[0]!;
    expect(name).toBe(environment === 'production' ? '__Host-barghsa_preauth' : 'barghsa_preauth');
    expect(options).toEqual({
      secure: environment === 'production',
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 1800000,
    });
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(result.csrfToken).not.toBe(id);
    const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))!;
    expect(insert[1]).toEqual([createHash('sha256').update(id).digest('hex'), result.csrfToken]);
    expect(
      await service.consume({ cookies: { [name]: id } } as Request, response, result.csrfToken)
    ).toBe(true);
    expect(clearCookie).toHaveBeenCalledWith(name, {
      secure: environment === 'production',
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
  }
);
