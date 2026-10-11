import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const prefix = '/__staging/payment/';
const origin = 'https://stg.barghsa.com';
const equal = (a, b) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Controlled provider fixture. No real funds, no public settlement, no automatic callback send. */
export function createPaymentSandbox(options) {
  if (
    options.environment !== 'staging' ||
    [options.apiKey, options.operatorKey, options.webhookSecret].some(
      (s) => typeof s !== 'string' || s.length < 32
    ) ||
    equal(options.apiKey, options.operatorKey) ||
    !options.merchantId
  )
    throw new Error('Protected staging sandbox configuration required');

  // ponytail: one process owns this append-only ledger; do not deploy replicas sharing it.
  const sessions = new Map();
  try {
    for (const line of readFileSync(options.ledger, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (!row.idempotencyKey || !row.authority || !Number.isSafeInteger(row.amount))
        throw new Error('Invalid sandbox ledger');
      sessions.set(row.idempotencyKey, row);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const fd = openSync(options.ledger, 'a', 0o600);
  let unavailable = false;
  const save = (row) => {
    writeFileSync(fd, JSON.stringify(row) + '\n');
    fsyncSync(fd);
    sessions.set(row.idempotencyKey, row);
  };
  const reply = (res, status, data = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin),
        route = url.pathname.slice(prefix.length);
      if (!url.pathname.startsWith(prefix)) return reply(res, 404);
      if (unavailable) return reply(res, 503);
      if (req.method === 'GET' && route === 'health')
        return reply(res, 200, { service: 'controlled-staging-payment-sandbox', realFunds: false });
      if (req.method === 'GET' && /^pay\/[a-f0-9-]{36}$/.test(route))
        return reply(res, 200, { realFunds: false, settlement: 'protected operator only' });
      if (req.headers.origin || req.headers.cookie) return reply(res, 403);
      const secret = route === 'settle' ? options.operatorKey : options.apiKey;
      if (!equal(req.headers.authorization ?? '', `Bearer ${secret}`)) return reply(res, 401);
      if (req.method === 'GET' && route === 'inquiry') {
        const row = sessions.get(url.searchParams.get('idempotencyKey'));
        if (!row || row.orderId !== url.searchParams.get('orderId')) return reply(res, 404);
        return reply(res, 200, {
          authority: row.authority,
          redirectUrl: `${origin}${prefix}pay/${row.authority}`,
        });
      }
      if (req.method !== 'POST' || !['request', 'verify', 'settle'].includes(route))
        return reply(res, 404);
      if (req.headers['content-type'] !== 'application/json') return reply(res, 415);
      let raw = '',
        size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) return reply(res, 413);
        raw += chunk.toString('utf8');
      }
      const input = JSON.parse(raw);
      if (
        !input ||
        Array.isArray(input) ||
        typeof input.idempotencyKey !== 'string' ||
        input.idempotencyKey.length < 1 ||
        input.idempotencyKey.length > 256
      )
        return reply(res, 400);
      const existing = sessions.get(input.idempotencyKey);
      if (route === 'request') {
        const callback = new URL(input.callbackUrl);
        if (
          !Number.isSafeInteger(input.amount) ||
          input.amount < 1 ||
          !/^[a-f0-9-]{36}$/.test(input.orderId) ||
          callback.origin !== origin ||
          callback.pathname !== '/api/wallet/top-ups/callback' ||
          callback.searchParams.get('orderId') !== input.orderId ||
          callback.username ||
          callback.password
        )
          return reply(res, 400);
        if (
          existing &&
          (existing.orderId !== input.orderId ||
            existing.amount !== input.amount ||
            existing.callbackUrl !== callback.href)
        )
          return reply(res, 409);
        const row = existing ?? {
          idempotencyKey: input.idempotencyKey,
          orderId: input.orderId,
          amount: input.amount,
          callbackUrl: callback.href,
          authority: randomUUID(),
          paid: false,
        };
        if (!existing) save(row);
        return reply(res, 200, {
          authority: row.authority,
          redirectUrl: `${origin}${prefix}pay/${row.authority}`,
        });
      }
      if (
        !existing ||
        existing.orderId !== input.orderId ||
        existing.authority !== input.authority ||
        existing.amount !== input.amount
      )
        return reply(res, 409);
      if (route === 'verify')
        return reply(res, 200, {
          paid: existing.paid,
          ...(existing.paid ? { refId: `staging-${existing.authority}` } : {}),
        });
      const row = { ...existing, paid: true };
      if (!existing.paid) save(row);
      const body = JSON.stringify({
        merchantOrderId: row.orderId,
        merchantId: options.merchantId,
        authority: row.authority,
        amountIrR: String(row.amount),
        status: 'paid',
        providerRefId: `staging-${row.authority}`,
      });
      const eventId = `staging-${row.authority}`,
        timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', options.webhookSecret)
        .update(`${eventId}.${timestamp}.${body}`)
        .digest('base64');
      return reply(res, 200, {
        callbackUrl: row.callbackUrl,
        body,
        headers: {
          'Content-Type': 'application/json',
          'x-barghsa-event-id': eventId,
          'x-barghsa-timestamp': timestamp,
          'x-barghsa-signature': `v1,${signature}`,
        },
      });
    } catch (error) {
      const invalidInput = error instanceof SyntaxError || error instanceof TypeError;
      if (!invalidInput) unavailable = true;
      reply(res, invalidInput ? 400 : 503);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 15000;
  server.once('close', () => closeSync(fd));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const e = process.env;
  const server = createPaymentSandbox({
    environment: e.PAYMENT_SANDBOX_ENVIRONMENT,
    apiKey: e.PAYMENT_GATEWAY_API_KEY,
    operatorKey: e.PAYMENT_SANDBOX_OPERATOR_KEY,
    webhookSecret: e.PAYMENT_GATEWAY_WEBHOOK_SECRET,
    merchantId: e.PAYMENT_GATEWAY_MERCHANT_ID,
    ledger: e.PAYMENT_SANDBOX_LEDGER,
  });
  server.listen(9096, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 15000);
      server.close(() => clearTimeout(deadline));
    });
}
