import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';

/** Public field identifiers only. Never carry submitted values or validator messages. */
export class InputFieldException extends HttpException {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    this.fields = Object.freeze(
      [...new Set(fields)]
        .filter(
          (field) =>
            /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(field) &&
            !['constructor', 'prototype', '__proto__'].includes(field)
        )
        .slice(0, 50)
    );
  }
}
