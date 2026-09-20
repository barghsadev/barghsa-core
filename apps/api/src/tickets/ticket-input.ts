import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';

const positiveInteger = (max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max));
const listQuery = z.object({
  page: positiveInteger(100000).optional(),
  limit: positiveInteger(100).optional(),
  status: z
    .enum(['open', 'in_progress', 'waiting_customer', 'waiting_staff', 'resolved', 'closed'])
    .optional(),
  search: z.string().max(512).optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'subject', 'status', 'priority']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  assignedTo: z.string().trim().max(512).optional(),
});

export function ticketListQuery(input: unknown) {
  const result = listQuery.safeParse(input);
  if (!result.success)
    throw new HttpException(
      {
        statusCode: 400,
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'Invalid ticket list filters or pagination',
      },
      400
    );
  const data = result.data;
  return {
    ...(data.page === undefined ? {} : { page: data.page }),
    ...(data.limit === undefined ? {} : { limit: data.limit }),
    ...(data.status === undefined ? {} : { status: data.status }),
    ...(data.search === undefined ? {} : { search: data.search }),
    ...(data.sortBy === undefined ? {} : { sortBy: data.sortBy }),
    ...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
    ...(data.assignedTo === undefined ? {} : { assignedTo: data.assignedTo }),
  };
}

export function ticketPagination(page = 1, limit = 20) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new HttpException(
      {
        statusCode: 400,
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'Invalid ticket pagination',
      },
      400
    );
  }
  return { page, limit, offset: (page - 1) * limit };
}
