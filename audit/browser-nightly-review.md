# Nightly browser repair review

Status: local browser validation passed across the recorded runs. No workflow has been pushed or activated on GitHub.

## Reproduced issues

- The production browser wrapper appended Chromium to explicit Firefox selection. A listing contained 650 tests across both projects; it now contains 325 Firefox tests only. Chromium remains the default and the only permitted source-coverage project.
- The smoke identity test hardcoded Chromium. It now checks the actual project and worker identity.
- Locale setup observed only later document insertion. Firefox could already have an HTML root, leaving English tests in Persian. Initialization now applies immediately when the root exists and retains insertion handling for other engines.
- The logo PNG fixture had an invalid IDAT CRC. Its checksum was corrected without changing pixels. Firefox had rejected the image.
- Date assertions used Node ICU punctuation. WebKit legitimately rendered "at" where Node rendered a comma. Expected text now uses the selected browser's locale data with the explicit fixture timestamp and timezone.
- Per-project API builds could overlap when running browser projects in parallel. Compilation now happens once in global setup, before workers begin.

## Evidence so far

- All fifteen smoke checks passed across Chromium, Firefox, WebKit, Pixel 5 and iPhone 13 projects.
- All six reproduced Firefox locale checks passed.
- The next full Firefox run passed 323 of 325 checks; only the two invalid-PNG logo cases failed. Those passed in the subsequent focused run after fixture correction.
- A five-project logo run passed eight of ten cases; the remaining two WebKit English cases exposed the date-punctuation mismatch. All four WebKit/mobile-Safari logo cases then passed after the assertion correction.
- Browser-selection and actual retry-failure gate checks pass. Web typechecking, targeted lint and formatting pass at the current intermediate state.

The first full WebKit run passed 288 cases, failed three and interrupted one when the failure limit stopped the run. Three affected cases had additional literal date punctuation assumptions; these now use the browser formatter. The other failure exposed a real verification-button hover contrast of 4.31:1. The button keeps its accessible background on hover and uses a shadow for feedback. An explicit hover regression reproduced this in Chromium. All twenty final language/theme/hover contrast cases pass across five projects, with zero unresolved axe measurements and an explicit wait for the configured primary color.

The first combined five-project run stopped with 1,118 passed, four failed, three interrupted and 500 not run. Its failures exposed three further causes:

- Safari's native select kept the previous choice after Home. The keyboard test uses ArrowDown and still checks the selected value, failed-save retention and persisted reload.
- A reconciliation test ended with an API route handler still active. Its response had been disposed during context teardown. The live-API suite now waits for outstanding route handlers before context disposal, without ignoring their errors.
- The Persian mobile invoice page widened from 393 to 511 pixels. Absolutely positioned screen-reader labels inside the horizontally scrolling reminder table lacked a containing block, allowing them to extend the root scroll area and shift hit targets. Positioning the table's scroll wrapper contains those labels. A regression checks document width and ordinary button clicks; no forced clicks are used.

All sixty affected cases pass across five projects with two repetitions. Eighteen reminder-panel/invoice unit tests, web typechecking, targeted lint, formatting and diff review pass. Both 41-route budget checks passed after the earlier hover fix. The later mobile-table position change received a fresh Vite build, but that build does not run the separate budget gate. No final-revision budget result was captured for this checkpoint. Full cross-browser validation is still required. These are local fixture/build checks, not remote CI execution or certification of future saving-plan/solar/commercial-order flows.

## Mobile profile-selection follow-up

At committed revision `5a495f670c6a21593ead2006edcca1d112e2266f`, the next matrix passed 1,429 tests, failed eight, interrupted three and left 185 unrun at the failure limit. All eight failures were profile-switch checks reaching into a closed mobile menu. The required dialog itself completed correctly. Tests now wait for the menu control to mount, open it when collapsed, and check actual selector removal even when navigation is hidden. All sixty profile checks pass across five projects with two repetitions. The first helper attempt raced mounting and failed twelve cases; the final helper awaits attachment and all sixty pass.

Review also found that Playwright accepts several project names after one flag. Coverage validation now inspects every name, including the equals form, and rejects a mixed Chromium/Firefox request before running. Both new mixed-project regressions failed before this correction.

Chromium, Firefox and desktop WebKit each completed all 325 cases in the committed run. Remaining validation is a complete run of both mobile projects after the profile test correction. Product code is unchanged since that run.

## Final local evidence

Both complete mobile projects passed all 650 tests at `d55c7685d6adac4abdd669395904ad3954434b08`. Combined with 975 desktop passes at `5a495f670c6a21593ead2006edcca1d112e2266f`, all 1,625 unique cases have passed. The product source tree is identical between these revisions. All changed profile cases also passed twice in every project. This is combined evidence from separate runs, not a single all-project green run. Exact revisions, report digests and per-project outcomes are saved in `audit/browser-nightly-checkpoint.json`.
