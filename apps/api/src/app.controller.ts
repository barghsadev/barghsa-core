import { Controller, Get } from '@nestjs/common';
import { Etag } from './common/index.js';

@Controller()
export class AppController {
  @Get()
  @Etag()
  root(): { message: string } {
    return { message: 'Barghsa API' };
  }
}