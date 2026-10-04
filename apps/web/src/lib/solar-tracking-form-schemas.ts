import { z } from 'zod/mini';
import { publicPostalUrl } from './solar-postal-tracking.js';
import { utcCalendarDay } from './solar-postal-form.js';
import type { SolarTrackingDraft } from './solar-tracking-form.js';

export const inactiveSolarTrackingSchema = z.custom<SolarTrackingDraft>();
export function solarTrackingSchema(
  messages: Record<keyof SolarTrackingDraft, string>,
  sendDate: string | null
) {
  return z.custom<SolarTrackingDraft>().check((ctx) => {
    const add = (name: keyof SolarTrackingDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.[name],
        path: [name],
        message: messages[name],
      });
    const { estimatedArrivalDate, trackingUrl, note } = ctx.value ?? {};
    if (
      typeof estimatedArrivalDate !== 'string' ||
      (estimatedArrivalDate !== '' &&
        (!utcCalendarDay(estimatedArrivalDate) || !sendDate || estimatedArrivalDate < sendDate))
    )
      add('estimatedArrivalDate');
    if (
      typeof trackingUrl !== 'string' ||
      (trackingUrl.trim() !== '' && !publicPostalUrl(trackingUrl.trim()))
    )
      add('trackingUrl');
    if (typeof note !== 'string' || !note.trim() || note.trim().length > 1000) add('note');
  });
}
