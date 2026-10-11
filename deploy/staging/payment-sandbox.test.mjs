import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createPaymentSandbox } from './payment-sandbox.mjs';
import gatewayModule from '../../apps/api/dist/src/wallet/payment-gateway.js';
import callbackModule from '../../apps/api/dist/src/wallet/payment-callback-verifier.js';

const { createHttpPaymentGateway } = gatewayModule;
const { verifyPaymentCallbackSignature } = callbackModule;

const directory = mkdtempSync(join(tmpdir(), 'barghsa-payment-sandbox-'));
const options = {
  environment: 'staging',
  apiKey: 'a'.repeat(64),
  operatorKey: 'b'.repeat(64),
  webhookSecret: 'c'.repeat(64),
  merchantId: randomUUID(),
  ledger: join(directory, 'ledger.jsonl'),
};
let server, base;
async function start() {
  server = createPaymentSandbox(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/__staging/payment/`;
}
const stop = () => new Promise((resolve) => server.close(resolve));
before(start);
after(async () => {
  await stop();
  rmSync(directory, { recursive: true, force: true });
});
const gateway = () =>
  createHttpPaymentGateway({
    requestUrl: 'https://stg.barghsa.com/__staging/payment/request',
    inquiryUrl: 'https://stg.barghsa.com/__staging/payment/inquiry',
    verifyUrl: 'https://stg.barghsa.com/__staging/payment/verify',
    apiKey: options.apiKey,
    fetchImpl: (url, init) => {
      const target = new URL(url);
      return fetch(base + target.pathname.split('/').at(-1) + target.search, init);
    },
  });
function input() {
  const merchantOrderId = randomUUID();
  return {
    merchantOrderId,
    idempotencyKey: randomUUID(),
    amountIrR: 250000n,
    callbackUrl: `https://stg.barghsa.com/api/wallet/top-ups/callback?orderId=${merchantOrderId}`,
    description: 'Controlled staging fixture',
  };
}
const post = (route, body, key = options.apiKey, headers = {}) =>
  fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...headers },
    body: JSON.stringify(body),
  });
const providerInput = (request, session) => ({
  idempotencyKey: request.idempotencyKey,
  orderId: request.merchantOrderId,
  amount: Number(request.amountIrR),
  authority: session.authority,
});

test('native adapter requests, recovers after restart, verifies only protected settlement and authenticates its callback', async () => {
  const request = input(),
    session = await gateway().startPayment(request);
  assert.equal((await gateway().verifyPayment({ ...request, ...session })).paid, false);
  await stop();
  await start();
  assert.deepEqual(await gateway().recoverPayment(request), session);
  const command = providerInput(request, session);
  assert.equal((await post('settle', command)).status, 401);
  const settled = await post('settle', command, options.operatorKey);
  assert.equal(settled.status, 200);
  const envelope = await settled.json();
  assert.deepEqual(
    verifyPaymentCallbackSignature(
      envelope.body,
      {
        eventId: envelope.headers['x-barghsa-event-id'],
        timestamp: envelope.headers['x-barghsa-timestamp'],
        signature: envelope.headers['x-barghsa-signature'],
      },
      options.webhookSecret
    ),
    { ok: true }
  );
  assert.deepEqual(JSON.parse(envelope.body), {
    merchantOrderId: request.merchantOrderId,
    merchantId: options.merchantId,
    authority: session.authority,
    amountIrR: '250000',
    status: 'paid',
    providerRefId: `staging-${session.authority}`,
  });
  assert.deepEqual(await gateway().verifyPayment({ ...request, ...session }), {
    paid: true,
    providerRefId: `staging-${session.authority}`,
  });
  const before = readFileSync(options.ledger, 'utf8');
  const repeat = await (await post('settle', command, options.operatorKey)).json();
  assert.equal(repeat.headers['x-barghsa-event-id'], envelope.headers['x-barghsa-event-id']);
  assert.equal(repeat.body, envelope.body);
  assert.equal(readFileSync(options.ledger, 'utf8'), before);
});
test('concurrent native requests retain one durable authority and reject changed amount or callback', async () => {
  const request = input();
  const sessions = await Promise.all(
    Array.from({ length: 6 }, () => gateway().startPayment(request))
  );
  assert.equal(new Set(sessions.map((s) => s.authority)).size, 1);
  const lines = readFileSync(options.ledger, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.filter((r) => r.idempotencyKey === request.idempotencyKey).length, 1);
  await assert.rejects(gateway().startPayment({ ...request, amountIrR: 250001n }), /HTTP 409/);
  assert.equal(
    (await post('verify', { ...providerInput(request, sessions[0]), amount: 1 })).status,
    409
  );
  assert.equal(
    (
      await post(
        'settle',
        { ...providerInput(request, sessions[0]), authority: randomUUID() },
        options.operatorKey
      )
    ).status,
    409
  );
  await assert.rejects(
    gateway().startPayment({ ...input(), callbackUrl: 'https://evil.example/callback' }),
    /HTTP 400/
  );
});
for (const headers of [{ Origin: 'https://stg.barghsa.com' }, { Cookie: 'session=fixture' }])
  test(`rejects browser credentials ${Object.keys(headers)[0]}`, async () => {
    assert.equal(
      (await post('settle', { idempotencyKey: randomUUID() }, options.operatorKey, headers)).status,
      403
    );
  });
test('rejects non-staging and incomplete protected configuration', () => {
  assert.throws(() => createPaymentSandbox({ ...options, environment: 'production' }), /staging/);
  assert.throws(() => createPaymentSandbox({ ...options, apiKey: '' }), /staging/);
  assert.throws(() => createPaymentSandbox({ ...options, operatorKey: options.apiKey }), /staging/);
});
test('fails closed on a corrupt durable ledger', () => {
  const ledger = join(directory, 'corrupt.jsonl');
  writeFileSync(ledger, '{incomplete');
  assert.throws(() => createPaymentSandbox({ ...options, ledger }), SyntaxError);
});
