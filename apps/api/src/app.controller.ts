import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root(): { message: string } {
    return { message: 'Barghsa API' };
  }
}