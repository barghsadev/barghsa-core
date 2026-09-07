# Finance acceptance review follow-ups

These findings were reproduced against the currently compiled local API modules while the browser suite ran. They are not repaired yet.

- `replayInvoiceCalculation` accepts an unsupported snapshot version. A valid 100 IRR manual snapshot with `version` changed to 999 still replayed to 100. Replay must reject unsupported version/rounding metadata rather than silently treating future formats as version 1.
- `calculateManualInvoice` accepts `Number.MAX_SAFE_INTEGER + 1` as a quantity because it uses `Number.isInteger`. A 100 IRR unit price returned a calculated total of 900719925474099200. The database's integer quantity column prevents persisting that quantity; no incorrect persisted invoice was demonstrated. Calculation and replay input validation should reject unsafe numeric quantities, including the automatic calculation path if affected.

Next checks: add regressions, review all calculation callers, run rounding/VAT/snapshot and real-PostgreSQL replay tests before updating individual finance acceptance records.
