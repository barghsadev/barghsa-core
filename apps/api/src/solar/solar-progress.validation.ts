import { z } from 'zod';
import { SOLAR_CONSTRUCTION_MILESTONES } from '@barghsa/db';

export const solarProgressCommand = z
  .object({
    stage: z.enum(SOLAR_CONSTRUCTION_MILESTONES),
    note: z.string().trim().min(1).max(1000),
    operationId: z.uuid().transform((value) => value.toLowerCase()),
    expectedRevision: z.number().int().min(0).max(2),
  })
  .strict();
export const solarProgressConfirmation = solarProgressCommand.safeExtend({
  expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SolarProgressCommand = z.output<typeof solarProgressCommand>;
