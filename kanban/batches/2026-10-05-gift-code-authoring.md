# Gift-code authoring — v0.1.5

This batch adopts shared forms for gift-code creation/editing under `03-core-business.md#T-03.02.02.05` and `02-auth-users-admin.md#T-09.12.03`. Existing catalogue, statistics, profile lookup, redemption and cancellation engines are reused. Global `07-ui-ux-design.md#T-07.10.01.02`, `#T-07.10.01.04`, `#T-07.10.01.05` and `#T-07.10.01.06` remain partial.

## Changes

- Bilingual linked feedback and first-error focus preserve raw drafts, including composite profile/date controls.
- Persian/Arabic/Western digits are normalized only for the captured request. IRR amounts remain exact through the PostgreSQL bigint limit. Percentages accept at most two decimals and convert directly to basis points without rounding.
- Eligibility, caps, usage limits, category membership, account-zone windows and restoration combinations validate before confirmation. Original stored instants and the existing date-picker/DST policy remain.
- Synchronous ownership blocks competing mutations and duplicate submission before deferred validation yields. Read-only recovery remains available during confirmation; it locks while a command is in flight.
- Confirmation displays captured code, type, amount/percentage, cap, minimum, eligibility, limits, dates and cancellation policy. Existing identity, catalogue epoch and query/basis checks fence receipts and permission races.
- Unconfirmed writes preserve drafts, refresh authorized saved data and require deliberate return to editing. Changed saved settings still require explicit reset.
- Create/update schema errors expose only editable field identifiers. Protected/mixed errors stay general, without submitted values.
- Root SemVer is `0.1.5`; login and Persian release notes use this version.

## Validation and review

Evidence: `~/.local/state/barghsa-manual-batches/gift-code-authoring/`.

- Selected web page/recovery/query/form tests: **42 pass**.
- Gift-code controller, service, real HTTP and public-field exception tests: **108 pass**, retaining permission, atomic redemption, preview, restoration and audit coverage.
- Production browser checks: **36 distinct cases pass** in English/Farsi, Chromium/mobile Safari: eight authoring, eight recovery, sixteen URL/cursor navigation and four login-version cases. Related runs retain failure evidence; only failed assertions were rerun after fixture repairs.
- API/web builds, root types, changed-file lint/format, OpenAPI compatibility, suppression policy, canonical queue validation and all **85 unchanged bundle budgets** pass.
- Strict SAST scans **1,789 files** with zero findings/errors; five rule fixtures pass.
- Focused source review covers exact arithmetic, coupled validation, ownership, immutable payloads, public error mapping, step-up/callback fencing and uncertainty recovery. It repairs composite revalidation after touch and clears pending state when an action retires.
- Initial failures were repaired: missing schema message typing, an unknown response type, a stale dictionary build, deferred-validation test timing and two browser selectors/ARIA assumptions. Final related checks pass.

## Release and limits

Reviewed screenshots show the actual rendered UI with fixture data. Publication, exact pushed SHA, detached deployment and Telegram confirmation have separate external receipts. `./deploy/staging/deploy.sh` runs in the independent release worker; CI is informational for staging.

Saved-state recovery does not automatically replay unkeyed mutations. Existing server eligibility, permission, step-up, redemption, VAT and cancellation policies remain authoritative. No schema/migration, dependency, CI gate, generated queue or historical supervisor-state change is included.
