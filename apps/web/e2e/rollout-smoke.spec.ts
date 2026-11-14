import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { decryptAuthDelivery } from '@barghsa/shared/auth-delivery';
import { t } from '@barghsa/i18n/workspace';
import { shellText } from '@barghsa/i18n/shell';
import { startTestPostgres } from '../../../packages/db/src/test/globalSetup';
import { startHttpFixture } from '../../api/src/test/http-fixture';
import { createStaticServer } from '../server.js';
import { test, expect } from './coverage-fixture';

const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const locale = 'fa';
const fixtureName = 'کاربر آزمایشی';

test('a fresh customer OTP session renders the owned dashboard and wallet, then signs out', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const web = createStaticServer();
  let api: Awaited<ReturnType<typeof startHttpFixture>> | undefined;
  const gateway = createServer((incoming, outgoing) => {
    if (!incoming.url?.startsWith('/api/')) {
      web.emit('request', incoming, outgoing);
      return;
    }
    if (!api) {
      outgoing.writeHead(503).end();
      return;
    }
    const upstream = request(
      api.base + incoming.url,
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      }
    );
    upstream.setTimeout(15_000, () => upstream.destroy());
    upstream.on('error', () => {
      if (outgoing.headersSent) outgoing.destroy();
      else outgoing.writeHead(502).end();
    });
    incoming.pipe(upstream);
  });
  let database: Awaited<ReturnType<typeof startTestPostgres>> | undefined;
  try {
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    const address = gateway.address();
    if (!address || typeof address === 'string') throw new Error('Missing rollout fixture port');
    const origin = `http://127.0.0.1:${address.port}`;
    database = await startTestPostgres();
    api = await startHttpFixture(database.connectionString, { publicOrigin: origin });
    const userId = randomUUID();
    const profileId = randomUUID();
    const email = 'rollout-fixture@example.test';
    const password = randomUUID();
    const argon2 = requireApi('argon2') as { hash(value: string): Promise<string> };
    await api.pool.query(
      'INSERT INTO users(user_id,username,email,password_hash) VALUES ($1,$2,$2,$3)',
      [userId, email, await argon2.hash(password)]
    );
    await api.pool.query(
      `INSERT INTO profiles(id,user_id,profile_type,status,is_default,first_name)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE',true,$3)`,
      [profileId, userId, fixtureName]
    );
    await api.pool.query(
      `INSERT INTO tos_acceptances(user_id,version_id)
       SELECT $1,id FROM tos_versions WHERE is_active AND status='published'`,
      [userId]
    );
    await api.pool.query(
      'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES ($1,1250000,0)',
      [profileId]
    );
    expect((await page.request.get(`${origin}/api/auth/user`)).status()).toBe(401);
    await page.addInitScript((lang) => {
      localStorage.setItem('barghsa.locale', lang);
      localStorage.setItem('barghsa-locale', lang);
    }, locale);
    await page.goto(`${origin}/login`);
    await page.locator('#username').fill(email);
    await page.locator('#password').fill(password);
    const loginReceipt = page.waitForResponse(
      (response) => response.url() === `${origin}/api/auth/login`
    );
    await page.locator('button[type=submit]').click();
    const login = await loginReceipt;
    expect(login.status()).toBe(200);
    const challenge = (await login.json()) as { requiresOtp: boolean; challengeId: string };
    expect(challenge.requiresOtp).toBe(true);
    expect((await page.request.get(`${origin}/api/auth/user`)).status()).toBe(401);
    const delivery = await api.pool.query<{ id: string; encrypted_payload: string }>(
      'SELECT id,encrypted_payload FROM auth_delivery_outbox WHERE challenge_id=$1',
      [challenge.challengeId]
    );
    expect(delivery.rows).toHaveLength(1);
    const row = delivery.rows[0]!;
    const payload = decryptAuthDelivery(
      row.id,
      row.encrypted_payload,
      'http-fixture-delivery-key-only'
    );
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('code' in payload) ||
      typeof payload.code !== 'string' ||
      !/^\d{6}$/.test(payload.code)
    )
      throw new Error('The isolated outbox did not issue a login code');
    const digits = page.locator('input[inputmode=numeric]');
    await expect(digits).toHaveCount(6);
    for (const [index, digit] of Array.from(payload.code).entries()) {
      await digits.nth(index).fill(digit);
    }
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(`${origin}/app`);
    const context = await page.request.get(`${origin}/api/dashboard/context`);
    expect(context.status()).toBe(200);
    expect(await context.json()).toMatchObject({
      profile: { id: profileId, name: fixtureName },
      access: { wallet: true },
    });
    const wallet = await page.request.get(
      `${origin}/api/dashboard/widgets/wallet?profileId=${profileId}`
    );
    expect(wallet.status()).toBe(200);
    expect(await wallet.json()).toMatchObject({
      profileId,
      data: { balance: '1250000', currency: 'IRR' },
    });
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      t('dashboard.overview.welcome', locale).replace('{name}', fixtureName)
    );
    const widget = page.getByRole('region', {
      name: t('dashboard.overview.walletBalance', locale),
    });
    await expect(widget).toContainText(new Intl.NumberFormat('fa-IR').format(1250000));
    await page.screenshot({
      path: info.outputPath('rollout-dashboard-fa.png'),
      animations: 'disabled',
    });

    await page.getByRole('button', { name: shellText('accountMenu', locale) }).click();
    await page.getByRole('button', { name: shellText('logout', locale), exact: true }).click();
    await expect(page).toHaveURL(`${origin}/login`);
    expect((await page.request.get(`${origin}/api/auth/user`)).status()).toBe(401);
    expect(
      (
        await api.pool.query(
          'SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE user_id=$1',
          [userId]
        )
      ).rows
    ).toEqual([{ revoked: true }]);
  } finally {
    gateway.closeAllConnections();
    await new Promise<void>((closed) => gateway.close(() => closed()));
    try {
      await api?.close();
    } finally {
      await database?.close();
    }
  }
});
