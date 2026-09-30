# Customer history date filters

Canonical work: `07-ui-ux-design.md#T-07.18.02.02` (`DateRangeFilter`), plus URL persistence and active-count/clear behavior from `07-ui-ux-design.md#T-07.18.02.04` and `07-ui-ux-design.md#T-07.18.02.05` on saving, solar, and consultation customer histories. Adoption across all lists and the wider list framework remain open.

The shared filter provides start and inclusive end date pickers, Today, Last 7 days, This month, Last month, and Custom. Persian month presets follow the Jalali calendar; English presets follow Gregorian months. Selection and day boundaries use the saved account timezone, with controls disabled until that preference loads. Custom edits stay local until Apply, and reversed ranges show a translated validation error.

Routes serialize exact UTC bounds into `from` and `to`. The server treats `from` as included and `to` as excluded, so the selected end day is fully included without losing sub-millisecond database precision. All three APIs validate bounds and constrain both cursor lookup and list queries before pagination. Date and status selections compose, clear independently, survive reload and Back, and reset accumulated pages without discarding the consultation form. Empty results describe the combined filters. The committed OpenAPI contract documents both optional bounds.

Validation: three PostgreSQL HTTP integration suites (10 tests), shared date/status parser tests (17), preset tests covering Jalali New Year, Gregorian months, an extreme timezone and daylight saving, full web tests (1,159), UI tests (63), translation tests (53), 30 bilingual history filter flows across Chromium, Firefox, WebKit, Android and iPhone projects, existing customer journeys, root build/typecheck/lint/format, OpenAPI contract, all 64 bundle budgets, and generated backlog validation. Browser checks also exercise custom inclusive end dates, invalid drafts, combined selections and failed timezone reads.

The preceding status-filter batch's remote CI completed successfully. The paused automation and historical loop-state files remain unchanged.
