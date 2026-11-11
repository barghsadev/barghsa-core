import { Controller, Get, Module, Post, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { get } from 'node:http';
import promClient from 'prom-client';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const revision = 'ab'.repeat(20);
const metric = 'barghsa_rollout_journey_attempts_total';
let app: NestExpressApplication;
let base: string;
let observeClose: (() => void) | undefined;

@Controller('api')
class FixtureRoutes {
  @Get([
    'electricity/orders',
    'saving/orders',
    'solar/requests/:id',
    'consultations/requests',
    'consultations/products',
  ])
  read(@Req() request: Request, @Res() response: Response) {
    if (request.headers['x-fixture-abort']) {
      response.once('close', () => observeClose?.());
      response.status(200).flushHeaders();
      return;
    }
    response.status(Number(request.headers['x-fixture-status'] ?? '200')).end();
  }

  @Post([
    'electricity/orders/advanced',
    'saving/orders',
    'solar/requests',
    'consultations/requests',
  ])
  submit(@Req() request: Request, @Res() response: Response) {
    response.status(Number(request.headers['x-fixture-status'] ?? '201')).end();
  }
}

@Module({ controllers: [FixtureRoutes] })
class FixtureModule {}

beforeAll(async () => {
  vi.stubEnv('BARGHSA_RELEASE_SHA', revision);
  const { observeHttpRequest } = await import('./http-request-metrics.js');
  app = await NestFactory.create<NestExpressApplication>(FixtureModule, { logger: false });
  app.use(observeHttpRequest);
  app.use((request: Request, _response: Response, next: () => void) => {
    const context = request.headers['x-fixture-context'];
    if (context === 'customer' || context === 'staff') {
      (request as AuthenticatedRequest).session = {
        userId: 'private-actor',
        sessionId: 'private-session',
        csrfToken: 'private-csrf',
        isAdmin: context === 'staff',
        operatingContext: context,
        staffAvailable: context === 'staff',
        stepUpVerifiedAt: null,
      };
    }
    next();
  });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  for (const name of [metric, 'barghsa_http_request_duration_seconds', 'barghsa_api_release_info'])
    promClient.register.removeSingleMetric(name);
  vi.unstubAllEnvs();
});

const count = (service: string, outcome: string, value: number) =>
  `${metric}{revision="${revision}",service="${service}",outcome="${outcome}"} ${value}`;

async function snapshot() {
  return (await promClient.register.metrics())
    .split('\n')
    .filter((line) => line.startsWith(metric));
}

async function request(path: string, status: number, method = 'GET', context = 'customer') {
  const response = await fetch(base + path, {
    method,
    headers: { 'X-Fixture-Context': context, 'X-Fixture-Status': String(status) },
  });
  expect(response.status).toBe(status);
  await response.arrayBuffer();
}

it('counts real HTTP completions and interruptions for the four revision-scoped services', async () => {
  const services = ['electricity', 'saving', 'solar', 'consultation'];
  expect(await snapshot()).toEqual(
    services.flatMap((service) => [count(service, 'success', 0), count(service, 'failure', 0)])
  );

  await request('/api/electricity/orders?profileId=private-profile', 200);
  await request('/api/saving/orders', 201, 'POST');
  await request('/api/solar/requests/private-id', 304);
  await request('/api/consultations/requests', 201, 'POST');
  await request('/api/electricity/orders/advanced', 503, 'POST');
  await request('/api/saving/orders', 408);

  const closed = new Promise<void>((resolve) => {
    observeClose = resolve;
  });
  const pending = get(
    base + '/api/solar/requests/private-id',
    {
      headers: { 'X-Fixture-Context': 'customer', 'X-Fixture-Abort': 'true' },
    },
    (response) => response.destroy()
  );
  pending.on('error', () => undefined);
  await closed;
  observeClose = undefined;

  for (const status of [400, 401, 403, 404, 409, 429])
    await request('/api/consultations/requests', status);
  await request('/api/consultations/requests', 503, 'GET', 'staff');
  await request('/api/consultations/requests', 200, 'GET', 'anonymous');
  await request('/api/consultations/products', 200);
  expect((await fetch(base + '/api/consultations/not-a-route')).status).toBe(404);

  expect(await snapshot()).toEqual([
    count('electricity', 'success', 1),
    count('electricity', 'failure', 1),
    count('saving', 'success', 1),
    count('saving', 'failure', 1),
    count('solar', 'success', 1),
    count('solar', 'failure', 1),
    count('consultation', 'success', 1),
    count('consultation', 'failure', 0),
  ]);
});
