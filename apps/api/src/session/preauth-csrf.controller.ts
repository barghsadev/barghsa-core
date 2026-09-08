import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './session.guard.js';
import { PreauthCsrfService } from './preauth-csrf.service.js';

@ApiTags('Auth')
@Controller('api/auth')
export class PreauthCsrfController {
  constructor(@Inject(PreauthCsrfService) private readonly csrf: PreauthCsrfService) {}

  @Get('csrf')
  @ApiOperation({ summary: 'Get a browser-bound CSRF token before an authentication request' })
  @ApiResponse({
    status: 200,
    description: 'Current session token, or a short-lived anonymous token for one auth request.',
    schema: {
      type: 'object',
      required: ['csrfToken'],
      properties: { csrfToken: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    },
  })
  async token(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    if (request.session) return { csrfToken: request.session.csrfToken };
    return this.csrf.issue(request, response);
  }
}
