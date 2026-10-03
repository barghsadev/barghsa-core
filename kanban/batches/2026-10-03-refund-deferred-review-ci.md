# Refund review readiness in CI, October 3, 2026

## Problem and change

The preceding invoice commit's CI run [37140090610](https://github.com/barghsadev/barghsa-core/actions/runs/37140090610) failed one of 2,799 web cases: `RefundPanel.test.tsx` asserted the captured refund body before deferred validation, parsing, summary loading and the dialog effect had completed. The existing click helper's transient idle state is not evidence that the reviewed command exists.

The canonical-value case now waits for its **exact existing body assertion**: invoice, amount, trimmed reason, review hash and request key. Dismissal still verifies the original localized amount and raw reason remain. No production behavior, timeout, assertion, workflow or CI gate is weakened.

## Evidence

- `pnpm --filter @barghsa/web test src/components/RefundPanel.test.tsx` — all 18 cases pass after the repair.
- The preceding combined local selection passed all 77 web cases. Root types, lint and formatting are checked with the accompanying deadline batch before publication.
- Remote history/security/integrity gates passed. The test gate failed and the downstream combined-coverage gate failed; API/browser completion and remote green are not claimed.

This is a separate conventional CI repair commit, published in one normal direct-main push with the related deadline-form batch. The new exact-head CI result must be tracked independently. No scheduler or supervisor state changes.
