import { Module } from '@nestjs/common'
import { TosController } from './tos.controller.js'
import { TosService } from './tos.service.js'

@Module({
  controllers: [TosController],
  providers: [TosService],
})
export class TosModule {}