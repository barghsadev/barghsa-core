# Invoice to published contract return

Canonical scope: `07-ui-ux-design.md#T-07.18.03.01` and `07-ui-ux-design.md#T-07.18.03.02`, the invoice/contract navigation handoff.

The authorized customer invoice detail response now includes its related contract ID only when that contract belongs to the same profile and has a published version. The invoice page offers a bilingual link to the selected contract. This works on corrected invoice views through the existing invoice-family origin resolution. Unpublished contracts have no link, and no invoice or contract state changes.

Validation: PostgreSQL HTTP tests cover unpublished, published, and foreign-profile access. Bilingual invoice unit tests and the Chromium electricity payment journey verify the link. Workspace build, typecheck, lint, formatting, contract, and backlog checks run before push; GitHub CI runs on the pushed commit.
