# Dynamic invoice lines and upload lists, October 2, 2026

## Scope and result

This related form batch builds the shared `DynamicFieldArray` portion of `07-ui-ux-design.md#T-07.10.02.03` and adopts it in manual invoice creation/replacement, selected document files and staff/customer ticket-reply attachments. The component adds, removes and reorders complete items using stable keys. It supports minimum/maximum counts, transaction locks, caller-rendered sub-fields and per-item errors. The form owns validation, server commands and receipts. Agent-permission adoption, FormStep and the broader form-state criteria remain open.

Invoice lines retain their description, quantity, price and VAT when moved. The one-line minimum and 100-line maximum remain. Existing native required fields, exact calculation checks, server financial review, captured request, step-up verification and safe retry are preserved. Reordering changes the order supplied to the authoritative review and issue request.

The shared file picker uses File object identity so duplicate names do not detach previews or progress. Multi-file selection adds to the retained list and validates the combined count, types and sizes before accepting it. Reordering retains previews; removal clears only the removed preview. Existing single-file document reservation, transfer, confirmation and access-denial protections remain unchanged. This batch adds no bulk-document API.

Ticket replies use the same controls for up to five attachments. Reordering retains verified upload receipts, and an unchanged retry retains its submission ID. A changed attachment order receives a new ID for the changed payload. Removing a file clears that file's cached receipt. Busy transactions reject file additions and array changes. Existing formatting, internal/public visibility, preview denial and failed-write recovery remain.

Controls have item-specific Persian/English accessible names and retain keyboard focus after moves, additions and removal. Removing the last item returns focus to the Add control or the existing picker/reply editor. On small screens reply filenames have their own row, above preview and ordering controls. No API, migration or dependency is added.

## Review and validation

Source review checks stable identity, bounded mutations, disabled callbacks, native field validation, preview/receipt retention, financial request ordering and keyboard focus. Review repairs focus after the last reply attachment is removed by keeping the empty array component mounted. Persian mobile screenshot inspection also corrects filenames squeezed alongside the new controls. The final rendering is inspected again.

- The shared component passes **five cases**, including field DOM identity and retained edits/errors after reordering, original item references, minimum/maximum boundaries, required fields, focus and transaction locks.
- **422 distinct related web cases have passing evidence**. The seven-file related run passes 421 cases; after the reply focus repair, the final two reply files pass six cases, including one additional last-attachment focus case. Other implementation files remain unchanged after the larger run. These checks cover file validation/progress, previews, document commands, invoice profile lookup and admin boundaries, plus ordered reply receipts and retry IDs.
- All **68 dictionary cases pass**. Both languages include the new invoice/file ordering labels.
- The production browser run passes **48 scenarios** across Chromium/mobile Safari: manual invoice financial review/verification/retry, invoice replacement, customer/staff document selection and transfer/confirmation recovery, and formatted replies with lost acknowledgements. Languages and manual-invoice light/dark cases remain covered. The final reply run repeats and passes **all eight affected scenarios** after the focus/layout repairs. Existing write, malformed-acknowledgement, upload-count and idempotency assertions remain. Scoped Axe, contrast checks where supplied, mobile bounds and Persian mobile rendering are verified.
- Root build passes **seven tasks**, typecheck **11**, and lint/formatting, OpenAPI, suppressed-error and diff checks pass. Backlog validation covers **1,355 tasks and 116 traceability entries**.
- All **73 unchanged bundle limits pass**, including dashboard **290.57 KB / 300 KB** and electricity ordering **245.17 KB / 255 KB**.
- Strict security scans **1,502 files**, with zero findings/errors and all five rule fixtures passing. An initial scan cannot parse an inline type import in the new reply test; a named type import fixes that parser warning and the affected tests still pass. No unrelated full repository or API/database test suite is claimed.

Related commands: `pnpm --filter @barghsa/ui test src/dynamic-field-array.test.tsx`; `pnpm --filter @barghsa/web test src/components/FileUpload.test.tsx src/components/FilePreview.test.tsx src/components/TicketReplyInput.test.tsx src/components/TicketReplyInput.array.test.tsx src/components/DocumentUpload.test.tsx src/components/ManualInvoicePanel.pagination.test.tsx src/pages/admin-boundaries.test.tsx`; final `pnpm --filter @barghsa/web test src/components/TicketReplyInput.test.tsx src/components/TicketReplyInput.array.test.tsx`; `pnpm --filter @barghsa/i18n test`.

Browser commands: production `e2e manual-invoice.spec.ts document-upload-controls.spec.ts tickets.spec.ts invoice-corrections.spec.ts --grep "manual invoice|previews selected PDF|validates configured files|formatted reply attachments|replacement" --project=chromium --project=mobile-safari --workers=2`; final `e2e tickets.spec.ts --grep "formatted reply attachments" --project=chromium --project=mobile-safari --workers=2`. Both use `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173` with completed release builds; no rebuild runs during a browser test.

## Deployment and publication

Deploy the frontend with the existing API. Financial and upload request/receipt contracts remain compatible.

Publication uses direct main through Git/GitHub CLI, with local/remote/GitHub SHA agreement, clean checkout and exact-commit CI registration read back after pushing. New remote checks remain pending until GitHub completes them. The preceding order/settings commit `975c604341bc4fbc9cb68196b450c77e9df2bf23` passes all five CI jobs in [run37043627273](https://github.com/barghsadev/barghsa-core/actions/runs/37043627273); the existing fast-mode coverage exemption is unchanged. No PR, scheduler, external supervisor state/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed.
