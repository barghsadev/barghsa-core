import { Controller, Get, Post, Param, Body, Req, UseGuards, Logger } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SessionAuthGuard } from '../session/session.guard.js'
import { WalletService } from './wallet.service.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name)

  constructor(private readonly walletService: WalletService) {}

  @Get(':profileId')
  @ApiOperation({ summary: 'Get wallet balance for a profile' })
  async getWallet(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.debug(`Wallet inquiry: user=${req.session.userId} profile=${profileId}`)
    const wallet = await this.walletService.getWallet(profileId)
    if (!wallet) return { balance: 0, currency: 'IRR' }
    return {
      balance: Number(wallet.availableBalance),
      postedBalance: Number(wallet.postedBalance),
      reservedBalance: Number(wallet.reservedBalance),
      currency: 'IRR',
    }
  }

  @Post(':profileId/create')
  @ApiOperation({ summary: 'Create wallet for a profile' })
  async createWallet(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.debug(`Wallet creation: user=${req.session.userId} profile=${profileId}`)
    const wallet = await this.walletService.createWallet(profileId)
    return {
      ok: true,
      balance: Number(wallet.availableBalance),
      currency: 'IRR',
    }
  }

  @Get(':profileId/transactions')
  @ApiOperation({ summary: 'Get wallet transaction history' })
  async getTransactions(
    @Param('profileId') profileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.debug(`Wallet transactions: user=${req.session.userId} profile=${profileId}`)
    const transactions = await this.walletService.getTransactions(profileId)
    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        state: tx.state,
        refId: tx.refId,
        description: tx.description,
        createdAt: tx.createdAt,
      })),
    }
  }
}
