import { z } from 'zod';

export const BusinessTypeSchema = z.enum(['contract', 'invoice', 'order', 'standalone']);
export type BusinessType = z.infer<typeof BusinessTypeSchema>;
export const DocumentCreateSchema = z
  .object({
    profileId: z.string().uuid().optional(),
    businessRecordType: BusinessTypeSchema,
    businessRecordId: z.string().uuid().optional(),
    contractVersionId: z.string().uuid().optional(),
    contractRole: z.enum(['original', 'signed', 'amendment']).optional(),
    category: z.enum(['document', 'image', 'contract']).default('document'),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().min(1).max(128),
    fileSize: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
    supersedesDocumentId: z.string().uuid().optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.businessRecordType === 'standalone') !== !input.businessRecordId)
      context.addIssue({
        code: 'custom',
        path: ['businessRecordId'],
        message: 'Business association does not match the document type',
      });
    if (
      (input.businessRecordType === 'contract') !==
      !!(input.contractVersionId && input.contractRole)
    )
      context.addIssue({
        code: 'custom',
        path: ['contractVersionId'],
        message: 'Contract documents require an exact version and role',
      });
    if (input.businessRecordType !== 'contract' && (input.contractVersionId || input.contractRole))
      context.addIssue({
        code: 'custom',
        path: ['contractVersionId'],
        message: 'Only contract documents have a contract version',
      });
  });
export type DocumentCreate = z.infer<typeof DocumentCreateSchema>;
export const DocumentCommandSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    idempotencyKey: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type DocumentCommand = z.infer<typeof DocumentCommandSchema>;
export const DocumentListSchema = z
  .object({
    businessRecordType: BusinessTypeSchema.default('standalone'),
    q: z.string().trim().max(128).optional(),
    category: z.enum(['document', 'image', 'contract']).optional(),
    profileId: z.string().uuid().optional(),
    businessRecordId: z.string().uuid().optional(),
    state: z
      .enum([
        'Uploading',
        'PendingScan',
        'Available',
        'SubmittedForReview',
        'Approved',
        'Rejected',
        'Superseded',
        'Quarantined',
        'Removed',
      ])
      .optional(),
    before: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
