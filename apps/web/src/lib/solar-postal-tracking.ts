export interface SolarPostalTracking {
  requestId: string;
  requestStatus: string;
  postalStatus: string;
  courier: string | null;
  trackingNumber: string | null;
  sendDate: string | null;
  estimatedArrivalDate: string | null;
  trackingUrl: string | null;
  note: string | null;
  revision: number;
  recordedAt: string | null;
  canEdit: boolean;
}

/** Calendar dates retain their day in every account timezone. */
export function postalCalendarDate(value: string | null, locale: 'fa' | 'en') {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const instant = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== day)
    return null;
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(instant);
}

export function postalDateInput(value: Date | undefined, timezone: string) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Only public HTTPS links can be opened, including when reading legacy data. */
export function publicPostalUrl(value: string | null) {
  if (!value || value.length > 2000 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) ||
      /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname)
    )
      return null;
    return { href: url.toString(), host: url.hostname };
  } catch {
    return null;
  }
}
