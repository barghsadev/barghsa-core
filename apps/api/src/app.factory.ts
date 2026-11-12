import { CorrelationLogger } from './common/correlation-logger.js';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';
import { trustedProxyIps } from './common/proxy-trust.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { getDbPool, recordAuthorizationDenial } from '@barghsa/db';
import { AppModule } from './app.module.js';
import { CacheControlInterceptor } from './common/cache-control.interceptor.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { EtagInterceptor } from './common/etag.interceptor.js';
import { Reflector } from '@nestjs/core';
import { sanitizeBodyParserErrors } from './common/body-parser-errors.js';
import { browserCorsOptions } from './common/browser-origin.js';
import { observeHttpRequest } from './metrics/http-request-metrics.js';
import { ApiRequestTracing } from './metrics/api-request-tracing.js';
import type { Server, ServerResponse } from 'node:http';

export async function createApplication() {
  const proxies = trustedProxyIps();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: new CorrelationLogger(),
  });
  const server = app.getHttpServer() as Server;
  server.headersTimeout = 60_000;
  server.requestTimeout = 300_000;
  server.maxHeadersCount = 2_000;
  app
    .getHttpAdapter()
    .getInstance()
    .disable('x-powered-by')
    .set('etag', false)
    .set('trust proxy', proxies.length ? proxies : false);
  const configuredEnvironment = process.env['BARGHSA_DEPLOYMENT_ENV'] ?? process.env['NODE_ENV'];
  const environment =
    configuredEnvironment === 'development' || configuredEnvironment === 'staging'
      ? configuredEnvironment
      : 'production';
  app.use((_request: unknown, response: ServerResponse, next: () => void) => {
    response.setHeader('X-Environment', environment);
    next();
  });
  const correlation = new CorrelationIdMiddleware();
  app.use(correlation.use.bind(correlation));
  app.use(app.get(ApiRequestTracing).observe);
  app.use(observeHttpRequest);
  app.enableCors(browserCorsOptions());

  // A 10 MiB text file may expand sixfold when escaped inside JSON. Restrict
  // the larger parser to version uploads; retain the default limit elsewhere.
  app.useBodyParser('json', {
    limit: 61 * 1024 * 1024,
    inflate: false,
    type: (request) =>
      request.method === 'POST' &&
      /^\/api\/admin\/contract-templates\/[0-9a-f-]{36}\/versions\/?(?:\?|$)/i.test(
        request.url ?? ''
      ) &&
      /^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''),
  });
  // Native CSP reports have a distinct media type and a small, uncompressed body.
  app.useBodyParser('json', {
    limit: 16 * 1024,
    inflate: false,
    type: (request) =>
      request.method === 'POST' &&
      /^\/api\/csp-report\/?(?:\?|$)/.test(request.url ?? '') &&
      /^application\/csp-report(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''),
  });
  app.useBodyParser('json', {
    limit: 1024,
    inflate: false,
    type: (request) =>
      request.method === 'POST' &&
      /^\/api\/route-errors\/?(?:\?|$)/.test(request.url ?? '') &&
      /^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''),
  });
  app.useBodyParser('json', { limit: 100 * 1024 });
  app.useBodyParser('urlencoded', { extended: true, limit: 100 * 1024 });
  app.use(sanitizeBodyParserErrors);

  // Enable shutdown hooks for graceful SIGTERM/SIGINT handling.
  // NestJS will call OnApplicationShutdown lifecycle hooks on all registered
  // providers when a termination signal is received.
  app.enableShutdownHooks();

  // Global cache control — authenticated API responses use private, no-cache
  app.useGlobalInterceptors(new CacheControlInterceptor());

  // Global ETag interceptor — only activates for @Etag()-decorated routes
  app.useGlobalInterceptors(new EtagInterceptor(app.get(Reflector)));

  // Global exception filter — stable error codes, localized messages, no stack traces
  app.useGlobalFilters(
    new HttpExceptionFilter((event) => recordAuthorizationDenial(getDbPool(), event))
  );

  const config = new DocumentBuilder()
    .setTitle('API')
    .setDescription('Iranian electricity market intelligence platform')
    .setVersion('0.1.0')
    .build();

  const documentFactory = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, documentFactory);

  return app;
}
