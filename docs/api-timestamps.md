# API timestamps

For OpenAPI fields with format `date-time`, send a full timestamp with seconds and a time zone. Use UTC, for example `2026-11-07T10:30:00.000Z`. Fields whose schema permits offsets also accept an offset such as `+03:30`. See [RFC 3339 §5.6](https://www.rfc-editor.org/rfc/rfc3339.html#section-5.6).

The newer validator no longer accepts timestamps such as `2026-11-07T10:30Z` for these fields. The Barghsa web app already converts selected times to full timestamps before submitting them. API clients should append `:00` seconds when their input has only minute precision, and preserve the intended time zone. Date-only fields still use their separate calendar-date format.
