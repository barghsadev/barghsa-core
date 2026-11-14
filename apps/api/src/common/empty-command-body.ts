import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { z } from 'zod';

const emptyCommand = z.strictObject({}).optional();

export function assertEmptyCommandBody(body: unknown): void {
  if (!emptyCommand.safeParse(body).success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
}
