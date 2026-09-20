import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { getDbPool } from '@barghsa/db';
import { rateLimitKey } from '@barghsa/shared/rate-limit';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';

const LIFETIME_MS = 30 * 60_000;
const TOKEN = /^[a-f0-9]{64}$/;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  };
}

export function preauthCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-barghsa_preauth' : 'barghsa_preauth';
}

function readIdHash(request: Request): string | null {
  const id = request.cookies?.[preauthCookieName()];
  return typeof id === 'string' && TOKEN.test(id)
    ? createHash('sha256').update(id).digest('hex')
    : null;
}

@Injectable()
export class PreauthCsrfService {
  constructor(@Inject(RateLimitService) private readonly limits: RateLimitService) {}

  async issue(request: Request, response: Response): Promise<{ csrfToken: string }> {
    const pool = getDbPool();
    const idHash = readIdHash(request);
    if (idHash) {
      const existing = await pool.query<{ csrf_token: string }>(
        'SELECT csrf_token FROM preauth_sessions WHERE id_hash=$1 AND expires_at>clock_timestamp()',
        [idHash]
      );
      if (existing.rows[0]) return { csrfToken: existing.rows[0].csrf_token };
    }
    await this.limits.enforceSecurityRateLimit(
      rateLimitKey('preauth:ip', request.ip ?? 'unknown'),
      60,
      60_000
    );
    // Bounded cleanup on issuance needs no process-local state or additional worker.
    await pool.query(
      `DELETE FROM preauth_sessions WHERE id_hash IN
       (SELECT id_hash FROM preauth_sessions WHERE expires_at<=clock_timestamp()
        ORDER BY expires_at LIMIT 1000)`
    );
    const id = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO preauth_sessions(id_hash,csrf_token,expires_at)
       VALUES ($1,$2,clock_timestamp()+INTERVAL '30 minutes')`,
      [createHash('sha256').update(id).digest('hex'), csrfToken]
    );
    response.cookie(preauthCookieName(), id, { ...cookieOptions(), maxAge: LIFETIME_MS });
    return { csrfToken };
  }

  /** Consume before calling auth code, so no anonymous credential survives authentication. */
  async consume(request: Request, response: Response, token: string): Promise<boolean> {
    const idHash = readIdHash(request);
    if (!idHash || !TOKEN.test(token)) return false;
    const result = await getDbPool().query(
      `DELETE FROM preauth_sessions WHERE id_hash=$1 AND csrf_token=$2
       AND expires_at>clock_timestamp() RETURNING id_hash`,
      [idHash, token]
    );
    if (!result.rowCount) return false;
    response.clearCookie(preauthCookieName(), cookieOptions());
    return true;
  }
}
