import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarFinalService } from './solar-final.service.js';
import { ContractService } from '../contract/contract.service.js';
import { solarContractSchema } from './solar-contract.validation.js';

const close = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
@ApiTags('Admin · Solar final decisions')
@ApiBearerAuth()
@Controller('api/admin/solar/requests/:id')
@UseGuards(SessionAuthGuard)
export class StaffSolarFinalController {
  constructor(
    private readonly service: SolarFinalService,
    private readonly contracts: ContractService
  ) {}

  @Get('contract-options')
  @ApiOperation({
    summary: 'List eligible template versions and uploaded documents for a solar contract',
  })
  options(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.contracts.solarOptions(id, req.session);
  }

  @Post('create-contract')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a linked solar draft contract and issue its initial invoice' })
  @ApiZodBody(solarContractSchema)
  createContract(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = solarContractSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid solar contract');
    return this.contracts.createSolar(
      { ...parsed.data, requestId: id },
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('final-approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a solar request after confirmed postal receipt' })
  approve(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.decide(req.session, id, 'approve', undefined, req.ip ?? '127.0.0.1');
  }

  @Post('close-no-contract')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a solar request without a contract, with a reason' })
  @ApiZodBody(close)
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = close.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Reason is required');
    return this.service.decide(
      req.session,
      id,
      'close-no-contract',
      parsed.data.reason,
      req.ip ?? '127.0.0.1'
    );
  }
}
