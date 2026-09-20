import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorRequestHandler } from 'express';

/** Keep JSON parser diagnostics and submitted input out of client errors. */
export const sanitizeBodyParserErrors: ErrorRequestHandler = (error, _request, _response, next) => {
  if (
    error instanceof SyntaxError &&
    'type' in error &&
    error.type === 'entity.parse.failed' &&
    'status' in error &&
    error.status === HttpStatus.BAD_REQUEST
  ) {
    // An empty response lets the global filter select its stable validation
    // code and localized message. Do not carry the original body or cause.
    next(new HttpException({}, HttpStatus.BAD_REQUEST));
    return;
  }
  next(error);
};
