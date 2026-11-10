# Language, calendars and timestamps

The Vite SPA retains its native `packages/i18n` namespace dictionaries and `useLocale` subscription. Both languages are bundled. A language change updates the current document and subscribed views without navigation, resource requests or replacing form values. The switcher shows EN/FA with a localized full accessible name.

`createI18n(locale)` returns an immutable dictionary for the shared application and authentication messages. Its `MessageKey` type follows the English source keys, and missing Persian values fall back to English. Route-specific dictionaries stay with their existing domain modules so callers can import the translations their routes need.

The language order is the short-lived entry navigation handoff, explicit local storage choice, preference cookie, supported `lang` URL hint, supported browser language, then Persian. Explicit choices outrank URL hints. The blocking head script establishes `lang` and `dir` before React; the client consumes the one-time handoff. The existing server nonce and CSP remain required. Storage or cookie failures preserve the live choice and other available fallbacks. Language selection leaves unrelated URL parameters intact.

This restores browser detection required by ADR 004 and Epic 07. A September shell change had replaced that fallback with unconditional Persian. English-browser tests now first verify detection, explicitly choose Persian, and retain the previous persistence assertions. The ordinary Iranian-market test baseline remains Persian.

Published numeral preferences still override language defaults. Locale formatting changes presentation; quantities, identifiers, IRR integer strings and captured order values remain unchanged.

## Calendar adapters

`packages/i18n/calendar` uses the already installed versions of date-fns, date-fns-jalali and @date-fns/tz. `createCalendar` supplies format, parse, day/month arithmetic and month starts for an explicit zone. `apps/web/src/hooks/useCalendar.ts` selects the live language. These are display/input adapters; they do not determine permitted billing periods or financial authority.

An instant must be a valid Date, epoch milliseconds or a timestamp with an explicit UTC offset. Date-only and local timestamp strings cannot identify an instant. Parsing civil input uses an explicit zone and a format round trip; invalid Jalali days and DST gaps are rejected. Operations clone their inputs and preserve civil time across DST day boundaries. The default zone is Asia/Tehran; an invalid zone is never silently replaced.

`DateDisplay` and `DateTimeDisplay` live in `apps/web/src/components/DateDisplay.tsx`. Public views supply an explicit zone. Without one, private displays wait for the accepted account preference through the existing owner-scoped hook. Changing accounts withdraws the previous display until the new read succeeds. A failed preference read exposes its existing retry path. Existing account timezone storage and API remain authoritative; no duplicate profile timezone setting is created. Bulk views can pass their page-owned accepted zone to each display.

Date display supports date-fns patterns, including P/PP/PPP. Time display uses a 24-hour Persian clock and English AM/PM. Machine-readable datetime attributes stay ISO UTC. `RelativeTime` updates a local label every thirty seconds, cleans up its timer and performs no API reads. It does not announce every tick or move focus.

## Pickers and permitted periods

The existing DatePicker supplies single-date and half-open range modes through `calendarMode`. DateTimePicker retains its 24-hour Persian and 12-hour English controls, explicit zone, strict civil-time checks and keyboard behavior. Advanced electricity ordering retains its paired date/time controls so selecting a range preserves hours and the backend-reviewed interval. Day-only range filters retain the shared range mode. Language changes never alter the underlying instants or half-open bounds.

MonthPicker is a native controlled selector for offered month identities. Simple electricity ordering passes only the monthly options returned by the server and their existing localized labels. Weekly selection retains its existing control. The selector cannot create a new billing period or calculate a price. Selection, validation, captured commands and authoritative review stay with the existing wizard.

## Direction

Base UI portals use the live DirectionProvider. Logical inline placements already follow it. `useFlippedPlacement` mirrors physical left/right only. `Icon` mirrors directional Lucide names ending in Left/Right; physical diagrams can opt out. Existing correctly directed controls remain valid. Calendar navigation keeps its own direction mapping to avoid double mirroring. Shared breadcrumb and public terms back arrows follow the same direction policy.
