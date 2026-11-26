/** Fallback hardcoded timezone list when Intl.supportedValuesOf is unavailable. */
const FALLBACK_TIMEZONES = [
  'Asia/Tehran',
  'Asia/Baghdad',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Muscat',
  'Asia/Jerusalem',
  'Asia/Beirut',
  'Asia/Damascus',
  'Asia/Amman',
  'Asia/Kabul',
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Tashkent',
  'Asia/Yerevan',
  'Asia/Baku',
  'Asia/Tbilisi',
  'Asia/Istanbul',
  'Europe/Moscow',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Vienna',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Budapest',
  'Europe/Zurich',
  'Europe/Lisbon',
  'Europe/Dublin',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Tallinn',
  'Europe/Belgrade',
  'Europe/Sofia',
  'Europe/Zagreb',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'America/Halifax',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Panama',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'America/Santiago',
  'America/Bogota',
  'America/Lima',
  'America/Caracas',
  'America/La_Paz',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Kuala_Lumpur',
  'Asia/Ho_Chi_Minh',
  'Asia/Ulaanbaatar',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Pacific/Auckland',
  'Pacific/Fiji',
  'Pacific/Honolulu',
  'Pacific/Guam',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Addis_Ababa',
  'UTC',
  'Etc/UTC',
  'GMT',
  'Atlantic/Reykjavik',
  'Indian/Maldives',
  'Indian/Mauritius',
];

/** All IANA timezones from the Intl API, with fallback. */
function getAllTimezones(): string[] {
  try {
    const supported = Intl.supportedValuesOf('timeZone');
    if (Array.isArray(supported) && supported.length > 0) {
      return supported as string[];
    }
  } catch {
    // Intl.supportedValuesOf unavailable — use fallback
  }
  return FALLBACK_TIMEZONES;
}

export const ALL_TIMEZONES = [...new Set(['Asia/Tehran', 'UTC', ...getAllTimezones()])];

export function timezoneSearchTerms(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[_/\s\u200c]+/g, ' ')
    .trim();
}
