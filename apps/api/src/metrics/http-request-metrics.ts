import type { RequestHandler } from 'express';
import promClient from 'prom-client';

const apiPath = /^\/api(?:\/|$)/i;
const duration = new promClient.Histogram({
  name: 'barghsa_http_request_duration_seconds',
  help: 'Duration and count of completed API responses by route, method, and status',
  labelNames: ['route', 'method', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

export const observeHttpRequest: RequestHandler = (request, response, next) => {
  if (apiPath.test(request.path)) {
    const started = performance.now();
    response.once('finish', () => {
      // Express uses a catch-all route for unknown paths. Label only actual API templates.
      const template: unknown = request.route?.path;
      const route = typeof template === 'string' && apiPath.test(template) ? template : 'unmatched';
      if (route === '/api/health/live' || route === '/api/health/ready') return;
      duration.observe(
        { route, method: request.method, status: String(response.statusCode) },
        (performance.now() - started) / 1000
      );
    });
  }
  next();
};
