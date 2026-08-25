import { Module, forwardRef } from '@nestjs/common'
import { TosController } from './tos.controller.js'
import { TosService } from './tos.service.js'
import { SessionModule } from '../session/session.module.js'

@Module({
  imports: [forwardRef(() => SessionModule)],
  controllers: [TosController],
  providers: [TosService],
  exports: [TosService],
})
export class TosModule {}