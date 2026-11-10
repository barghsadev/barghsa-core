import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBody, ApiNoContentResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { readCappedJson } from '@barghsa/shared/storage';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';

const routeErrorCodes = ['CHUNK_LOAD_FAILED', 'ROUTE_RENDER_FAILED'] as const;
const MAX_SENTRY_RECEIPT_BYTES = 4096;
const routeError = z.strictObject({
  code: z.enum(routeErrorCodes),
  reference: z.uuidv4(),
});

function sentryEndpoint(dsn: string) {
  const url = URL.parse(dsn);
  const project = url && /^(?<base>(?:\/[a-z0-9._-]+)*)\/(?<id>[0-9]+)\/?$/i.exec(url.pathname);
  if (
    !url ||
    url.protocol !== 'https:' ||
    !/^[a-z0-9]+$/i.test(url.username) ||
    url.password ||
    url.search ||
    url.hash ||
    !project?.groups?.id
  ) {
    throw new ServiceUnavailableException();
  }
  return new URL(`${project.groups.base}/api/${project.groups.id}/envelope/`, url.origin);
}

@Controller('api/route-errors')
export class RouteErrorsController {
  @Post()
  @RateLimit({ namespace: 'route-error:report', limit: 20, windowMs: 60_000, security: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['code', 'reference'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', enum: [...routeErrorCodes] },
        reference: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiNoContentResponse({ description: 'Sentry acknowledged the matching route error event.' })
  @ApiServiceUnavailableResponse({ description: 'No matching Sentry receipt is available.' })
  async report(@Body() body: unknown, @Req() request: Request): Promise<void> {
    const app = URL.parse(process.env.APP_PUBLIC_URL ?? '');
    const site = request.headers['sec-fetch-site'];
    if (
      !app ||
      app.username ||
      app.password ||
      (app.protocol !== 'https:' &&
        (process.env.NODE_ENV === 'production' || app.protocol !== 'http:')) ||
      request.headers.origin !== app.origin ||
      (site !== undefined && site !== 'same-origin') ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
    ) {
      throw new ForbiddenException({ error: ErrorCodes.AUTHZ_CSRF_INVALID.code });
    }
    const result = routeError.safeParse(body);
    if (!result.success) throw new BadRequestException();

    const dsn = process.env.ROUTE_ERROR_SENTRY_DSN ?? '';
    const endpoint = sentryEndpoint(dsn);
    const { code, reference } = result.data;
    const eventId = reference.replaceAll('-', '').toLowerCase();
    const release = process.env.BARGHSA_RELEASE_SHA;
    const event = JSON.stringify({
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      message: code,
      fingerprint: [code],
      ...(/^[a-f0-9]{40}$/.test(release ?? '') ? { release } : {}),
      tags: { support_reference: reference },
    });
    const envelope = [
      JSON.stringify({ event_id: eventId, dsn }),
      JSON.stringify({ type: 'event', length: Buffer.byteLength(event) }),
      event,
    ].join('\n');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: envelope,
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const receipt = (await readCappedJson(response, MAX_SENTRY_RECEIPT_BYTES)) as {
          id?: unknown;
        } | null;
        if (receipt?.id === eventId) return;
      } else {
        await response.body?.cancel();
      }
    } catch {
      // A transport failure or malformed receipt never exposes provider data.
    }
    throw new ServiceUnavailableException();
  }
}
