import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';

export const TicketReplySchema = z
  .object({
    body: z.string().max(10000),
    visibility: z.enum(['public', 'internal']).optional(),
    bodyFormat: z.enum(['plain', 'markdown']).optional(),
    attachments: z
      .array(z.string().regex(/^uploads\/(document|image)\/[a-f0-9-]+\.(pdf|png|jpe?g|webp)$/i))
      .max(5)
      .optional(),
    submissionId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.body.trim() || value.attachments?.length),
    'A reply requires text or attachments'
  )
  .refine(
    (value) => !value.attachments || new Set(value.attachments).size === value.attachments.length,
    'Attachments must be distinct'
  );
export type TicketReplyOptions = Pick<
  z.infer<typeof TicketReplySchema>,
  'bodyFormat' | 'attachments' | 'submissionId'
>;
export function ticketReply(input: unknown) {
  const result = TicketReplySchema.safeParse(input);
  if (!result.success) throw new HttpException('Invalid ticket reply', 400);
  return result.data;
}
export const ticketReplyApiSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['body'],
  properties: {
    body: { type: 'string', maxLength: 10000 },
    visibility: { type: 'string', enum: ['public', 'internal'] },
    bodyFormat: { type: 'string', enum: ['plain', 'markdown'] },
    attachments: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string' } },
    submissionId: { type: 'string', format: 'uuid' },
  },
};

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
    .enum([
      'active',
      'open',
      'in_progress',
      'waiting_customer',
      'waiting_staff',
      'resolved',
      'closed',
    ])
    .optional(),
  scope: z.literal('active').optional(),
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
    ...(data.scope === undefined ? {} : { scope: data.scope }),
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
