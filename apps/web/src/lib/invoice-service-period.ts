/** The saved end is exclusive; show the last included calendar day. */
export function formatInvoiceServicePeriod(
  periodStart: string,
  periodEnd: string,
  format: (value: string | null, options?: Intl.DateTimeFormatOptions) => string
): string {
  const dateOnly: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  return `${format(periodStart, dateOnly)} – ${format(new Date(Date.parse(periodEnd) - 1).toISOString(), dateOnly)}`;
}
