import { fetchWithPreauth } from '../test/public-auth.js';
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { t } from '@barghsa/i18n';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>> | undefined;
afterEach(async () => {
  await http?.close();
}, 15000);
async function post(username: string, ip: string, locale: 'en' | 'fa' = 'en') {
  return fetchWithPreauth(`${http!.base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      'Accept-Language': locale,
    },
    body: JSON.stringify({ username }),
  });
}
for (const trusted of [false, true]) {
  it(`uses forwarded clients only with explicit proxy trust (${trusted})`, async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
    http = await startHttpFixture(
      process.env.TEST_DATABASE_URL,
      undefined,
      trusted ? '127.0.0.1' : ''
    );
    for (const [index, ip] of ['198.51.100.1', '198.51.100.2'].entries()) {
      expect((await post(`unknown-${index}@example.test`, ip)).status).toBe(200);
    }
    const rows = (
      await http.pool.query(
        "SELECT key,cardinality(events) AS count FROM rate_limit_windows WHERE security AND key LIKE 'forgot-password:ip:%' ORDER BY key"
      )
    ).rows;
    expect(rows).toEqual(
      trusted
        ? [
            { key: 'forgot-password:ip:198.51.100.1', count: 1 },
            { key: 'forgot-password:ip:198.51.100.2', count: 1 },
          ]
        : [{ key: 'forgot-password:ip:127.0.0.1', count: 2 }]
    );
    // Destination quota is independent of the forwarded client address.
    const username = 'quota@example.test';
    await http.pool.query(
      `INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
      VALUES ($1,$2,3600000,5)`,
      [
        'password-reset:destination:' + createHash('sha256').update(username).digest('hex'),
        Math.floor(Date.now() / 3600000) * 3600000,
      ]
    );
    for (const [ip, locale] of [
      ['198.51.100.3', 'en'],
      ['198.51.100.4', 'fa'],
    ] as const) {
      const response = await post(username, ip, locale);
      expect(response.status).toBe(429);
      const retryAfter = Number(response.headers.get('retry-after'));
      expect(retryAfter).toBeGreaterThan(0);
      const result = await response.json();
      expect(result).toMatchObject({
        error: {
          code: 'RATE_LIMIT:EXCEEDED',
          correlationId: expect.any(String),
          message: t('error.rate_limit.retry_after', locale).replace(
            '{seconds}',
            new Intl.NumberFormat(locale, { useGrouping: false }).format(retryAfter)
          ),
        },
      });
      expect(JSON.stringify(result)).not.toContain(username);
    }
    const diagnostics = http
      .logs()
      .split('[Nest] ')
      .filter((entry) => entry.includes('[RateLimitGuard]'));
    expect(diagnostics.join('\n')).toContain('Rate-limit check: forgot-password:ip');
    expect(diagnostics.join('\n')).not.toMatch(/198\.51\.100\.|127\.0\.0\.1|quota@example\.test/);
  }, 40000);
}
