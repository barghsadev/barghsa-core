import { z } from 'zod';
import { contractCommercialValueSchema } from '../contract/contract-validation.js';

const uuid = z.string().uuid();
const irr = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
export const solarContractSchema = z
  .object({
    profileId: uuid,
    idempotencyKey: uuid,
    title: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(60_000),
    changeDescription: z.string().trim().min(1).max(1000),
    commercialValue: contractCommercialValueSchema,
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('template'), templateVersionId: uuid }).strict(),
      z.object({ kind: z.literal('document'), documentId: uuid }).strict(),
    ]),
    invoiceLines: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(1000),
            quantity: z.number().int().min(1).max(2_147_483_647),
            unitPrice: irr,
            vatRate: z.number().int().min(0).max(10_000),
            isTaxable: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (value) =>
      Buffer.byteLength(
        JSON.stringify({
          title: value.title,
          text: value.text,
          solarSource: value.source,
          commercialValue: value.commercialValue,
        }),
        'utf8'
      ) <= 65_536
  );
export type SolarContractInput = z.infer<typeof solarContractSchema> & { requestId: string };
