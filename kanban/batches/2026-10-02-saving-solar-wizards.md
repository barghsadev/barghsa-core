# Saving and solar wizards, October 2, 2026

## Scope

Builds `07-ui-ux-design.md#T-07.22.02.03` and the saving/solar portions of `07-ui-ux-design.md#T-07.22.01.04` and `07-ui-ux-design.md#T-07.22.01.05` as one related batch. Solar now has the four specified stages: property details, grid connection and bill identifier, contract preparation and terms, then authoritative review and submission. Saving retains its existing six stages, with agreement acceptance preceding financial review, and gains protected drafts, bounded URL steps and review Edit actions. Its existing customer/staff/payment/contract/fulfillment journey is preserved.

Together with the preceding onboarding and electricity batches, departure protection and URL state now cover all customer wizards named in S-07.22.02: simple electricity, advanced electricity, solar, saving and personal/company onboarding. These two framework tasks are complete for those forms. Admin-configurable draft TTL and a general legacy draft directory remain separate unfinished requirements; neither is claimed complete here.

## Behavior and review

Saving and solar offer Save and leave, Stay and explicit discard. A successful draft receipt must match the owner when returned, submitted stage and entire submitted data. PostgreSQL JSONB key ordering does not produce a false mismatch or false dirty state. Failed saves retain the draft and dialog. Writes read current CSRF; synchronous command locks prevent repeated saves or overlapping draft, address, bill-verification, review and submission commands. Inputs freeze while commands run. Profile changes, retries, unmounts and obsolete responses cannot overwrite the current draft or move the wrong form.

Confirmed step changes create browser history and save before Continue, Back and review Edit. Reload restores a safe stage. URL input cannot skip unsaved stages, malformed values select the first stage, and private fields remain in the backend draft. Pending commands also block browser Back/Forward until their receipt is handled. A confirmed save updates the departure guard synchronously, so saving before address setup does not spuriously open another warning.

Resumed saving drafts require fresh equipment confirmation and agreement acceptance. Solar renews terms acceptance and its server review; a saved stage four resumes no later than terms. Solar validates the property branch and grid-dependent bill before progressing, retains its debounced autosave, and pauses autosave during the leave dialog or after a failure. Request review must contain the submitted profile, request key and normalized contents, a valid digest, server terms, and the no-contract/no-invoice outcome. The accepted server terms are displayed in both locales. Only a valid final UUID receipt releases departure protection. Invalid success responses stay on the form and preserve the same submission key for a retry.

An unfinished saving address cannot be represented as a saved order draft. Save and leave and final submission remain disabled until the address is saved or cancelled. If browser history hides its fields, a retained warning offers a return to the address stage. Cancellation explicitly clears the pending fields. Geography failures show an error and retain the form rather than crashing it. Existing server saving quotes, duplicate-bill policy, agreement version, selected-address ownership and staff-review requirements remain authoritative.

## Database and deployment

Expand migration `0242_solar_wizard_steps` adds `solar_customer_drafts.current_step`, defaults existing rows to one, and constrains writes to 1–4. It preserves existing data, creation/update timestamps, prior migration checksums and the existing timestamp trigger. The new journal timestamp follows the released entries; no released migration is edited. Step-only updates are audited, identical saves do not generate duplicate audits, scoped access and seven-day expiry remain intact. OpenAPI now describes the bounded integer step.

Deploy migration0242 first, then the API with or before the frontend. The API remains compatible with the previous frontend's stage-one saves. This batch does not change draft TTL configuration, issue contracts/invoices during solar intake, or change existing CI settings.

## Validation

- `pnpm build`: all seven root build tasks pass on final application source.
- `pnpm --filter @barghsa/web test`: all 219 files/2,556 cases pass before the final review refinements. Final directly related draft/protection/page/receipt selection passes all 40 cases, including the added profile-switch command case.
- `pnpm --filter @barghsa/i18n test`: all 67 cases pass.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/solar/solar-request.integration.test.ts src/saving/saving-order.integration.test.ts`: all seven saving cases pass. After fixing the new audit assertion to parse the existing text metadata, the complete two-case solar file passes, covering step-four roundtrip, rejected bounds, no-op audit, ownership, expiry and both request branches. Nine distinct related API cases have passing evidence.
- `pnpm --filter @barghsa/db test`: all 123 files/981 cases pass, including populated migration upgrade, default stage, step bounds, row preservation, unchanged prior history and idempotent migration rerun. `pnpm check:db-snapshot` passes and generation makes no changes.
- Production Chromium/mobile-Safari checks pass all 96 distinct scenarios: 50 new saving/solar navigation/recovery/accessibility cases, eight existing saving/solar business journeys, and 38 electricity regressions. The final service-only rerun after the last address/terms/scope refinements passes all 58 cases; repeats are not added to the scenario count.
- Root types, lint, format, OpenAPI and suppressed-error checks pass. Backlog validation covers 1,355 tasks/116 traceability entries. Strict security scans 1,486 files with zero findings/errors and all five rule fixtures passing. Final diff checks pass.
- `pnpm check:bundle`: all 73 gates pass with every prior limit unchanged. Dashboard is 299.32 KB/300 KB and electricity ordering is 254.21 KB/255 KB.
- Persian mobile dark-mode forms inspected at `/tmp/barghsa-saving-solar-solar-fa.png` and `/tmp/barghsa-saving-solar-saving-fa.png`. Both languages, light/dark themes, viewport width and scoped Axe have passing browser evidence.

## Publication and remaining work

Electricity commit `395c95280b19ea219767ef3d643c4eb0225707cc` passes all five exact-commit CI jobs in [run37024585564](https://github.com/barghsadev/barghsa-core/actions/runs/37024585564).

This manual batch uses direct-main publication as requested. The pushed SHA and exact new CI are read back after publication; pending CI is reported as pending. No PR, scheduler, external supervisor cache/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed. The next related draft work is configurable TTL and the legacy draft directory; select its bounded acceptance criteria before building.
