import { isIP } from 'node:net';
import { z } from 'zod';

const trackingUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        (!url.port || url.port === '443') &&
        !isIP(host.replace(/^\[|\]$/g, '')) &&
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(host) &&
        !/\.(localhost|local|internal|test|invalid)$/.test(host) &&
        !/\s/.test(value)
      );
    } catch {
      return false;
    }
  })
  .transform((value) => new URL(value).toString());
export const solarPostalTrackingCommand = z
  .object({
    estimatedArrivalDate: z.iso.date().nullable(),
    trackingUrl: trackingUrl.nullable(),
    note: z.string().trim().min(1).max(1000),
    expectedRevision: z.number().int().min(0).max(2147483646),
    idempotencyKey: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
  })
  .strict();
export const confirmedSolarPostalTrackingCommand = solarPostalTrackingCommand.safeExtend({
  expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SolarPostalTrackingCommand = z.output<typeof solarPostalTrackingCommand>;
