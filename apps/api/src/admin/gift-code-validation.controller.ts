import { Body, Controller, HttpCode, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { GIFT_CODE_CATEGORIES, MAX_GIFT_IRR } from '@barghsa/shared/promotions';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { GiftCodeService } from './gift-code.service.js';

const validateGiftCodeInput = z
  .object({
    code: z.string().trim().min(3).max(64),
    profileId: z.string().uuid(),
    orderAmount: z
      .string()
      .regex(/^\d{1,19}$/)
      .refine((amount) => BigInt(amount) <= MAX_GIFT_IRR),
    category: z.enum(GIFT_CODE_CATEGORIES),
  })
  .strict();

@ApiTags('Gift Codes')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/gift-codes')
export class GiftCodeValidationController {
  constructor(private readonly giftCodes: GiftCodeService) {}

  @Post('validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview a gift code for an active customer profile and order' })
  @ApiZodBody(validateGiftCodeInput)
  @ApiResponse({
    status: 200,
    description: 'Normalized code and estimated IRR discount; no slot reserved.',
  })
  async validate(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = validateGiftCodeInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.giftCodes.preview(
      {
        giftCode: parsed.data.code,
        profileId: parsed.data.profileId,
        orderAmount: parsed.data.orderAmount,
        category: parsed.data.category,
      },
      req.session.userId
    );
  }
}
