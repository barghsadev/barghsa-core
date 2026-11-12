import type { RequestHandler } from 'express';
import promClient from 'prom-client';
import { createOperatorLogger, operatorLogCorrelation } from '@barghsa/shared/operator-logging';
import { privateLogId } from '@barghsa/shared/log-privacy';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { apiRequestTrace } from './api-request-tracing.js';

const apiPath = /^\/api(?:\/|$)/i;
const logRequest = createOperatorLogger('api');
const customerServicePath = /^\/api\/(?:electricity|saving|solar|consultations)(?:\/|$)/i;
const duration = new promClient.Histogram({
  name: 'barghsa_http_request_duration_seconds',
  help: 'Duration and count of completed API responses by route, method, and status',
  labelNames: ['route', 'method', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

const revision = process.env.BARGHSA_RELEASE_SHA ?? '';
const validRevision = /^[a-f0-9]{40}$/.test(revision);
const customerJourneys = {
  electricity: [
    'GET /api/electricity/orders',
    'GET /api/electricity/orders/:orderId',
    'POST /api/electricity/preview/simple',
    'POST /api/electricity/preview/advanced',
    'POST /api/electricity/orders/simple',
    'POST /api/electricity/orders/advanced',
    'POST /api/electricity/orders/:orderId/resubmit-address',
    'POST /api/electricity/orders/:orderId/revision-preview',
    'POST /api/electricity/orders/:orderId/resubmit',
    'POST /api/electricity/orders/:orderId/cancel-review',
    'POST /api/electricity/orders/:orderId/cancel',
  ],
  saving: [
    'GET /api/saving/orders',
    'GET /api/saving/orders/:id',
    'POST /api/saving/orders/verify-bill',
    'POST /api/saving/orders/quote',
    'POST /api/saving/orders',
    'POST /api/saving/orders/:id/change-quote',
    'POST /api/saving/orders/:id/change',
  ],
  solar: [
    'GET /api/solar/requests',
    'GET /api/solar/requests/:id',
    'POST /api/solar/requests/review',
    'POST /api/solar/requests',
    'GET /api/solar/requests/:id/documents',
    'POST /api/solar/requests/:id/documents/complete',
    'GET /api/solar/requests/:id/postal',
    'POST /api/solar/requests/:id/postal/shipment',
  ],
  consultation: [
    'GET /api/consultations/requests',
    'GET /api/consultations/requests/:id',
    'POST /api/consultations/requests',
    'POST /api/consultations/requests/:id/offer-review',
    'POST /api/consultations/requests/:id/provide-info',
    'POST /api/consultations/requests/:id/accept',
    'POST /api/consultations/requests/:id/decline',
  ],
};
const serviceByRoute = new Map(
  Object.entries(customerJourneys).flatMap(([service, routes]) =>
    routes.map((route) => [route, service] as const)
  )
);
const journeyAttempts = validRevision
  ? new promClient.Counter({
      name: 'barghsa_rollout_journey_attempts_total',
      help: 'Availability outcomes of observed authenticated customer journey requests',
      labelNames: ['revision', 'service', 'outcome'] as const,
    })
  : undefined;

if (validRevision) {
  new promClient.Gauge({
    name: 'barghsa_api_release_info',
    help: 'Source revision of the built API process',
    labelNames: ['revision'] as const,
  }).set({ revision }, 1);
  for (const service of Object.keys(customerJourneys)) {
    journeyAttempts?.inc({ revision, service, outcome: 'success' }, 0);
    journeyAttempts?.inc({ revision, service, outcome: 'failure' }, 0);
  }
}

export const observeHttpRequest: RequestHandler = (request, response, next) => {
  if (apiPath.test(request.path)) {
    const started = performance.now();
    const correlationId = operatorLogCorrelation.getStore();
    const trace = apiRequestTrace.getStore();
    function recordJourney(route: string, outcome: 'success' | 'failure') {
      if (
        !journeyAttempts ||
        (request as Partial<AuthenticatedRequest>).session?.operatingContext !== 'customer'
      )
        return;
      const service = serviceByRoute.get(`${request.method} ${route}`);
      if (service) journeyAttempts.inc({ revision, service, outcome });
    }
    response.once('finish', () => {
      // Express uses a catch-all route for unknown paths. Label only actual API templates.
      const template: unknown = request.route?.path;
      const route = typeof template === 'string' && apiPath.test(template) ? template : 'unmatched';
      if (route === '/api/health/live' || route === '/api/health/ready') return;
      const durationMs = performance.now() - started;
      duration.observe(
        { route, method: request.method, status: String(response.statusCode) },
        durationMs / 1000
      );
      const status = response.statusCode;
      const userId = (request as Partial<AuthenticatedRequest>).session?.userId;
      logRequest(status >= 500 ? 'error' : 'info', 'HTTP request completed', {
        event: 'http.request',
        correlationId,
        ...trace,
        route,
        method: request.method,
        status,
        durationMs,
        outcome: status >= 400 ? 'failure' : 'success',
        ...(userId ? { actorRef: privateLogId('actor', userId) } : {}),
      });
      if (response.statusCode >= 500 || response.statusCode === 408) {
        recordJourney(route, 'failure');
      } else if (
        (response.statusCode >= 200 && response.statusCode < 300) ||
        response.statusCode === 304
      ) {
        recordJourney(route, 'success');
      }
    });
    if (journeyAttempts && customerServicePath.test(request.path)) {
      response.once('close', () => {
        const template: unknown = request.route?.path;
        if (!response.writableFinished && typeof template === 'string')
          recordJourney(template, 'failure');
      });
    }
  }
  next();
};
