import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { CacheControlInterceptor } from './common/cache-control.interceptor.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { EtagInterceptor } from './common/etag.interceptor.js';
import { Reflector } from '@nestjs/core';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Enable shutdown hooks for graceful SIGTERM/SIGINT handling.
  // NestJS will call OnApplicationShutdown lifecycle hooks on all registered
  // providers when a termination signal is received.
  app.enableShutdownHooks();

  // Global cache control — authenticated API responses use private, no-cache
  app.useGlobalInterceptors(new CacheControlInterceptor());

  // Global ETag interceptor — only activates for @Etag()-decorated routes
  app.useGlobalInterceptors(new EtagInterceptor(app.get(Reflector)));

  // Global exception filter — stable error codes, localized messages, no stack traces
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Barghsa API')
    .setDescription('Iranian electricity market intelligence platform')
    .setVersion('0.1.0')
    .build();

  const documentFactory = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, documentFactory);

  const port = process.env['PORT'] ?? 4000;
  await app.listen(port);
}

void bootstrap().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exitCode = 1;
});