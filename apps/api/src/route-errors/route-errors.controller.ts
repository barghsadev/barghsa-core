import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { browserErrorCodes, reportBrowserError } from '@barghsa/shared/error-reporting';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';

const routeError = z.strictObject({
  code: z.enum(browserErrorCodes),
  reference: z.uuidv4(),
});

@Controller('api/route-errors')
export class RouteErrorsController {
  @Post()
  @RateLimit({ namespace: 'route-error:report', limit: 20, windowMs: 60_000, security: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['code', 'reference'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', enum: [...browserErrorCodes] },
        reference: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiAcceptedResponse({ description: 'The production sampling policy omitted the route event.' })
  @ApiNoContentResponse({ description: 'Sentry acknowledged the matching route error event.' })
  @ApiServiceUnavailableResponse({ description: 'No matching Sentry receipt is available.' })
  async report(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
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

    const { code, reference } = result.data;
    const outcome = await reportBrowserError(code, reference);
    if (outcome === 'unavailable') throw new ServiceUnavailableException();
    response.status(outcome === 'acknowledged' ? HttpStatus.NO_CONTENT : HttpStatus.ACCEPTED).end();
  }
}
