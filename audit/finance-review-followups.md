# Finance acceptance review follow-ups

Status: the reproduced calculation/replay input defects below are repaired and validated locally.

- `replayInvoiceCalculation` accepts an unsupported snapshot version. A valid 100 IRR manual snapshot with `version` changed to 999 still replayed to 100. Replay must reject unsupported version/rounding metadata rather than silently treating future formats as version 1.
- `calculateManualInvoice` accepts `Number.MAX_SAFE_INTEGER + 1` as a quantity because it uses `Number.isInteger`. A 100 IRR unit price returned a calculated total of 900719925474099200. The database's integer quantity column prevents persisting that quantity; no incorrect persisted invoice was demonstrated. Calculation and replay input validation should reject unsafe numeric quantities, including the automatic calculation path if affected.

Review also reproduced manual snapshots ignoring nonzero or non-string order discounts. Replay now rejects those unsupported inputs, unknown versions, missing headers and changed rounding rules/scales. Both calculation paths require safe integer quantities. Valid version-1 snapshots and exact BigInt amounts retain their arithmetic. No snapshot format version changed and no existing financial records were rewritten.

The new boundary file had 23 failing cases and two passing safe-boundary cases before the repair. All 25 now pass. The complete invoice group passes 444 tests across 33 files, including real PostgreSQL snapshot replay, VAT resolution, state transitions, idempotency, corrections and receipt handling. API typechecking, targeted lint, formatting and diff review pass. Rounding comments were corrected to match the implementation's half-up formula and TypeError for non-bigint values.

The earlier baseline passed 109 tests across seven files using real PostgreSQL setup and already-built dependencies while browser tests ran. Final validation used the normal API test configuration and rebuilt its dependencies/API. Stored legacy invoices without calculation snapshots remain outside replay certification. Broader finance tasks and future order/refund flows are separate acceptance work.
