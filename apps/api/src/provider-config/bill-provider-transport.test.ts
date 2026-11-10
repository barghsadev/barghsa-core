import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { HttpBillDataProvider } from '../electricity/electricity-bill-data.service.js';
import { BillVerificationProvider } from '../saving/bill-verification.provider.js';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing bill provider port');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function providerPayload(path: string, extra?: string) {
  return path.startsWith('/profiles/')
    ? [{ hour: '2026-09-01T00:00:00Z', kwh: 2, extra }]
    : { verified: true, data: { extra } };
}

async function withBillProvider(handler: RequestListener, run: () => Promise<void>) {
  const server = createServer(handler);
  try {
    const base = await listen(server);
    vi.stubEnv('ELECTRICITY_BILL_DATA_URL', base);
    vi.stubEnv('ELECTRICITY_BILL_DATA_TOKEN', 'electricity-fixture-token');
    vi.stubEnv('SAVING_BILL_VERIFICATION_URL', base);
    vi.stubEnv('SAVING_BILL_VERIFICATION_TOKEN', 'saving-fixture-token');
    await run();
  } finally {
    await close(server);
  }
}

afterEach(() => vi.unstubAllEnvs());

it('accepts a full year of electricity readings and a valid saving verification', async () => {
  const year = Array.from({ length: 8_760 }, (_, index) => ({
    hour: new Date(Date.UTC(2025, 0, 1, index)).toISOString(),
    kwh: 2.5,
  }));
  const verified = { verified: true, data: { meter: 'fixture', consumption: 120 } };
  await withBillProvider(
    (request, response) => {
      response.end(JSON.stringify(request.url?.startsWith('/profiles/') ? year : verified));
    },
    async () => {
      await expect(new HttpBillDataProvider().getHourlyConsumption('owned')).resolves.toEqual(year);
      await expect(new BillVerificationProvider().verify('1234567890123')).resolves.toMatchObject({
        status: 'verified',
        data: verified.data,
      });
    }
  );
});

it('keeps both bill requests on the configured origin even when it redirects', async () => {
  const redirected = vi.fn<RequestListener>((request, response) => {
    response.end(JSON.stringify(providerPayload(request.url ?? '')));
  });
  const destination = createServer(redirected);
  const received: Array<{ path: string; authorization: string | undefined }> = [];
  try {
    const redirectOrigin = await listen(destination);
    await withBillProvider(
      (request, response) => {
        const path = request.url ?? '';
        received.push({ path, authorization: request.headers.authorization });
        response.writeHead(302, { location: `${redirectOrigin}${path}` }).end();
      },
      async () => {
        const electricity = await new HttpBillDataProvider()
          .getHourlyConsumption('owned')
          .catch((error: unknown) => error);
        const saving = await new BillVerificationProvider().verify('1234567890123');
        expect({ electricity, saving }).toMatchObject({
          electricity: { message: 'provider_error' },
          saving: { status: 'unavailable', reason: 'provider_error' },
        });
      }
    );
    expect(redirected).not.toHaveBeenCalled();
    expect(received).toEqual([
      {
        path: '/profiles/owned/hourly-consumption',
        authorization: 'Bearer electricity-fixture-token',
      },
      { path: '/bills/1234567890123/verify', authorization: 'Bearer saving-fixture-token' },
      { path: '/bills/1234567890123/verify', authorization: 'Bearer saving-fixture-token' },
    ]);
  } finally {
    await close(destination);
  }
});

it('refuses an oversized streamed bill response without retrying invalid saving data', async () => {
  const extra = 'x'.repeat(2 * 1024 * 1024);
  const origin = vi.fn<RequestListener>((request, response) => {
    const body = JSON.stringify(providerPayload(request.url ?? '', extra));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write(body.slice(0, body.length / 2));
    response.end(body.slice(body.length / 2));
  });
  await withBillProvider(origin, async () => {
    const electricity = await new HttpBillDataProvider()
      .getHourlyConsumption('owned')
      .catch((error: unknown) => error);
    const saving = await new BillVerificationProvider().verify('1234567890123');
    expect({ electricity, saving }).toMatchObject({
      electricity: { message: 'invalid_data' },
      saving: { status: 'unavailable', reason: 'invalid_data' },
    });
  });
  expect(origin).toHaveBeenCalledTimes(2);
});
